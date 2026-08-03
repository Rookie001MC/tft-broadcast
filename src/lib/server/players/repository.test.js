import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { players } from '../db/schema/players.js';
import { createPlayer } from './repository.js';

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
	)`
];

/** @param {ReturnType<typeof createClient>} client */
async function createSchema(client) {
	await client.execute('PRAGMA foreign_keys = ON');
	for (const statement of schemaStatements) await client.execute(statement);
}

describe('players repository', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		await createSchema(client);
		database = drizzle(client);
	});

	afterEach(() => client.close());

	test('creates a manual player with normalized Riot ID fields', async () => {
		const created = await createPlayer(database, {
			fullName: '  Nguyen Van A  ',
			displayName: '  Earl Grey  ',
			riotId: '  EarlGreyTeemo # sip  '
		});

		expect(created).toMatchObject({
			fullName: 'Nguyen Van A',
			displayName: 'Earl Grey',
			riotId: 'EarlGreyTeemo#sip',
			riotIdKey: 'earlgreyteemo#sip',
			riotGameName: 'EarlGreyTeemo',
			riotTagline: 'sip'
		});
	});

	test('keeps Riot fields nullable when no Riot ID is provided', async () => {
		const created = await createPlayer(database, {
			fullName: 'Player Two',
			displayName: 'Broadcast Two'
		});

		expect(created).toMatchObject({
			riotId: null,
			riotIdKey: null,
			riotGameName: null,
			riotTagline: null
		});
	});

	test('rejects invalid manual player names before writing', async () => {
		await expect(createPlayer(database, { fullName: '   ', displayName: 'Name' })).rejects.toThrow(
			'Full name and display name are required'
		);
		expect(await database.select().from(players)).toEqual([]);
	});

	test('enforces the Riot ID uniqueness key used by import previews', async () => {
		await createPlayer(database, {
			fullName: 'Player One',
			displayName: 'Winner One',
			riotId: 'PlayerOne#tag'
		});

		await expect(
			createPlayer(database, {
				fullName: 'Player Two',
				displayName: 'Runner Up',
				riotId: 'playerone#TAG'
			})
		).rejects.toThrow();
	});
});
