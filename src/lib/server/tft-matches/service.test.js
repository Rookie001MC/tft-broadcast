import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import {
	clearTftMatchPreviewCacheForTests,
	getTftMatchPreviewBatch,
	storeTftMatchPreviewBatch
} from './preview-cache.js';
import {
	TftMatchPreviewConflictError,
	discoverTftMatchHistory,
	resolveTftMatchPreviewForSave
} from './service.js';

const fixtureText = await readFile(
	new URL('../../../../examples/tft-match-v1.example.jsonc', import.meta.url),
	'utf8'
);
const fixture = /** @type {any} */ (
	JSON.parse(
		fixtureText
			.split(/\r?\n/)
			.filter((line, index, lines) => {
				if (!line.startsWith('//')) return true;
				return lines.slice(0, index).some((prior) => !prior.startsWith('//'));
			})
			.join('\n')
	)
);
const selectedParticipant = /** @type {any} */ (
	fixture.info.participants.find((/** @type {any} */ participant) => participant.placement === 4)
);
const now = new Date('2026-08-16T06:00:00.000Z');
const config = {
	apiKey: 'private-config-key',
	region: 'VN2',
	accountRegionGroup: 'ASIA',
	matchRegionGroup: 'SEA'
};

const schemaStatements = [
	`CREATE TABLE catalog_snapshots (
		id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL,
		locale TEXT NOT NULL, patch_label TEXT NOT NULL, set_label TEXT, canonical_set_key TEXT,
		synced_at INTEGER NOT NULL, is_available INTEGER DEFAULT 0 NOT NULL, metadata_json TEXT NOT NULL
	)`,
	`CREATE TABLE catalog_champions (
		id TEXT PRIMARY KEY NOT NULL, catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
		external_id TEXT NOT NULL, display_name TEXT NOT NULL, icon_path TEXT, tier INTEGER,
		metadata_json TEXT NOT NULL, correction_id TEXT, is_excluded INTEGER DEFAULT 0 NOT NULL,
		provenance_json TEXT DEFAULT '{"source":"upstream"}' NOT NULL,
		UNIQUE(catalog_snapshot_id, external_id)
	)`,
	`CREATE TABLE players (
		id TEXT PRIMARY KEY NOT NULL, riot_id TEXT, riot_id_key TEXT UNIQUE, riot_game_name TEXT,
		riot_tagline TEXT, full_name TEXT NOT NULL, display_name TEXT NOT NULL, image_path TEXT,
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE tournaments (
		id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
		active_catalog_snapshot_id TEXT REFERENCES catalog_snapshots(id) ON DELETE SET NULL,
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE tournament_players (
		tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
		player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
		display_order INTEGER NOT NULL, notes TEXT, PRIMARY KEY(tournament_id, player_id)
	)`
];

/** @param {ReturnType<typeof createClient>} client */
async function createSchema(client) {
	await client.execute('PRAGMA foreign_keys = ON');
	for (const statement of schemaStatements) await client.execute(statement);
}

