import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import {
	graphicState,
	winnerBoardAugments,
	winnerBoardChampions,
	winnerBoards
} from '../db/schema/winner-boards.js';
import {
	getGraphicVersion,
	getPublishedWinnerBoard,
	hidePublishedBoard,
	publishWinnerBoard,
	saveDraftWinnerBoard
} from './repository.js';

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
	`CREATE TABLE winner_boards (
		id TEXT PRIMARY KEY NOT NULL,
		tournament_id TEXT NOT NULL REFERENCES tournaments(id),
		winner_player_id TEXT NOT NULL REFERENCES players(id),
		title TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'draft',
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		published_at INTEGER
	)`,
	`CREATE TABLE winner_board_champions (
		id TEXT PRIMARY KEY NOT NULL,
		winner_board_id TEXT NOT NULL REFERENCES winner_boards(id) ON DELETE CASCADE,
		catalog_champion_id TEXT NOT NULL REFERENCES catalog_champions(id) ON DELETE RESTRICT,
		star_level INTEGER,
		display_order INTEGER NOT NULL
	)`,
	`CREATE TABLE winner_board_augments (
		id TEXT PRIMARY KEY NOT NULL,
		winner_board_id TEXT NOT NULL REFERENCES winner_boards(id) ON DELETE CASCADE,
		catalog_augment_id TEXT NOT NULL REFERENCES catalog_augments(id) ON DELETE RESTRICT,
		display_order INTEGER NOT NULL
	)`,
	`CREATE TABLE graphic_state (
		id TEXT PRIMARY KEY NOT NULL,
		published_winner_board_id TEXT REFERENCES winner_boards(id) ON DELETE SET NULL,
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
 * The embedded libSQL `:memory:` driver closes the only backing connection
 * after its native transaction object commits or rolls back, which discards
 * the database. Keep the fixture on the client's connection while preserving
 * real SQLite BEGIN/COMMIT/ROLLBACK semantics.
 *
 * @param {ReturnType<typeof createClient>} client
 */
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

/** @param {ReturnType<typeof drizzle>} database */
async function seed(database) {
	const now = new Date('2026-08-02T00:00:00.000Z');
	await database.insert(catalogSnapshots).values([
		{
			id: 'snapshot-active',
			source: 'communitydragon',
			sourceUrl: 'https://example.test/active.json',
			locale: 'en_us',
			patchLabel: '16.15',
			setLabel: 'Set 15',
			syncedAt: now,
			isAvailable: true,
			metadataJson: '{}'
		},
		{
			id: 'snapshot-other',
			source: 'communitydragon',
			sourceUrl: 'https://example.test/other.json',
			locale: 'en_us',
			patchLabel: '16.14',
			setLabel: 'Set 15',
			syncedAt: now,
			isAvailable: true,
			metadataJson: '{}'
		},
		{
			id: 'snapshot-unavailable',
			source: 'communitydragon',
			sourceUrl: 'https://example.test/unavailable.json',
			locale: 'en_us',
			patchLabel: '16.16',
			setLabel: 'Set 15',
			syncedAt: now,
			isAvailable: false,
			metadataJson: '{}'
		}
	]);
	await database.insert(players).values([
		{
			id: 'player-one',
			riotId: 'Winner One#VN1',
			riotIdKey: 'winner one#vn1',
			riotGameName: 'Winner One',
			riotTagline: 'VN1',
			fullName: 'Player One',
			displayName: 'Winner One',
			imagePath: 'player-images/player-one.png',
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'player-two',
			riotId: 'Outsider#VN2',
			riotIdKey: 'outsider#vn2',
			riotGameName: 'Outsider',
			riotTagline: 'VN2',
			fullName: 'Player Two',
			displayName: 'Outsider',
			imagePath: null,
			createdAt: now,
			updatedAt: now
		}
	]);
	await database.insert(tournaments).values([
		{
			id: 'tournament-one',
			name: 'Tournament One',
			slug: 'tournament-one',
			activeCatalogSnapshotId: 'snapshot-active',
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'tournament-no-catalog',
			name: 'Tournament Without Catalog',
			slug: 'tournament-no-catalog',
			activeCatalogSnapshotId: null,
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'tournament-two',
			name: 'Tournament Two',
			slug: 'tournament-two',
			activeCatalogSnapshotId: 'snapshot-active',
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'tournament-unavailable-catalog',
			name: 'Tournament With Unavailable Catalog',
			slug: 'tournament-unavailable-catalog',
			activeCatalogSnapshotId: 'snapshot-unavailable',
			createdAt: now,
			updatedAt: now
		}
	]);
	await database.insert(tournamentPlayers).values([
		{
			tournamentId: 'tournament-one',
			playerId: 'player-one',
			displayOrder: 0,
			notes: null
		},
		{
			tournamentId: 'tournament-two',
			playerId: 'player-one',
			displayOrder: 0,
			notes: null
		}
	]);
	await database.insert(catalogChampions).values([
		{
			id: 'champion-one',
			catalogSnapshotId: 'snapshot-active',
			externalId: 'TFT15_ChampionOne',
			displayName: 'Champion One',
			iconPath: 'https://example.test/champion-one.png',
			tier: 1,
			metadataJson: '{}'
		},
		{
			id: 'champion-two',
			catalogSnapshotId: 'snapshot-active',
			externalId: 'TFT15_ChampionTwo',
			displayName: 'Champion Two',
			iconPath: 'https://example.test/champion-two.png',
			tier: 2,
			metadataJson: '{}'
		},
		{
			id: 'champion-other',
			catalogSnapshotId: 'snapshot-other',
			externalId: 'TFT15_ChampionOther',
			displayName: 'Champion Other',
			iconPath: null,
			tier: 3,
			metadataJson: '{}'
		}
	]);
	await database.insert(catalogAugments).values([
		{
			id: 'augment-one',
			catalogSnapshotId: 'snapshot-active',
			externalId: 'TFT15_AugmentOne',
			displayName: 'Augment One',
			iconPath: 'https://example.test/augment-one.png',
			tier: 1,
			metadataJson: '{}'
		},
		{
			id: 'augment-two',
			catalogSnapshotId: 'snapshot-active',
			externalId: 'TFT15_AugmentTwo',
			displayName: 'Augment Two',
			iconPath: 'https://example.test/augment-two.png',
			tier: 2,
			metadataJson: '{}'
		},
		{
			id: 'augment-other',
			catalogSnapshotId: 'snapshot-other',
			externalId: 'TFT15_AugmentOther',
			displayName: 'Augment Other',
			iconPath: null,
			tier: 3,
			metadataJson: '{}'
		}
	]);
}

function validInput() {
	return {
		boardId: null,
		tournamentId: 'tournament-one',
		winnerPlayerId: 'player-one',
		title: 'TFT Champion',
		champions: [
			{ catalogChampionId: 'champion-two', starLevel: 3 },
			{ catalogChampionId: 'champion-one', starLevel: null }
		],
		augmentIds: ['augment-two', 'augment-one']
	};
}

describe('winner board repository', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		await createSchema(client);
		database = createMemoryDatabase(client);
		await seed(database);
	});

	afterEach(() => client.close());

	it('rejects a winner outside the selected tournament roster with the exact error', async () => {
		await expect(
			saveDraftWinnerBoard(database, { ...validInput(), winnerPlayerId: 'player-two' })
		).rejects.toThrow('Winner must belong to tournament roster');
	});

	it('rejects a champion outside the tournament active catalog with the exact error', async () => {
		await expect(
			saveDraftWinnerBoard(database, {
				...validInput(),
				champions: [{ catalogChampionId: 'champion-other', starLevel: 2 }]
			})
		).rejects.toThrow('Champion does not belong to active catalog');
	});

	it('rejects an augment outside the tournament active catalog with the exact error', async () => {
		await expect(
			saveDraftWinnerBoard(database, { ...validInput(), augmentIds: ['augment-other'] })
		).rejects.toThrow('Augment does not belong to active catalog');
	});

	it.each([
		['Tournament was not found', { tournamentId: 'missing' }],
		['Tournament has no active catalog', { tournamentId: 'tournament-no-catalog' }],
		['Tournament has no active catalog', { tournamentId: 'tournament-unavailable-catalog' }],
		['At least one champion is required', { champions: [] }],
		[
			'Champion IDs must be unique',
			{
				champions: [
					{ catalogChampionId: 'champion-one', starLevel: 1 },
					{ catalogChampionId: 'champion-one', starLevel: 2 }
				]
			}
		],
		['Augment IDs must be unique', { augmentIds: ['augment-one', 'augment-one'] }],
		[
			'Star level must be between 1 and 3',
			{ champions: [{ catalogChampionId: 'champion-one', starLevel: 4 }] }
		]
	])('validates draft input before writing: %s', async (message, override) => {
		await expect(saveDraftWinnerBoard(database, { ...validInput(), ...override })).rejects.toThrow(
			message
		);
		expect(await database.select().from(winnerBoards)).toEqual([]);
	});

	it('preserves submitted child order and replaces a draft transactionally', async () => {
		const created = await saveDraftWinnerBoard(database, validInput());
		expect(created).toMatchObject({
			title: 'TFT Champion',
			winner: {
				id: 'player-one',
				displayName: 'Winner One',
				riotId: 'Winner One#VN1',
				imagePath: 'player-images/player-one.png'
			},
			champions: [
				{
					id: 'champion-two',
					displayName: 'Champion Two',
					iconPath: 'https://example.test/champion-two.png',
					starLevel: 3,
					displayOrder: 0
				},
				{
					id: 'champion-one',
					displayName: 'Champion One',
					iconPath: 'https://example.test/champion-one.png',
					starLevel: null,
					displayOrder: 1
				}
			],
			augments: [
				{
					id: 'augment-two',
					displayName: 'Augment Two',
					iconPath: 'https://example.test/augment-two.png',
					displayOrder: 0
				},
				{
					id: 'augment-one',
					displayName: 'Augment One',
					iconPath: 'https://example.test/augment-one.png',
					displayOrder: 1
				}
			]
		});

		const replacement = await saveDraftWinnerBoard(database, {
			...validInput(),
			boardId: created.id,
			title: 'Replacement',
			champions: [{ catalogChampionId: 'champion-one', starLevel: 2 }],
			augmentIds: []
		});

		expect(replacement.id).toBe(created.id);
		expect(replacement.title).toBe('Replacement');
		expect(replacement.champions).toEqual([
			{
				id: 'champion-one',
				displayName: 'Champion One',
				iconPath: 'https://example.test/champion-one.png',
				starLevel: 2,
				displayOrder: 0
			}
		]);
		expect(replacement.augments).toEqual([]);
		expect(await database.select().from(winnerBoards)).toHaveLength(1);
		expect(await database.select().from(winnerBoardChampions)).toHaveLength(1);
		expect(await database.select().from(winnerBoardAugments)).toEqual([]);
	});

	it('never updates a published board', async () => {
		const board = await saveDraftWinnerBoard(database, validInput());
		await publishWinnerBoard(database, board.id);

		await expect(
			saveDraftWinnerBoard(database, { ...validInput(), boardId: board.id, title: 'Changed' })
		).rejects.toThrow('Published winner board cannot be edited');
		const [stored] = await database
			.select()
			.from(winnerBoards)
			.where(eq(winnerBoards.id, board.id));
		expect(stored.title).toBe('TFT Champion');
	});

	it('does not let a scoped draft ID update a board from another tournament', async () => {
		const board = await saveDraftWinnerBoard(database, validInput());

		await expect(
			saveDraftWinnerBoard(database, {
				...validInput(),
				boardId: board.id,
				tournamentId: 'tournament-two',
				title: 'Cross-scope change'
			})
		).rejects.toThrow('Winner board does not belong to tournament');
		const [stored] = await database
			.select()
			.from(winnerBoards)
			.where(eq(winnerBoards.id, board.id));
		expect(stored.title).toBe('TFT Champion');
		expect(stored.tournamentId).toBe('tournament-one');
	});

	it('publishes a draft atomically, hides the old live board, and increments once', async () => {
		const oldBoard = await saveDraftWinnerBoard(database, validInput());
		await publishWinnerBoard(database, oldBoard.id);
		const newBoard = await saveDraftWinnerBoard(database, {
			...validInput(),
			title: 'New Winner',
			champions: [{ catalogChampionId: 'champion-one', starLevel: 2 }],
			augmentIds: ['augment-one']
		});

		const published = await publishWinnerBoard(database, newBoard.id);

		expect(published).toEqual(await getPublishedWinnerBoard(database));
		expect(published).toMatchObject({
			id: newBoard.id,
			title: 'New Winner',
			tournamentId: 'tournament-one',
			winner: {
				id: 'player-one',
				displayName: 'Winner One',
				riotId: 'Winner One#VN1',
				imagePath: 'player-images/player-one.png'
			},
			champions: [
				{
					id: 'champion-one',
					displayName: 'Champion One',
					iconPath: 'https://example.test/champion-one.png',
					starLevel: 2,
					displayOrder: 0
				}
			],
			augments: [
				{
					id: 'augment-one',
					displayName: 'Augment One',
					iconPath: 'https://example.test/augment-one.png',
					displayOrder: 0
				}
			]
		});
		expect(published.publishedAt).toBeInstanceOf(Date);
		const boards = await database.select().from(winnerBoards).orderBy(asc(winnerBoards.createdAt));
		expect(boards.find(({ id }) => id === oldBoard.id)?.status).toBe('hidden');
		expect(boards.find(({ id }) => id === newBoard.id)?.status).toBe('published');
		expect(await database.select().from(graphicState)).toMatchObject([
			{ id: 'live', publishedWinnerBoardId: newBoard.id, version: 2 }
		]);
		expect(await getGraphicVersion(database)).toBe(2);
	});

	it('rolls back a failed publish without disturbing the current live board or version', async () => {
		const live = await saveDraftWinnerBoard(database, validInput());
		await publishWinnerBoard(database, live.id);

		await expect(publishWinnerBoard(database, 'missing-board')).rejects.toThrow(
			'Winner board was not found'
		);

		expect((await getPublishedWinnerBoard(database))?.id).toBe(live.id);
		expect(await getGraphicVersion(database)).toBe(1);
		expect(await database.select().from(graphicState)).toMatchObject([
			{ publishedWinnerBoardId: live.id, version: 1 }
		]);
	});

	it('hides the pointed live board once and repeated hides are idempotent', async () => {
		expect(await getGraphicVersion(database)).toBe(0);
		expect(await getPublishedWinnerBoard(database)).toBeNull();
		const live = await saveDraftWinnerBoard(database, validInput());
		await publishWinnerBoard(database, live.id);

		expect(await hidePublishedBoard(database)).toBe(true);
		expect(await getPublishedWinnerBoard(database)).toBeNull();
		expect(await getGraphicVersion(database)).toBe(2);
		const [hidden] = await database.select().from(winnerBoards).where(eq(winnerBoards.id, live.id));
		expect(hidden.status).toBe('hidden');
		expect(await database.select().from(graphicState)).toMatchObject([
			{ publishedWinnerBoardId: null, version: 2 }
		]);

		expect(await hidePublishedBoard(database)).toBe(false);
		expect(await getGraphicVersion(database)).toBe(2);
	});
});
