import { createClient } from '@libsql/client';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaEnvironment = vi.hoisted(() => ({
	root: `${process.env.TEMP ?? process.env.TMP ?? process.cwd()}/tft-winner-board-repository-${process.pid}`
}));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: mediaEnvironment.root } }));

import * as repository from './repository.js';

const PNG_A = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);
const PNG_B = Buffer.from([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
	0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1,
	255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

const schemaStatements = [
	`CREATE TABLE catalog_snapshots (
		id TEXT PRIMARY KEY NOT NULL,
		source TEXT NOT NULL,
		source_url TEXT NOT NULL,
		locale TEXT NOT NULL,
		patch_label TEXT NOT NULL,
		set_label TEXT,
		synced_at INTEGER NOT NULL,
		is_available INTEGER NOT NULL DEFAULT 0,
		metadata_json TEXT NOT NULL
	)`,
	`CREATE TABLE players (
		id TEXT PRIMARY KEY NOT NULL,
		riot_id TEXT,
		riot_id_key TEXT UNIQUE,
		riot_game_name TEXT,
		riot_tagline TEXT,
		full_name TEXT NOT NULL,
		display_name TEXT NOT NULL,
		image_path TEXT,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE tournaments (
		id TEXT PRIMARY KEY NOT NULL,
		name TEXT NOT NULL,
		slug TEXT NOT NULL UNIQUE,
		active_catalog_snapshot_id TEXT REFERENCES catalog_snapshots(id) ON DELETE SET NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE tournament_players (
		tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
		player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
		display_order INTEGER NOT NULL,
		notes TEXT,
		PRIMARY KEY (tournament_id, player_id)
	)`,
	`CREATE TABLE catalog_champions (
		id TEXT PRIMARY KEY NOT NULL,
		catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
		external_id TEXT NOT NULL,
		display_name TEXT NOT NULL,
		icon_path TEXT,
		tier INTEGER,
		metadata_json TEXT NOT NULL,
		UNIQUE (catalog_snapshot_id, external_id)
	)`,
	`CREATE TABLE catalog_augments (
		id TEXT PRIMARY KEY NOT NULL,
		catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
		external_id TEXT NOT NULL,
		display_name TEXT NOT NULL,
		icon_path TEXT,
		tier INTEGER,
		metadata_json TEXT NOT NULL,
		UNIQUE (catalog_snapshot_id, external_id)
	)`,
	`CREATE TABLE tft_match_snapshots (
		id TEXT PRIMARY KEY NOT NULL,
		riot_match_id TEXT NOT NULL,
		region TEXT NOT NULL,
		tournament_id TEXT NOT NULL,
		selected_player_id TEXT NOT NULL,
		active_catalog_snapshot_id TEXT NOT NULL,
		contract_version INTEGER NOT NULL,
		payload_json TEXT NOT NULL,
		fetched_at INTEGER NOT NULL,
		saved_at INTEGER NOT NULL
	)`,
	`CREATE TABLE winner_board_state (
		id TEXT PRIMARY KEY NOT NULL,
		tournament_id TEXT NOT NULL REFERENCES tournaments(id),
		winner_player_id TEXT NOT NULL REFERENCES players(id),
		title TEXT NOT NULL,
		source_tft_match_snapshot_id TEXT REFERENCES tft_match_snapshots(id) ON DELETE SET NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE winner_board_state_champions (
		id TEXT PRIMARY KEY NOT NULL,
		winner_board_state_id TEXT NOT NULL REFERENCES winner_board_state(id) ON DELETE CASCADE,
		catalog_champion_id TEXT NOT NULL REFERENCES catalog_champions(id) ON DELETE RESTRICT,
		star_level INTEGER,
		display_order INTEGER NOT NULL
	)`,
	`CREATE TABLE winner_board_state_augments (
		id TEXT PRIMARY KEY NOT NULL,
		winner_board_state_id TEXT NOT NULL REFERENCES winner_board_state(id) ON DELETE CASCADE,
		catalog_augment_id TEXT NOT NULL REFERENCES catalog_augments(id) ON DELETE RESTRICT,
		display_order INTEGER NOT NULL
	)`,
	`CREATE TABLE winner_board_publications (
		id TEXT PRIMARY KEY NOT NULL,
		source_state_updated_at INTEGER NOT NULL,
		graphic_version INTEGER NOT NULL UNIQUE,
		render_payload_json TEXT NOT NULL,
		media_directory TEXT NOT NULL UNIQUE,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE graphic_state (
		id TEXT PRIMARY KEY NOT NULL,
		published_publication_id TEXT REFERENCES winner_board_publications(id) ON DELETE SET NULL,
		version INTEGER NOT NULL DEFAULT 0,
		updated_at INTEGER NOT NULL
	)`
];

/** @param {ReturnType<typeof createClient>} client */
async function createSchema(client) {
	await client.execute('PRAGMA foreign_keys = ON');
	for (const statement of schemaStatements) await client.execute(statement);
}

/**
 * @param {ReturnType<typeof createClient>} client
 * @param {string} sql
 * @param {Array<string | number | null>} [args]
 */
async function execute(client, sql, args = []) {
	return client.execute({ sql, args });
}

/** @param {ReturnType<typeof createClient>} client */
async function seed(client) {
	const now = Date.parse('2026-08-02T00:00:00.000Z');
	await execute(
		client,
		`INSERT INTO catalog_snapshots
			(id, source, source_url, locale, patch_label, set_label, synced_at, is_available, metadata_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			'snapshot-active',
			'communitydragon',
			'https://example.test/active.json',
			'en_us',
			'16.15',
			'Set 15',
			now,
			1,
			'{}'
		]
	);
	await execute(
		client,
		`INSERT INTO players
			(id, riot_id, riot_id_key, riot_game_name, riot_tagline, full_name, display_name, image_path, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			'player-one',
			'Winner One#VN1',
			'winner one#vn1',
			'Winner One',
			'VN1',
			'Player One',
			'Winner One',
			null,
			now,
			now,
			'player-two',
			'Outsider#VN2',
			'outsider#vn2',
			'Outsider',
			'VN2',
			'Player Two',
			'Outsider',
			null,
			now,
			now
		]
	);
	await execute(
		client,
		`INSERT INTO tournaments
			(id, name, slug, active_catalog_snapshot_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		['tournament-one', 'Tournament One', 'tournament-one', 'snapshot-active', now, now]
	);
	await execute(
		client,
		`INSERT INTO tournament_players (tournament_id, player_id, display_order, notes)
		 VALUES (?, ?, ?, ?)`,
		['tournament-one', 'player-one', 0, null]
	);
	for (let index = 1; index <= 24; index += 1) {
		await execute(
			client,
			`INSERT INTO catalog_champions
				(id, catalog_snapshot_id, external_id, display_name, icon_path, tier, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				`champion-${index}`,
				'snapshot-active',
				`TFT15_Champion${index}`,
				`Champion ${index}`,
				null,
				index,
				'{}'
			]
		);
	}
	for (let index = 1; index <= 4; index += 1) {
		await execute(
			client,
			`INSERT INTO catalog_augments
				(id, catalog_snapshot_id, external_id, display_name, icon_path, tier, metadata_json)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				`augment-${index}`,
				'snapshot-active',
				`TFT15_Augment${index}`,
				`Augment ${index}`,
				null,
				index,
				'{}'
			]
		);
	}
}

function validInput() {
	return {
		tournamentId: 'tournament-one',
		winnerPlayerId: 'player-one',
		title: 'TFT Champion',
		champions: [
			{ catalogChampionId: 'champion-2', starLevel: 3 },
			{ catalogChampionId: 'champion-1', starLevel: null }
		],
		augmentIds: ['augment-2', 'augment-1']
	};
}

/** @returns {import('../tft-matches/snapshot-repository.js').TftMatchSnapshotSource} */
function validSourceSnapshot() {
	return {
		snapshot: {
			contractVersion: 1,
			source: {
				provider: 'riot',
				region: 'VN2',
				matchId: 'VN2_MATCH_1',
				dataVersion: '6',
				fetchedAt: '2026-08-16T04:00:00.000Z'
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
				puuid: index === 0 ? 'winner-one-puuid' : `other-puuid-${index}`,
				riotId: index === 0 ? { gameName: 'Winner One', tagline: 'VN1' } : null,
				placement: index + 1,
				level: 8,
				champions: [
					{
						externalId: `TFT15_Champion${index + 1}`,
						catalogChampionId: `champion-${index + 1}`,
						displayName: `Champion ${index + 1}`,
						iconPath: null,
						starLevel: 2,
						displayOrder: 0
					}
				]
			}))
		},
		tournamentId: 'tournament-one',
		selectedPlayerId: 'player-one',
		selectedPuuid: 'winner-one-puuid',
		activeCatalogSnapshotId: 'snapshot-active',
		riotGameName: 'Winner One',
		riotTagline: 'VN1',
		region: 'VN2'
	};
}

/**
 * @param {{ readPublicationMedia: (input: { mediaRoot: string, publicationId: string, filename: string }) => Promise<{ bytes: Buffer, mime: string }> }} mediaApi
 * @param {string} url
 */
async function readPublishedAsset(mediaApi, url) {
	const parts = new URL(url, 'https://broadcast.example').pathname.split('/');
	const publicationId = parts.at(-2);
	const filename = parts.at(-1);
	if (!publicationId || !filename) throw new Error('Publication URL is incomplete');
	return mediaApi.readPublicationMedia({
		mediaRoot: mediaEnvironment.root,
		publicationId,
		filename
	});
}

/** @param {any} database */
async function requirePublishedWinnerBoard(database) {
	const published = await repository.getPublishedWinnerBoard(database);
	if (!published) throw new Error('Expected a published winner board');
	return published;
}

/** @param {string | null | undefined} url */
function requirePublicationUrl(url) {
	if (!url) throw new Error('Expected a publication media URL');
	return url;
}

/** @param {ReturnType<typeof createClient>} client */
async function graphicRow(client) {
	return (await client.execute("SELECT * FROM graphic_state WHERE id = 'live'")).rows[0] ?? null;
}

/** @param {ReturnType<typeof createClient>} client */
function createMemoryDatabase(client) {
	/** @type {any} */
	const database = drizzle(client);
	database.transaction = async (/** @type {(transaction: any) => Promise<any>} */ callback) => {
		await client.execute('BEGIN IMMEDIATE');
		try {
			const result = await callback(database);
			await client.execute('COMMIT');
			return result;
		} catch (error) {
			await client.execute('ROLLBACK');
			throw error;
		}
	};
	return database;
}

describe('winner board singleton repository', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		await rm(mediaEnvironment.root, { recursive: true, force: true });
		client = createClient({ url: ':memory:' });
		await createSchema(client);
		await seed(client);
		database = createMemoryDatabase(client);
	});

	afterEach(async () => {
		client.close();
		await rm(mediaEnvironment.root, { recursive: true, force: true });
	});

	it('saves and replaces the installation-wide current state while hidden', async () => {
		const state = await repository.saveWinnerBoardState(database, validInput());
		expect(state).toMatchObject({
			id: 'current',
			title: 'TFT Champion',
			winner: { id: 'player-one', displayName: 'Winner One' },
			champions: [
				expect.objectContaining({ id: 'champion-2', displayOrder: 0, starLevel: 3 }),
				expect.objectContaining({ id: 'champion-1', displayOrder: 1, starLevel: null })
			],
			augments: [
				expect.objectContaining({ id: 'augment-2', displayOrder: 0 }),
				expect.objectContaining({ id: 'augment-1', displayOrder: 1 })
			]
		});

		const replacement = await repository.saveWinnerBoardState(database, {
			...validInput(),
			title: 'Corrected winner',
			champions: [{ catalogChampionId: 'champion-3', starLevel: 2 }],
			augmentIds: []
		});
		expect(replacement).toMatchObject({ id: 'current', title: 'Corrected winner' });
		expect(replacement.champions).toEqual([
			expect.objectContaining({ id: 'champion-3', displayOrder: 0, starLevel: 2 })
		]);
		expect(replacement.augments).toEqual([]);
		expect((await client.execute('SELECT id FROM winner_board_state')).rows).toEqual([
			{ id: 'current' }
		]);
		expect(await repository.getGraphicVersion(database)).toBe(0);
		expect(await repository.getPublishedWinnerBoard(database)).toBeNull();
		expect((await client.execute('SELECT * FROM tft_match_snapshots')).rows).toEqual([]);
		expect(
			(await client.execute('SELECT source_tft_match_snapshot_id FROM winner_board_state')).rows
		).toEqual([{ source_tft_match_snapshot_id: null }]);
	});

	it('atomically attaches an immutable snapshot while keeping edited Winner fields independent', async () => {
		await execute(
			client,
			'INSERT INTO tournament_players (tournament_id, player_id, display_order, notes) VALUES (?, ?, ?, ?)',
			['tournament-one', 'player-two', 1, null]
		);
		const saved = await repository.saveWinnerBoardState(database, {
			...validInput(),
			title: 'Operator edited title',
			winnerPlayerId: 'player-two',
			champions: [
				{ catalogChampionId: 'champion-3', starLevel: 1 },
				{ catalogChampionId: 'champion-2', starLevel: 3 }
			],
			augmentIds: ['augment-3'],
			sourceSnapshot: validSourceSnapshot()
		});

		expect(saved).toMatchObject({
			title: 'Operator edited title',
			winner: { id: 'player-two' },
			champions: [
				expect.objectContaining({ id: 'champion-3', starLevel: 1, displayOrder: 0 }),
				expect.objectContaining({ id: 'champion-2', starLevel: 3, displayOrder: 1 })
			],
			augments: [expect.objectContaining({ id: 'augment-3' })]
		});
		const snapshots = (await client.execute('SELECT * FROM tft_match_snapshots')).rows;
		expect(snapshots).toHaveLength(1);
		expect(JSON.parse(/** @type {string} */ (snapshots[0].payload_json))).toEqual(
			validSourceSnapshot().snapshot
		);
		expect(
			(await client.execute('SELECT source_tft_match_snapshot_id FROM winner_board_state')).rows[0]
				.source_tft_match_snapshot_id
		).toBe(snapshots[0].id);

		await repository.saveWinnerBoardState(database, validInput());
		expect(
			(await client.execute('SELECT source_tft_match_snapshot_id FROM winner_board_state')).rows
		).toEqual([{ source_tft_match_snapshot_id: null }]);
		expect((await client.execute('SELECT id FROM tft_match_snapshots')).rows).toHaveLength(1);

		await repository.resetWinnerBoardState(database);
		expect((await client.execute('SELECT id FROM tft_match_snapshots')).rows).toHaveLength(1);
	});

	it('rolls back both sides when hidden snapshot or Winner child insertion fails', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		const prior = await repository.getWinnerBoardState(database);
		const invalidSource = validSourceSnapshot();
		invalidSource.region = 'EUN1';

		await expect(
			repository.saveWinnerBoardState(database, {
				...validInput(),
				title: 'Must not persist',
				sourceSnapshot: invalidSource
			})
		).rejects.toThrow();
		expect(await repository.getWinnerBoardState(database)).toEqual(prior);
		expect((await client.execute('SELECT * FROM tft_match_snapshots')).rows).toEqual([]);

		await client.execute(`CREATE TRIGGER fail_winner_child BEFORE INSERT ON winner_board_state_champions
			WHEN NEW.catalog_champion_id = 'champion-3' BEGIN SELECT RAISE(ABORT, 'forced child failure'); END`);
		await expect(
			repository.saveWinnerBoardState(database, {
				...validInput(),
				champions: [{ catalogChampionId: 'champion-3', starLevel: 2 }],
				sourceSnapshot: validSourceSnapshot()
			})
		).rejects.toThrow();
		expect(await repository.getWinnerBoardState(database)).toEqual(prior);
		expect((await client.execute('SELECT * FROM tft_match_snapshots')).rows).toEqual([]);
	});

	it('atomically advances a live API-assisted save', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);
		const before = await graphicRow(client);

		const saved = await repository.saveWinnerBoardState(database, {
			...validInput(),
			title: 'Imported live update',
			sourceSnapshot: validSourceSnapshot()
		});

		expect(saved.title).toBe('Imported live update');
		expect((await client.execute('SELECT * FROM tft_match_snapshots')).rows).toHaveLength(1);
		expect((await graphicRow(client))?.published_publication_id).not.toBe(
			before?.published_publication_id
		);
		expect(await repository.getGraphicVersion(database)).toBe(2);
		expect(await repository.getPublishedWinnerBoard(database)).toMatchObject({
			title: 'Imported live update'
		});
	});

	it('rolls back a live snapshot failure and removes prepared media', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);
		const prior = await repository.getWinnerBoardState(database);
		const priorGraphic = await graphicRow(client);
		const priorDirectories = await readdir(path.join(mediaEnvironment.root, 'publications'));
		const invalidSource = validSourceSnapshot();
		invalidSource.selectedPuuid = 'missing-puuid';

		await expect(
			repository.saveWinnerBoardState(database, {
				...validInput(),
				title: 'Must roll back live',
				sourceSnapshot: invalidSource
			})
		).rejects.toThrow();

		expect(await repository.getWinnerBoardState(database)).toEqual(prior);
		expect(await graphicRow(client)).toEqual(priorGraphic);
		expect((await client.execute('SELECT * FROM tft_match_snapshots')).rows).toEqual([]);
		expect(await readdir(path.join(mediaEnvironment.root, 'publications'))).toEqual(
			priorDirectories
		);
	});

	it('rejects a fourth augment but accepts a large champion list', async () => {
		await expect(
			repository.saveWinnerBoardState(database, {
				...validInput(),
				augmentIds: ['augment-1', 'augment-2', 'augment-3', 'augment-4']
			})
		).rejects.toThrow('At most three augments are allowed');

		const champions = Array.from({ length: 20 }, (_, index) => ({
			catalogChampionId: `champion-${index + 1}`,
			starLevel: null
		}));
		const state = await repository.saveWinnerBoardState(database, {
			...validInput(),
			champions,
			augmentIds: ['augment-1', 'augment-2', 'augment-3']
		});
		expect(state.champions).toHaveLength(20);
		expect(state.augments).toHaveLength(3);
	});

	it('persists and publishes duplicate champion instances with independent stars', async () => {
		const input = {
			...validInput(),
			champions: [
				{ catalogChampionId: 'champion-2', starLevel: 1 },
				{ catalogChampionId: 'champion-2', starLevel: 3 },
				{ catalogChampionId: 'champion-1', starLevel: null }
			]
		};

		const saved = await repository.saveWinnerBoardState(database, input);
		expect(saved.champions).toEqual([
			expect.objectContaining({ id: 'champion-2', starLevel: 1, displayOrder: 0 }),
			expect.objectContaining({ id: 'champion-2', starLevel: 3, displayOrder: 1 }),
			expect.objectContaining({ id: 'champion-1', starLevel: null, displayOrder: 2 })
		]);

		await repository.setWinnerBoardLive(database, true);
		const published = await requirePublishedWinnerBoard(database);
		expect(published.champions).toEqual([
			expect.objectContaining({ id: 'champion-2', starLevel: 1, displayOrder: 0 }),
			expect.objectContaining({ id: 'champion-2', starLevel: 3, displayOrder: 1 }),
			expect.objectContaining({ id: 'champion-1', starLevel: null, displayOrder: 2 })
		]);
	});

	it('rejects duplicate augment IDs with the stable repository error', async () => {
		await expect(
			repository.saveWinnerBoardState(database, {
				...validInput(),
				augmentIds: ['augment-1', 'augment-1']
			})
		).rejects.toThrow('Augment IDs must be unique');
	});

	it('enables Live from persisted state and increments the graphic version once', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);

		const published = await requirePublishedWinnerBoard(database);
		expect(published).toMatchObject({ title: 'TFT Champion', winner: { id: 'player-one' } });
		expect((await graphicRow(client))?.published_publication_id).toBe(published.id);
		expect(await repository.getGraphicVersion(database)).toBe(1);
	});

	it('keeps published payload and media immutable when current sources change', async () => {
		const playerPath = 'player-images/player-one.png';
		const championPath = 'snapshot-active/champions/champion-2.png';
		const augmentPath = 'snapshot-active/augments/augment-2.png';
		await mkdir(path.join(mediaEnvironment.root, path.dirname(playerPath)), { recursive: true });
		await mkdir(path.join(mediaEnvironment.root, 'catalog-assets', path.dirname(championPath)), {
			recursive: true
		});
		await mkdir(path.join(mediaEnvironment.root, 'catalog-assets', path.dirname(augmentPath)), {
			recursive: true
		});
		await writeFile(path.join(mediaEnvironment.root, playerPath), PNG_A);
		await writeFile(path.join(mediaEnvironment.root, 'catalog-assets', championPath), PNG_A);
		await writeFile(path.join(mediaEnvironment.root, 'catalog-assets', augmentPath), PNG_A);
		await execute(client, 'UPDATE players SET image_path = ? WHERE id = ?', [
			playerPath,
			'player-one'
		]);
		await execute(client, 'UPDATE catalog_champions SET icon_path = ? WHERE id = ?', [
			`/media/catalog-assets/${championPath}`,
			'champion-2'
		]);
		await execute(client, 'UPDATE catalog_augments SET icon_path = ? WHERE id = ?', [
			`/media/catalog-assets/${augmentPath}`,
			'augment-2'
		]);

		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);
		const first = await requirePublishedWinnerBoard(database);
		expect(first).toMatchObject({
			winner: { imagePath: expect.stringContaining(`/publications/${first.id}/`) },
			champions: expect.arrayContaining([
				expect.objectContaining({
					id: 'champion-2',
					iconPath: expect.stringContaining(`/publications/${first.id}/`)
				})
			]),
			augments: expect.arrayContaining([
				expect.objectContaining({
					id: 'augment-2',
					iconPath: expect.stringContaining(`/publications/${first.id}/`)
				})
			])
		});
		const firstUrls = [
			requirePublicationUrl(first.winner.imagePath),
			requirePublicationUrl(first.champions[0]?.iconPath),
			requirePublicationUrl(first.augments[0]?.iconPath)
		];
		const mediaApi = await import('./publication-media.js');
		for (const url of firstUrls) {
			const asset = await readPublishedAsset(mediaApi, url);
			expect(asset).toEqual({ bytes: PNG_A, mime: 'image/png' });
		}
		const firstStoredJson = (
			await execute(
				client,
				'SELECT render_payload_json FROM winner_board_publications WHERE id = ?',
				[first.id]
			)
		).rows[0].render_payload_json;

		await execute(client, 'UPDATE players SET display_name = ? WHERE id = ?', [
			'Edited source player',
			'player-one'
		]);
		await execute(client, 'UPDATE catalog_champions SET display_name = ? WHERE id = ?', [
			'Edited source champion',
			'champion-2'
		]);
		await execute(client, 'UPDATE catalog_augments SET display_name = ? WHERE id = ?', [
			'Edited source augment',
			'augment-2'
		]);
		await writeFile(path.join(mediaEnvironment.root, playerPath), PNG_B);
		await writeFile(path.join(mediaEnvironment.root, 'catalog-assets', championPath), PNG_B);
		await writeFile(path.join(mediaEnvironment.root, 'catalog-assets', augmentPath), PNG_B);
		expect(await repository.getPublishedWinnerBoard(database)).toEqual(first);
		for (const url of firstUrls) {
			const asset = await readPublishedAsset(mediaApi, url);
			expect(asset.bytes).toEqual(PNG_A);
		}

		await repository.saveWinnerBoardState(database, { ...validInput(), title: 'Next champion' });
		const second = await requirePublishedWinnerBoard(database);
		expect(second.id).not.toBe(first.id);
		expect(second).toMatchObject({
			title: 'Next champion',
			winner: {
				displayName: 'Edited source player',
				imagePath: expect.stringContaining(`/publications/${second.id}/`)
			},
			champions: expect.arrayContaining([
				expect.objectContaining({
					displayName: 'Edited source champion',
					iconPath: expect.stringContaining(`/publications/${second.id}/`)
				})
			]),
			augments: expect.arrayContaining([
				expect.objectContaining({
					displayName: 'Edited source augment',
					iconPath: expect.stringContaining(`/publications/${second.id}/`)
				})
			])
		});
		const secondUrls = [
			requirePublicationUrl(second.winner.imagePath),
			requirePublicationUrl(second.champions[0]?.iconPath),
			requirePublicationUrl(second.augments[0]?.iconPath)
		];
		expect(secondUrls).not.toEqual(firstUrls);
		for (const url of secondUrls) {
			const asset = await readPublishedAsset(mediaApi, url);
			expect(asset).toEqual({ bytes: PNG_B, mime: 'image/png' });
		}
		expect(await repository.getGraphicVersion(database)).toBe(2);
		expect(
			(
				await execute(
					client,
					'SELECT render_payload_json FROM winner_board_publications WHERE id = ?',
					[first.id]
				)
			).rows[0].render_payload_json
		).toBe(firstStoredJson);
	});

	it('cleans newly prepared media when payload validation fails before the live transaction', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);
		const beforeDirectories = await readdir(path.join(mediaEnvironment.root, 'publications'));
		const beforeState = await repository.getWinnerBoardState(database);
		const beforeGraphic = await graphicRow(client);

		await expect(
			repository.saveWinnerBoardState(database, { ...validInput(), title: /** @type {any} */ (42) })
		).rejects.toThrow('Published winner board payload is invalid');

		expect(await readdir(path.join(mediaEnvironment.root, 'publications'))).toEqual(
			beforeDirectories
		);
		expect(await repository.getWinnerBoardState(database)).toEqual(beforeState);
		expect(await graphicRow(client)).toEqual(beforeGraphic);
	});

	it('rejects stored JSON whose payload ID does not match the referenced publication row', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);
		const publication = await requirePublishedWinnerBoard(database);
		const stored = JSON.parse(
			/** @type {string} */ (
				(
					await execute(
						client,
						'SELECT render_payload_json FROM winner_board_publications WHERE id = ?',
						[publication.id]
					)
				).rows[0].render_payload_json
			)
		);
		stored.id = '11111111-1111-4111-8111-111111111111';
		await execute(
			client,
			'UPDATE winner_board_publications SET render_payload_json = ? WHERE id = ?',
			[JSON.stringify(stored), publication.id]
		);

		await expect(repository.getPublishedWinnerBoard(database)).rejects.toThrow(
			'Published winner board payload is invalid'
		);
	});

	it('hides once and leaves the version unchanged for an already-hidden graphic', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);

		await expect(repository.setWinnerBoardLive(database, false)).resolves.toBe(true);
		expect(await repository.getPublishedWinnerBoard(database)).toBeNull();
		expect(await repository.getGraphicVersion(database)).toBe(2);
		await expect(repository.setWinnerBoardLive(database, false)).resolves.toBe(false);
		expect(await repository.getGraphicVersion(database)).toBe(2);
	});

	it('resets hidden state without creating a publication or changing the version', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.resetWinnerBoardState(database);

		expect(await repository.getWinnerBoardState(database)).toBeNull();
		expect(await repository.getPublishedWinnerBoard(database)).toBeNull();
		expect(await repository.getGraphicVersion(database)).toBe(0);
		expect((await client.execute('SELECT * FROM winner_board_publications')).rows).toEqual([]);
	});

	it('resets live state, clears the publication pointer, and increments once', async () => {
		await repository.saveWinnerBoardState(database, validInput());
		await repository.setWinnerBoardLive(database, true);
		await repository.resetWinnerBoardState(database);

		expect(await repository.getWinnerBoardState(database)).toBeNull();
		expect(await repository.getPublishedWinnerBoard(database)).toBeNull();
		expect((await graphicRow(client))?.published_publication_id).toBeNull();
		expect(await repository.getGraphicVersion(database)).toBe(2);
	});
});

const migrationPath = path.resolve('drizzle/0001_integrity_foundation.sql');

/** @param {ReturnType<typeof createClient>} client @param {string} filename */
async function applyMigrationFile(client, filename) {
	const sql = await readFile(filename, 'utf8');
	for (const statement of sql.split(/--> statement-breakpoint\s*/)) {
		if (statement.trim()) await client.execute(statement);
	}
}

/** @param {ReturnType<typeof createClient>} client */
async function seedLegacyParents(client) {
	const now = Date.parse('2026-08-02T00:00:00.000Z');
	await execute(
		client,
		`INSERT INTO catalog_snapshots
			(id, source, source_url, locale, patch_label, synced_at, is_available, metadata_json)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		['snapshot-active', 'communitydragon', 'https://example.test', 'en_us', '16.15', now, 1, '{}']
	);
	await execute(
		client,
		`INSERT INTO players
			(id, full_name, display_name, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		['player-one', 'Player One', 'Winner One', now, now]
	);
	await execute(
		client,
		`INSERT INTO tournaments
			(id, name, slug, active_catalog_snapshot_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		['tournament-one', 'Tournament One', 'tournament-one', 'snapshot-active', now, now]
	);
	await execute(
		client,
		`INSERT INTO catalog_champions
			(id, catalog_snapshot_id, external_id, display_name, metadata_json)
		 VALUES (?, ?, ?, ?, ?)`,
		['champion-one', 'snapshot-active', 'TFT15_ChampionOne', 'Champion One', '{}']
	);
	await execute(
		client,
		`INSERT INTO catalog_augments
			(id, catalog_snapshot_id, external_id, display_name, metadata_json)
		 VALUES (?, ?, ?, ?, ?)`,
		['augment-one', 'snapshot-active', 'TFT15_AugmentOne', 'Augment One', '{}']
	);
}

/**
 * @param {ReturnType<typeof createClient>} client
 * @param {{ id: string, title: string, status: string, updatedAt: number }} board
 */
async function seedLegacyBoard(client, board) {
	await execute(
		client,
		`INSERT INTO winner_boards
			(id, tournament_id, winner_player_id, title, status, created_at, updated_at, published_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			board.id,
			'tournament-one',
			'player-one',
			board.title,
			board.status,
			board.updatedAt - 1,
			board.updatedAt,
			board.status === 'published' ? board.updatedAt : null
		]
	);
}

describe('integrity foundation legacy migration', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		await applyMigrationFile(client, path.resolve('drizzle/0000_noisy_mesmero.sql'));
		await client.execute('PRAGMA foreign_keys = ON');
		await seedLegacyParents(client);
	});

	afterEach(() => client.close());

	it('migrates the live-referenced legacy board to current and clears Live', async () => {
		await seedLegacyBoard(client, {
			id: 'draft-newer',
			title: 'Newer draft',
			status: 'draft',
			updatedAt: 300
		});
		await seedLegacyBoard(client, {
			id: 'legacy-live',
			title: 'Referenced live board',
			status: 'published',
			updatedAt: 200
		});
		await execute(
			client,
			`INSERT INTO winner_board_champions
				(id, winner_board_id, catalog_champion_id, star_level, display_order)
			 VALUES (?, ?, ?, ?, ?)`,
			['legacy-champion', 'legacy-live', 'champion-one', 3, 0]
		);
		await execute(
			client,
			`INSERT INTO winner_board_augments
				(id, winner_board_id, catalog_augment_id, display_order)
			 VALUES (?, ?, ?, ?)`,
			['legacy-augment', 'legacy-live', 'augment-one', 0]
		);
		await execute(
			client,
			`INSERT INTO graphic_state (id, published_winner_board_id, version, updated_at)
			 VALUES (?, ?, ?, ?)`,
			['live', 'legacy-live', 7, 200]
		);

		await applyMigrationFile(client, migrationPath);

		expect((await client.execute('SELECT id, title FROM winner_board_state')).rows).toEqual([
			{ id: 'current', title: 'Referenced live board' }
		]);
		expect(
			(
				await client.execute(
					'SELECT catalog_champion_id, display_order FROM winner_board_state_champions'
				)
			).rows
		).toEqual([{ catalog_champion_id: 'champion-one', display_order: 0 }]);
		expect(
			(
				await client.execute(
					'SELECT catalog_augment_id, display_order FROM winner_board_state_augments'
				)
			).rows
		).toEqual([{ catalog_augment_id: 'augment-one', display_order: 0 }]);
		expect(
			(await client.execute('SELECT published_publication_id FROM graphic_state')).rows
		).toEqual([{ published_publication_id: null }]);
		expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
	});

	it('migrates only the most recently updated draft when no legacy board is live', async () => {
		await seedLegacyBoard(client, {
			id: 'draft-old',
			title: 'Old draft',
			status: 'draft',
			updatedAt: 100
		});
		await seedLegacyBoard(client, {
			id: 'draft-current',
			title: 'Most recent draft',
			status: 'draft',
			updatedAt: 300
		});
		await seedLegacyBoard(client, {
			id: 'hidden-newer',
			title: 'Hidden board',
			status: 'hidden',
			updatedAt: 400
		});
		await execute(
			client,
			`INSERT INTO winner_board_champions
				(id, winner_board_id, catalog_champion_id, star_level, display_order)
			 VALUES (?, ?, ?, ?, ?)`,
			['draft-champion', 'draft-current', 'champion-one', 2, 0]
		);
		await execute(
			client,
			`INSERT INTO graphic_state (id, published_winner_board_id, version, updated_at)
			 VALUES (?, ?, ?, ?)`,
			['live', null, 4, 300]
		);

		await applyMigrationFile(client, migrationPath);

		expect((await client.execute('SELECT id, title FROM winner_board_state')).rows).toEqual([
			{ id: 'current', title: 'Most recent draft' }
		]);
		expect(
			(await client.execute('SELECT COUNT(*) AS count FROM winner_board_state_champions')).rows
		).toEqual([{ count: 1 }]);
		expect(
			(await client.execute('SELECT published_publication_id FROM graphic_state')).rows
		).toEqual([{ published_publication_id: null }]);
		expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
	});
});