/** @param {ReturnType<typeof drizzle>} database */
async function seed(database) {
	await database.insert(catalogSnapshots).values({
		id: 'catalog-active',
		source: 'test',
		sourceUrl: 'https://catalog.example',
		locale: 'en_us',
		patchLabel: '16.14',
		setLabel: 'Set 17',
		canonicalSetKey: 'TFTSet17',
		syncedAt: now,
		isAvailable: true,
		metadataJson: '{}'
	});
	const externalIds = [
		...new Set(
			fixture.info.participants.flatMap((/** @type {any} */ participant) =>
				participant.units.map((/** @type {any} */ unit) => unit.character_id)
			)
		)
	];
	await database.insert(catalogChampions).values(
		externalIds.map((externalId, index) => ({
			id: `champion-${index + 1}`,
			catalogSnapshotId: 'catalog-active',
			externalId,
			displayName: externalId.replace(/^TFT17_/, ''),
			iconPath: null,
			tier: null,
			metadataJson: '{}',
			correctionId: null,
			isExcluded: externalId === 'TFT17_IvernMinion',
			provenanceJson: '{}'
		}))
	);
	await database.insert(players).values([
		{
			id: 'player-selected',
			riotId: 'Jeff#Jeef',
			riotIdKey: 'jeff#jeef',
			riotGameName: 'Jeff',
			riotTagline: 'Jeef',
			fullName: 'Selected Player',
			displayName: 'Player Two',
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'player-outsider',
			riotId: 'Outside#VN2',
			riotIdKey: 'outside#vn2',
			riotGameName: 'Outside',
			riotTagline: 'VN2',
			fullName: 'Outside Player',
			displayName: 'Outside',
			createdAt: now,
			updatedAt: now
		}
	]);
	await database.insert(tournaments).values({
		id: 'tournament-one',
		name: 'Tournament One',
		slug: 'tournament-one',
		activeCatalogSnapshotId: 'catalog-active',
		createdAt: now,
		updatedAt: now
	});
	await database.insert(tournamentPlayers).values({
		tournamentId: 'tournament-one',
		playerId: 'player-selected',
		displayOrder: 0,
		notes: null
	});
}

