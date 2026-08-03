import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { players } from '../db/schema/players.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import {
	addRosterPlayers,
	createTournament,
	moveRosterPlayer,
	removeRosterPlayer
} from './repository.js';

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

	test('creates a tournament with a slug derived from its name', async () => {
		const created = await createTournament(database, { name: '  Weekend Finals  ' });
		expect(created).toMatchObject({ name: 'Weekend Finals', slug: 'weekend-finals' });
	});

	test('batch adds roster players once and ignores existing composite-key rows', async () => {
		const added = await addRosterPlayers(database, {
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
		await removeRosterPlayer(database, { tournamentId: 'tournament-one', playerId: 'player-two' });

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
		await moveRosterPlayer(database, {
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
			removeRosterPlayer(database, { tournamentId: 'missing', playerId: 'player-one' })
		).rejects.toThrow('Tournament was not found');
		await expect(
			moveRosterPlayer(database, {
				tournamentId: 'missing',
				playerId: 'player-one',
				displayOrder: 0
			})
		).rejects.toThrow('Tournament was not found');
	});
});
