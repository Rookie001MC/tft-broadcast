import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { players } from '../db/schema/players.js';

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

async function maintenanceApi() {
	let api;
	try {
		api = await import('./maintenance.js');
	} catch (error) {
		expect.fail(
			`winner-board maintenance must be exposed from maintenance.js: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	expect(api.inspectSavedStateDependency).toBeTypeOf('function');
	expect(api.resetStateAndRun).toBeTypeOf('function');
	return /** @type {{ inspectSavedStateDependency: (...args: any[]) => Promise<any>, resetStateAndRun: (...args: any[]) => Promise<any> }} */ (
		api
	);
}

describe('winner-board destructive maintenance', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		await createSchema(client);
		database = createMemoryDatabase(client);
		const timestamp = Date.parse('2026-08-08T00:00:00.000Z');
		await client.batch([
			{
				sql: 'INSERT INTO players (id, full_name, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
				args: ['player-one', 'Player One', 'Winner One', timestamp, timestamp]
			},
			{
				sql: 'INSERT INTO tournaments (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
				args: ['tournament-one', 'Tournament One', 'tournament-one', timestamp, timestamp]
			},
			{
				sql: 'INSERT INTO winner_board_publications (id, source_state_updated_at, graphic_version, render_payload_json, media_directory, created_at) VALUES (?, ?, ?, ?, ?, ?)',
				args: [
					'publication-one',
					timestamp,
					1,
					'{}',
					'winner-publications/publication-one',
					timestamp
				]
			},
			{
				sql: 'INSERT INTO graphic_state (id, published_publication_id, version, updated_at) VALUES (?, ?, ?, ?)',
				args: ['live', 'publication-one', 1, timestamp]
			},
			{
				sql: 'INSERT INTO winner_board_state (id, tournament_id, winner_player_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
				args: ['current', 'tournament-one', 'player-one', 'Winner', timestamp, timestamp]
			}
		]);
	});

	afterEach(() => client.close());

	test('reports a safe saved-state dependency without leaking publication payloads', async () => {
		const { inspectSavedStateDependency } = await maintenanceApi();

		await expect(
			inspectSavedStateDependency(database, { kind: 'player', id: 'player-one' })
		).resolves.toMatchObject({ label: 'Winner One' });
		await expect(
			inspectSavedStateDependency(database, { kind: 'player', id: 'unrelated-player' })
		).resolves.toBeNull();
	});

	test('atomically clears saved/live state before running a confirmed destructive operation', async () => {
		const { resetStateAndRun } = await maintenanceApi();

		await expect(
			resetStateAndRun(database, {
				target: { kind: 'player', id: 'player-one' },
				operation: (transaction) => transaction.delete(players).where(eq(players.id, 'player-one'))
			})
		).resolves.toMatchObject({ kind: 'reset_complete' });

		expect((await client.execute('SELECT * FROM winner_board_state')).rows).toEqual([]);
		expect(
			(await client.execute('SELECT published_publication_id FROM graphic_state')).rows
		).toEqual([{ published_publication_id: null }]);
		expect((await client.execute('SELECT id FROM winner_board_publications')).rows).toEqual([
			{ id: 'publication-one' }
		]);
		expect(await database.select().from(players)).toEqual([]);
	});

	test('rolls state, live pointer, and target record back when the operation fails', async () => {
		const { resetStateAndRun } = await maintenanceApi();

		await expect(
			resetStateAndRun(database, {
				target: { kind: 'player', id: 'player-one' },
				operation: async (transaction) => {
					await transaction.delete(players).where(eq(players.id, 'player-one'));
					throw new Error('destructive operation failed');
				}
			})
		).rejects.toThrow('destructive operation failed');

		expect((await client.execute('SELECT id FROM winner_board_state')).rows).toEqual([
			{ id: 'current' }
		]);
		expect(
			(await client.execute('SELECT published_publication_id FROM graphic_state')).rows
		).toEqual([{ published_publication_id: 'publication-one' }]);
		expect((await client.execute('SELECT id FROM winner_board_publications')).rows).toEqual([
			{ id: 'publication-one' }
		]);
		expect(await database.select().from(players)).toHaveLength(1);
	});
});