/** @param {{ failedIndex?: number, unknownChampionIndex?: number }} [options] */
function createGateway(options = {}) {
	const fetchRecentMatches = vi.fn(async (identity) => ({
		puuid: selectedParticipant.puuid,
		matches: Array.from({ length: 10 }, (_, index) => {
			const matchId = `VN2_MATCH_${index + 1}`;
			if (index === options.failedIndex) {
				return { matchId, payload: null, error: 'This match is temporarily unavailable.' };
			}
			const payload = structuredClone(fixture);
			payload.metadata.match_id = matchId;
			payload.info.game_datetime =
				index === 0
					? new Date('2020-01-01T00:00:00.000Z').getTime()
					: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`).getTime();
			if (index === options.unknownChampionIndex) {
				payload.info.participants.find(
					(/** @type {any} */ participant) => participant.puuid === selectedParticipant.puuid
				).units[0].character_id = 'TFT17_UnknownFutureUnit';
			}
			return { matchId, payload, error: null };
		})
	}));
	return { fetchRecentMatches };
}

/** @param {ReturnType<typeof createClient>} client */
async function totalChanges(client) {
	const result = await client.execute('SELECT total_changes() AS changes');
	return Number(result.rows[0].changes);
}

describe('TFT match discovery service', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		await createSchema(client);
		database = drizzle(client);
		await seed(database);
	});

	afterEach(() => {
		clearTftMatchPreviewCacheForTests();
		client.close();
	});

	/** @type {Array<[string, (database: any) => Promise<unknown>, string]>} */
	const discoveryPreconditions = [
		['outside roster', async (db) => undefined, 'player-outsider'],
		[
			'incomplete Riot identity',
			async (db) => db.update(players).set({ riotTagline: null }),
			'player-selected'
		],
		[
			'missing active catalog',
			async (db) => db.update(tournaments).set({ activeCatalogSnapshotId: null }),
			'player-selected'
		],
		[
			'unavailable active catalog',
			async (db) => db.update(catalogSnapshots).set({ isAvailable: false }),
			'player-selected'
		]
	];

	test.each(discoveryPreconditions)(
		'rejects %s before calling the gateway',
		async (_name, mutate, playerId) => {
			await mutate(database);
			const gateway = createGateway();

			await expect(
				discoverTftMatchHistory({
					database,
					tournamentId: 'tournament-one',
					playerId,
					config,
					gateway,
					now
				})
			).rejects.toThrow();
			expect(gateway.fetchRecentMatches).not.toHaveBeenCalled();
		}
	);

	test('uses DB-owned identity, returns sorted successes and preserves safe failed rows', async () => {
		const gateway = createGateway({ failedIndex: 2 });
		const changesBefore = await totalChanges(client);
		const result = await discoverTftMatchHistory({
			database,
			tournamentId: 'tournament-one',
			playerId: 'player-selected',
			config,
			gateway,
			now
		});

		expect(await totalChanges(client)).toBe(changesBefore);
		expect(gateway.fetchRecentMatches).toHaveBeenCalledWith({ gameName: 'Jeff', tagline: 'Jeef' });
		expect(result.selectedPlayer).toEqual({
			id: 'player-selected',
			displayName: 'Player Two',
			riotId: 'Jeff#Jeef'
		});
		expect(result.matches).toHaveLength(10);
		expect(result.matches.slice(0, -1).every((row) => row.available)).toBe(true);
		expect(result.matches.at(-1)).toEqual({
			available: false,
			matchId: 'VN2_MATCH_3',
			reason: 'This match is temporarily unavailable.'
		});
		expect(result.matches[0].matchId).toBe('VN2_MATCH_10');
		expect(result.matches.at(-2)?.matchId).toBe('VN2_MATCH_1');
		expect(result.matches.find((row) => row.matchId === 'VN2_MATCH_1')).toBeDefined();
		expect(result.matches.find((row) => row.matchId === 'VN2_MATCH_4')).toMatchObject({
			available: true,
			placement: 4
		});

		const cached = getTftMatchPreviewBatch(result.token, { now });
		expect(cached).toMatchObject({
			region: 'VN2',
			tournamentId: 'tournament-one',
			selectedPlayerId: 'player-selected',
			activeCatalogSnapshotId: 'catalog-active',
			riotGameName: 'Jeff',
			riotTagline: 'Jeef',
			selectedPuuid: selectedParticipant.puuid
		});
		expect(Object.keys(cached.snapshots)).toHaveLength(9);
		expect(cached.failures).toEqual([
			{ matchId: 'VN2_MATCH_3', reason: 'This match is temporarily unavailable.' }
		]);
		expect(JSON.stringify(result)).not.toContain(config.apiKey);
		expect(JSON.stringify(cached)).not.toContain(config.apiKey);
		expect(JSON.stringify(cached)).not.toContain('apiKey');
	});

	test('keeps mapping failures visible with exact unresolved IDs and makes no writes', async () => {
		const gateway = createGateway({ unknownChampionIndex: 4 });
		const changesBefore = await totalChanges(client);
		const result = await discoverTftMatchHistory({
			database,
			tournamentId: 'tournament-one',
			playerId: 'player-selected',
			config,
			gateway,
			now
		});

		expect(await totalChanges(client)).toBe(changesBefore);
		expect(result.matches.find((row) => row.matchId === 'VN2_MATCH_5')).toEqual({
			available: false,
			matchId: 'VN2_MATCH_5',
			reason: 'The active catalog is missing these TFT units: TFT17_UnknownFutureUnit.'
		});
	});

	test('makes no writes when the gateway rejects discovery', async () => {
		const changesBefore = await totalChanges(client);
		const gateway = {
			fetchRecentMatches: vi.fn(async () => {
				throw new Error('gateway unavailable');
			})
		};

		await expect(
			discoverTftMatchHistory({
				database,
				tournamentId: 'tournament-one',
				playerId: 'player-selected',
				config,
				gateway,
				now
			})
		).rejects.toThrow('gateway unavailable');
		expect(await totalChanges(client)).toBe(changesBefore);
	});

	test('resolves the authoritative cached snapshot and all server bindings', async () => {
		const result = await discoverTftMatchHistory({
			database,
			tournamentId: 'tournament-one',
			playerId: 'player-selected',
			config,
			gateway: createGateway(),
			now
		});
		const resolved = await resolveTftMatchPreviewForSave({
			database,
			token: result.token,
			matchId: 'VN2_MATCH_4',
			tournamentId: 'tournament-one',
			config,
			now
		});

		expect(resolved).toMatchObject({
			tournamentId: 'tournament-one',
			selectedPlayerId: 'player-selected',
			selectedPuuid: selectedParticipant.puuid,
			activeCatalogSnapshotId: 'catalog-active',
			riotGameName: 'Jeff',
			riotTagline: 'Jeef',
			region: 'VN2',
			snapshot: { source: { matchId: 'VN2_MATCH_4', region: 'VN2' } }
		});
		expect(resolved.snapshot.participants).toHaveLength(8);
	});

	/** @type {Array<[string, (database: any) => Promise<Record<string, any>>]>} */
	const staleBindings = [
		['missing token', async () => ({ token: 'missing' })],
		['missing match', async () => ({ matchId: 'VN2_UNKNOWN' })],
		['changed region', async () => ({ config: { ...config, region: 'EUN1' } })],
		['changed tournament', async () => ({ tournamentId: 'different' })],
		[
			'changed catalog',
			async (db) => {
				await db.update(tournaments).set({ activeCatalogSnapshotId: null });
				return {};
			}
		],
		[
			'changed roster',
			async (db) => {
				await db.delete(tournamentPlayers);
				return {};
			}
		],
		[
			'changed Riot game name',
			async (db) => {
				await db.update(players).set({ riotGameName: 'Changed' });
				return {};
			}
		],
		[
			'changed Riot tagline',
			async (db) => {
				await db.update(players).set({ riotTagline: 'CHANGED' });
				return {};
			}
		]
	];

	test.each(staleBindings)(
		'rejects a %s binding without consuming the cache',
		async (_name, mutate) => {
			const discovery = await discoverTftMatchHistory({
				database,
				tournamentId: 'tournament-one',
				playerId: 'player-selected',
				config,
				gateway: createGateway(),
				now
			});
			const overrides = await mutate(database);

			await expect(
				resolveTftMatchPreviewForSave({
					database,
					token: discovery.token,
					matchId: 'VN2_MATCH_4',
					tournamentId: 'tournament-one',
					config,
					now,
					...overrides
				})
			).rejects.toBeInstanceOf(TftMatchPreviewConflictError);
			expect(getTftMatchPreviewBatch(discovery.token, { now })).not.toBeNull();
		}
	);

	test('rejects a corrupted cached canonical payload without consuming it', async () => {
		const discovery = await discoverTftMatchHistory({
			database,
			tournamentId: 'tournament-one',
			playerId: 'player-selected',
			config,
			gateway: createGateway(),
			now
		});
		const cached = getTftMatchPreviewBatch(discovery.token, { now });
		cached.snapshots.VN2_MATCH_4.participants[0].placement = 8;
		const corruptToken = storeTftMatchPreviewBatch(cached, {
			now,
			tokenFactory: () => 'corrupt-token'
		});

		await expect(
			resolveTftMatchPreviewForSave({
				database,
				token: corruptToken,
				matchId: 'VN2_MATCH_4',
				tournamentId: 'tournament-one',
				config,
				now
			})
		).rejects.toBeInstanceOf(TftMatchPreviewConflictError);
		expect(getTftMatchPreviewBatch(corruptToken, { now })).not.toBeNull();
	});

	test('fails safely after restart loss and can immediately fetch a replacement token', async () => {
		const first = await discoverTftMatchHistory({
			database,
			tournamentId: 'tournament-one',
			playerId: 'player-selected',
			config,
			gateway: createGateway(),
			now
		});
		clearTftMatchPreviewCacheForTests();

		await expect(
			resolveTftMatchPreviewForSave({
				database,
				token: first.token,
				matchId: 'VN2_MATCH_4',
				tournamentId: 'tournament-one',
				config,
				now
			})
		).rejects.toMatchObject({
			status: 409,
			operatorMessage: 'This TFT match preview expired. Fetch the match again.'
		});

		const replacement = await discoverTftMatchHistory({
			database,
			tournamentId: 'tournament-one',
			playerId: 'player-selected',
			config,
			gateway: createGateway(),
			now
		});
		expect(replacement.token).not.toBe(first.token);
		await expect(
			resolveTftMatchPreviewForSave({
				database,
				token: replacement.token,
				matchId: 'VN2_MATCH_4',
				tournamentId: 'tournament-one',
				config,
				now
			})
		).resolves.toMatchObject({ snapshot: { source: { matchId: 'VN2_MATCH_4' } } });
	});
});
