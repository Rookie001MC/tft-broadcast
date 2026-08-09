import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { players } from '../db/schema/players.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import * as tournamentRepository from './repository.js';

const schemaStatements = [
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
		active_catalog_snapshot_id TEXT,
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
		version INTEGER DEFAULT 0 NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE TABLE player_import_previews (
		token TEXT PRIMARY KEY NOT NULL,
		staged_path TEXT NOT NULL,
		sha256 TEXT NOT NULL,
		preview_json TEXT NOT NULL,
		status TEXT DEFAULT 'previewed' NOT NULL,
		expires_at INTEGER NOT NULL,
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE winner_board_state (
		id TEXT PRIMARY KEY NOT NULL,
		tournament_id TEXT NOT NULL REFERENCES tournaments(id),
		winner_player_id TEXT NOT NULL REFERENCES players(id),
		title TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`
];

/** @param {ReturnType<typeof createClient>} client */
async function createSchema(client) {
	await client.execute('PRAGMA foreign_keys = ON');
	for (const statement of schemaStatements) await client.execute(statement);
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

/** @param {unknown} value @param {string} name */
function requiredFunction(value, name) {
	expect(value, `${name} must be a public repository function`).toBeTypeOf('function');
	return /** @type {(...args: any[]) => Promise<any>} */ (value);
}

/** @param {ReturnType<typeof drizzle>} database */
async function seed(database) {
	const now = new Date('2026-08-02T00:00:00.000Z');
	await database.insert(players).values([
		{
			id: 'player-one',
			fullName: 'Player One',
			displayName: 'Winner One',
			imagePath: null,
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'player-two',
			fullName: 'Player Two',
			displayName: 'Runner Up',
			imagePath: null,
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'player-three',
			fullName: 'Player Three',
			displayName: 'Third Place',
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
			activeCatalogSnapshotId: null,
			createdAt: now,
			updatedAt: now
		},
		{
			id: 'tournament-two',
			name: 'Tournament Two',
			slug: 'tournament-two',
			activeCatalogSnapshotId: null,
			createdAt: now,
			updatedAt: now
		}
	]);
	await database.insert(tournamentPlayers).values([
		{ tournamentId: 'tournament-one', playerId: 'player-one', displayOrder: 0, notes: null },
		{ tournamentId: 'tournament-two', playerId: 'player-one', displayOrder: 0, notes: null }
	]);
}

describe('tournaments repository', () => {
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

	test('loads singleton live and import state without a legacy tournament drafts field', async () => {
		const publicationId = '11111111-1111-4111-8111-111111111111';
		const liveBoard = {
			id: publicationId,
			title: 'Live champion',
			tournamentId: 'tournament-one',
			winner: {
				id: 'player-one',
				displayName: 'Winner One',
				riotId: null,
				imagePath: null
			},
			champions: [
				{
					id: 'champion-one',
					displayName: 'Champion One',
					iconPath: null,
					starLevel: null,
					displayOrder: 0
				}
			],
			augments: []
		};
		const importPreview = { rows: [{ displayName: 'Imported Player' }] };
		const now = new Date('2026-08-09T00:00:00.000Z').getTime();
		await client.execute({
			sql: 'INSERT INTO winner_board_publications (id, source_state_updated_at, graphic_version, render_payload_json, media_directory, created_at) VALUES (?, ?, ?, ?, ?, ?)',
			args: [publicationId, now, 1, JSON.stringify(liveBoard), `publications/${publicationId}`, now]
		});
		await client.execute({
			sql: 'INSERT INTO graphic_state (id, published_publication_id, version, updated_at) VALUES (?, ?, ?, ?)',
			args: ['live', publicationId, 1, now]
		});
		await client.execute({
			sql: 'INSERT INTO player_import_previews (token, staged_path, sha256, preview_json, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
			args: [
				'preview-token',
				'staged.csv',
				'sha256',
				JSON.stringify(importPreview),
				'previewed',
				now,
				now
			]
		});

		const data = await tournamentRepository.loadTournamentAdminData(database, 'tournament-one');

		expect(data).not.toHaveProperty('drafts');
		expect(data.liveBoard).toEqual(liveBoard);
		expect(data.importPreview).toMatchObject({
			token: 'preview-token',
			status: 'previewed',
			preview: importPreview
		});
	});

	test('creates a tournament with a slug derived from its name', async () => {
		const created = await tournamentRepository.createTournament(database, {
			name: '  Weekend Finals  '
		});
		expect(created).toMatchObject({ name: 'Weekend Finals', slug: 'weekend-finals' });
	});

	test('batch adds roster players once and ignores existing composite-key rows', async () => {
		const added = await tournamentRepository.addRosterPlayers(database, {
			tournamentId: 'tournament-one',
			playerIds: ['player-one', 'player-two', 'player-two', 'player-three']
		});

		expect(added).toBe(2);
		expect(
			await database
				.select({
					playerId: tournamentPlayers.playerId,
					displayOrder: tournamentPlayers.displayOrder
				})
				.from(tournamentPlayers)
				.where(eq(tournamentPlayers.tournamentId, 'tournament-one'))
				.orderBy(asc(tournamentPlayers.displayOrder), asc(tournamentPlayers.playerId))
		).toEqual([
			{ playerId: 'player-one', displayOrder: 0 },
			{ playerId: 'player-two', displayOrder: 1 },
			{ playerId: 'player-three', displayOrder: 2 }
		]);
	});

	test('removes a roster player inside the selected tournament and reindexes contiguous order', async () => {
		await database.insert(tournamentPlayers).values([
			{ tournamentId: 'tournament-one', playerId: 'player-two', displayOrder: 1, notes: null },
			{ tournamentId: 'tournament-one', playerId: 'player-three', displayOrder: 2, notes: null }
		]);
		await tournamentRepository.removeRosterPlayer(database, {
			tournamentId: 'tournament-one',
			playerId: 'player-two'
		});

		expect(
			await database
				.select({
					playerId: tournamentPlayers.playerId,
					displayOrder: tournamentPlayers.displayOrder
				})
				.from(tournamentPlayers)
				.where(eq(tournamentPlayers.tournamentId, 'tournament-one'))
				.orderBy(asc(tournamentPlayers.displayOrder), asc(tournamentPlayers.playerId))
		).toEqual([
			{ playerId: 'player-one', displayOrder: 0 },
			{ playerId: 'player-three', displayOrder: 1 }
		]);
	});

	test('moves a roster player transactionally and rewrites contiguous display order values', async () => {
		await database.insert(tournamentPlayers).values([
			{ tournamentId: 'tournament-one', playerId: 'player-two', displayOrder: 1, notes: null },
			{ tournamentId: 'tournament-one', playerId: 'player-three', displayOrder: 2, notes: null }
		]);
		await tournamentRepository.moveRosterPlayer(database, {
			tournamentId: 'tournament-one',
			playerId: 'player-three',
			displayOrder: 0
		});

		expect(
			await database
				.select({
					playerId: tournamentPlayers.playerId,
					displayOrder: tournamentPlayers.displayOrder
				})
				.from(tournamentPlayers)
				.where(eq(tournamentPlayers.tournamentId, 'tournament-one'))
				.orderBy(asc(tournamentPlayers.displayOrder), asc(tournamentPlayers.playerId))
		).toEqual([
			{ playerId: 'player-three', displayOrder: 0 },
			{ playerId: 'player-one', displayOrder: 1 },
			{ playerId: 'player-two', displayOrder: 2 }
		]);
	});

	test('rejects remove and move operations when the selected tournament is missing', async () => {
		await expect(
			tournamentRepository.removeRosterPlayer(database, {
				tournamentId: 'missing',
				playerId: 'player-one'
			})
		).rejects.toThrow('Tournament was not found');
		await expect(
			tournamentRepository.moveRosterPlayer(database, {
				tournamentId: 'missing',
				playerId: 'player-one',
				displayOrder: 0
			})
		).rejects.toThrow('Tournament was not found');
	});

	test('renames a tournament and normalizes its operator-supplied slug', async () => {
		const updateTournament = requiredFunction(
			tournamentRepository.updateTournament,
			'updateTournament'
		);

		const updated = await updateTournament(database, {
			tournamentId: 'tournament-one',
			name: '  Unitour Grand Final  ',
			slug: ' Unitour GRAND Final !!! '
		});

		expect(updated).toMatchObject({
			id: 'tournament-one',
			name: 'Unitour Grand Final',
			slug: 'unitour-grand-final'
		});
	});

	test('rejects a normalized tournament slug collision without changing either record', async () => {
		const updateTournament = requiredFunction(
			tournamentRepository.updateTournament,
			'updateTournament'
		);

		await expect(
			updateTournament(database, {
				tournamentId: 'tournament-one',
				name: 'Collision Attempt',
				slug: ' TOURNAMENT TWO '
			})
		).rejects.toThrow();
		expect(await database.select().from(tournaments).orderBy(asc(tournaments.id))).toMatchObject([
			{ id: 'tournament-one', name: 'Tournament One', slug: 'tournament-one' },
			{ id: 'tournament-two', name: 'Tournament Two', slug: 'tournament-two' }
		]);
	});

	test('deletes an ordinary tournament and its roster without resetting saved state', async () => {
		const deleteTournament = requiredFunction(
			tournamentRepository.deleteTournament,
			'deleteTournament'
		);

		await expect(
			deleteTournament(database, { tournamentId: 'tournament-one', confirmReset: false })
		).resolves.toMatchObject({ deleted: true, reset: false });
		expect(
			await database.select().from(tournaments).where(eq(tournaments.id, 'tournament-one'))
		).toEqual([]);
		expect(
			await database
				.select()
				.from(tournamentPlayers)
				.where(eq(tournamentPlayers.tournamentId, 'tournament-one'))
		).toEqual([]);
	});

	test('requires confirmation before resetting state and deleting its tournament', async () => {
		const now = new Date('2026-08-08T00:00:00.000Z');
		await client.execute({
			sql: 'INSERT INTO winner_board_state (id, tournament_id, winner_player_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			args: ['current', 'tournament-one', 'player-one', 'Winner', now.getTime(), now.getTime()]
		});
		const deleteTournament = requiredFunction(
			tournamentRepository.deleteTournament,
			'deleteTournament'
		);

		await expect(
			deleteTournament(database, { tournamentId: 'tournament-one', confirmReset: false })
		).resolves.toMatchObject({ kind: 'reset_required', label: 'Tournament One' });
		expect(
			await database.select().from(tournaments).where(eq(tournaments.id, 'tournament-one'))
		).toHaveLength(1);

		await expect(
			deleteTournament(database, { tournamentId: 'tournament-one', confirmReset: true })
		).resolves.toMatchObject({ deleted: true, reset: true });
		expect((await client.execute('SELECT * FROM winner_board_state')).rows).toEqual([]);
		expect(
			await database.select().from(tournaments).where(eq(tournaments.id, 'tournament-one'))
		).toEqual([]);
	});
});
