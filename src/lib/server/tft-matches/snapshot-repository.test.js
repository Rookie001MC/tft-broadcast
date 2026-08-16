import { createClient } from '@libsql/client';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { catalogSnapshots } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tftMatchSnapshots } from '../db/schema/tft-matches.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import { insertTftMatchSnapshot } from './snapshot-repository.js';

const fetchedAt = '2026-08-16T04:00:00.000Z';
const savedAt = new Date('2026-08-16T06:00:00.000Z');

/** @returns {import('./contract.js').CanonicalTftMatchSnapshot} */
function canonicalSnapshot() {
	return {
		contractVersion: 1,
		source: {
			provider: 'riot',
			region: 'VN2',
			matchId: 'VN2_MATCH_1',
			dataVersion: '6',
			fetchedAt
		},
		match: {
			completedAt: '2026-08-16T03:00:00.000Z',
			durationSeconds: 1800,
			gameVersion: 'Version 16.14',
			queueId: 1100,
			gameType: 'standard',
			setNumber: 17,
			setCoreName: 'TFTSet17'
		},
		participants: Array.from({ length: 8 }, (_, index) => ({
			puuid: index === 3 ? 'selected-puuid' : `puuid-${index + 1}`,
			riotId: index === 3 ? { gameName: 'Jeff', tagline: 'Jeef' } : null,
			placement: index + 1,
			level: 8,
			champions: [
				{
					externalId: `TFT17_Champion${index + 1}`,
					catalogChampionId: `champion-${index + 1}`,
					displayName: `Champion ${index + 1}`,
					iconPath: null,
					starLevel: 2,
					displayOrder: 0
				}
			]
		}))
	};
}

/** @param {Record<string, any>} [overrides] */
function source(overrides = {}) {
	return {
		snapshot: canonicalSnapshot(),
		tournamentId: 'tournament-one',
		selectedPlayerId: 'player-selected',
		selectedPuuid: 'selected-puuid',
		activeCatalogSnapshotId: 'catalog-active',
		riotGameName: 'Jeff',
		riotTagline: 'Jeef',
		region: 'VN2',
		...overrides
	};
}

const schemaStatements = [
	`CREATE TABLE catalog_snapshots (
		id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL,
		locale TEXT NOT NULL, patch_label TEXT NOT NULL, set_label TEXT, canonical_set_key TEXT,
		synced_at INTEGER NOT NULL, is_available INTEGER DEFAULT 0 NOT NULL, metadata_json TEXT NOT NULL
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
	)`,
	`CREATE TABLE tft_match_snapshots (
		id TEXT PRIMARY KEY NOT NULL, riot_match_id TEXT NOT NULL, region TEXT NOT NULL,
		tournament_id TEXT NOT NULL, selected_player_id TEXT NOT NULL,
		active_catalog_snapshot_id TEXT NOT NULL, contract_version INTEGER NOT NULL,
		payload_json TEXT NOT NULL, fetched_at INTEGER NOT NULL, saved_at INTEGER NOT NULL
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
		syncedAt: savedAt,
		isAvailable: true,
		metadataJson: '{}'
	});
	await database.insert(players).values({
		id: 'player-selected',
		riotId: 'Jeff#Jeef',
		riotIdKey: 'jeff#jeef',
		riotGameName: 'Jeff',
		riotTagline: 'Jeef',
		fullName: 'Selected Player',
		displayName: 'Player Two',
		createdAt: savedAt,
		updatedAt: savedAt
	});
	await database.insert(tournaments).values({
		id: 'tournament-one',
		name: 'Tournament One',
		slug: 'tournament-one',
		activeCatalogSnapshotId: 'catalog-active',
		createdAt: savedAt,
		updatedAt: savedAt
	});
	await database.insert(tournamentPlayers).values({
		tournamentId: 'tournament-one',
		playerId: 'player-selected',
		displayOrder: 0,
		notes: null
	});
}

describe('TFT match snapshot repository', () => {
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

	afterEach(() => client.close());

	test('revalidates and inserts the exact canonical snapshot with immutable bindings', async () => {
		const canonical = canonicalSnapshot();
		const id = await insertTftMatchSnapshot(database, source({ snapshot: canonical }), {
			id: 'snapshot-one',
			savedAt
		});

		expect(id).toBe('snapshot-one');
		const [row] = await database.select().from(tftMatchSnapshots);
		expect(row).toMatchObject({
			id: 'snapshot-one',
			riotMatchId: 'VN2_MATCH_1',
			region: 'VN2',
			tournamentId: 'tournament-one',
			selectedPlayerId: 'player-selected',
			activeCatalogSnapshotId: 'catalog-active',
			contractVersion: 1,
			fetchedAt: new Date(fetchedAt),
			savedAt
		});
		expect(JSON.parse(row.payloadJson)).toEqual(canonical);
	});

	/** @type {Array<[string, (database: any, value: any) => Promise<void> | void]>} */
	const mismatches = [
		[
			'invalid canonical payload',
			(_database, value) => {
				value.snapshot.participants[0].placement = 8;
			}
		],
		[
			'active catalog drift',
			async (database) => {
				await database.update(tournaments).set({ activeCatalogSnapshotId: null });
			}
		],
		[
			'roster drift',
			async (database) => {
				await database.delete(tournamentPlayers);
			}
		],
		[
			'Riot game-name drift',
			async (database) => {
				await database.update(players).set({ riotGameName: 'Changed' });
			}
		],
		[
			'Riot tagline drift',
			async (database) => {
				await database.update(players).set({ riotTagline: 'Changed' });
			}
		],
		[
			'source region mismatch',
			(_database, value) => {
				value.region = 'EUN1';
			}
		],
		[
			'selected PUUID mismatch',
			(_database, value) => {
				value.selectedPuuid = 'different-puuid';
			}
		],
		[
			'tournament mismatch',
			(_database, value) => {
				value.tournamentId = 'different-tournament';
			}
		],
		[
			'catalog binding mismatch',
			(_database, value) => {
				value.activeCatalogSnapshotId = 'different-catalog';
			}
		]
	];

	test.each(mismatches)('rejects %s before insertion', async (_name, mutate) => {
		const value = source();
		await mutate(database, value);

		await expect(
			insertTftMatchSnapshot(database, value, { id: 'rejected', savedAt })
		).rejects.toThrow();
		expect(
			await database
				.select()
				.from(tftMatchSnapshots)
				.where(and(eq(tftMatchSnapshots.id, 'rejected'), eq(tftMatchSnapshots.region, 'VN2')))
		).toEqual([]);
	});
});
