import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { players } from '../db/schema/players.js';
import * as playerRepository from './repository.js';

const controlledFilesystem = vi.hoisted(() => ({ failManagedWrite: false }));

vi.mock('node:fs/promises', async () => {
	const actual = await vi.importActual('node:fs/promises');
	return {
		...actual,
		writeFile: async (...args) => {
			if (controlledFilesystem.failManagedWrite) {
				throw Object.assign(new Error('controlled managed-media write failure'), { code: 'EIO' });
			}
			return actual.writeFile(...args);
		}
	};
});

const VALID_PNG = Uint8Array.from([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
	0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1,
	255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 68, 174, 66, 96, 130
]);

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

/** @param {unknown} value @param {string} name */
function requiredFunction(value, name) {
	expect(value, `${name} must be a public repository function`).toBeTypeOf('function');
	return /** @type {(...args: any[]) => Promise<any>} */ (value);
}

/** @param {string} filePath */
async function exists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

describe('players repository', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;
	/** @type {string} */
	let mediaRoot;

	beforeEach(async () => {
		controlledFilesystem.failManagedWrite = false;
		client = createClient({ url: ':memory:' });
		await createSchema(client);
		database = createMemoryDatabase(client);
		mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'tft-player-maintenance-'));
	});

	afterEach(async () => {
		client.close();
		await rm(mediaRoot, { recursive: true, force: true });
	});

	test('creates a manual player with normalized Riot ID fields', async () => {
		const created = await playerRepository.createPlayer(database, {
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
		const created = await playerRepository.createPlayer(database, {
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
		await expect(
			playerRepository.createPlayer(database, { fullName: '   ', displayName: 'Name' })
		).rejects.toThrow('Full name and display name are required');
		expect(await database.select().from(players)).toEqual([]);
	});

	test('enforces the Riot ID uniqueness key used by import previews', async () => {
		await playerRepository.createPlayer(database, {
			fullName: 'Player One',
			displayName: 'Winner One',
			riotId: 'PlayerOne#tag'
		});

		await expect(
			playerRepository.createPlayer(database, {
				fullName: 'Player Two',
				displayName: 'Runner Up',
				riotId: 'playerone#TAG'
			})
		).rejects.toThrow();
	});

	test('updates every editable identity field and returns normalized Riot identity', async () => {
		const player = await playerRepository.createPlayer(database, {
			fullName: 'Old Full Name',
			displayName: 'Old Display',
			riotId: 'OldName#OLD'
		});
		const updatePlayer = requiredFunction(playerRepository.updatePlayer, 'updatePlayer');

		const updated = await updatePlayer(database, {
			playerId: player.id,
			fullName: '  New Full Name  ',
			displayName: '  New Display  ',
			riotId: ' NewGame # NewTag '
		});

		expect(updated).toMatchObject({
			id: player.id,
			fullName: 'New Full Name',
			displayName: 'New Display',
			riotId: 'NewGame#NewTag',
			riotIdKey: 'newgame#newtag',
			riotGameName: 'NewGame',
			riotTagline: 'NewTag'
		});
	});

	test('rejects an update that duplicates another normalized Riot ID', async () => {
		await playerRepository.createPlayer(database, {
			fullName: 'Player One',
			displayName: 'Winner One',
			riotId: 'PlayerOne#TAG'
		});
		const second = await playerRepository.createPlayer(database, {
			fullName: 'Player Two',
			displayName: 'Winner Two',
			riotId: 'PlayerTwo#TAG'
		});
		const updatePlayer = requiredFunction(playerRepository.updatePlayer, 'updatePlayer');

		await expect(
			updatePlayer(database, {
				playerId: second.id,
				fullName: second.fullName,
				displayName: second.displayName,
				riotId: ' playerone # tag '
			})
		).rejects.toThrow();
	});

	test('keeps the existing managed image and row when a valid replacement hits a staging write failure', async () => {
		const player = await playerRepository.createPlayer(database, {
			fullName: 'Player One',
			displayName: 'Winner One'
		});
		const oldRelativePath = `player-images/${player.id}-old.png`;
		await mkdir(path.join(mediaRoot, 'player-images'), { recursive: true });
		await writeFile(path.join(mediaRoot, ...oldRelativePath.split('/')), 'old image');
		await database
			.update(players)
			.set({ imagePath: oldRelativePath })
			.where(eq(players.id, player.id));
		const replacePlayerImage = requiredFunction(
			playerRepository.replacePlayerImage,
			'replacePlayerImage'
		);
		controlledFilesystem.failManagedWrite = true;

		await expect(
			replacePlayerImage(database, {
				playerId: player.id,
				mediaRoot,
				bytes: VALID_PNG,
				mime: 'image/png'
			})
		).rejects.toThrow('controlled managed-media write failure');

		const [stored] = await database.select().from(players).where(eq(players.id, player.id));
		expect(stored.imagePath).toBe(oldRelativePath);
		expect(await exists(path.join(mediaRoot, ...oldRelativePath.split('/')))).toBe(true);
	});

	test('removes only the selected player managed image', async () => {
		const player = await playerRepository.createPlayer(database, {
			fullName: 'Player One',
			displayName: 'Winner One'
		});
		const untouchedPlayer = await playerRepository.createPlayer(database, {
			fullName: 'Player Two',
			displayName: 'Winner Two'
		});
		const oldRelativePath = `player-images/${player.id}-old.png`;
		const untouchedRelativePath = `player-images/${untouchedPlayer.id}-old.png`;
		await mkdir(path.join(mediaRoot, 'player-images'), { recursive: true });
		await writeFile(path.join(mediaRoot, ...oldRelativePath.split('/')), 'old image');
		await writeFile(path.join(mediaRoot, ...untouchedRelativePath.split('/')), 'untouched image');
		await database
			.update(players)
			.set({ imagePath: oldRelativePath })
			.where(eq(players.id, player.id));
		await database
			.update(players)
			.set({ imagePath: untouchedRelativePath })
			.where(eq(players.id, untouchedPlayer.id));
		const removePlayerImage = requiredFunction(
			playerRepository.removePlayerImage,
			'removePlayerImage'
		);

		const updated = await removePlayerImage(database, { playerId: player.id, mediaRoot });

		expect(updated).toMatchObject({ id: player.id, imagePath: null });
		expect(await exists(path.join(mediaRoot, ...oldRelativePath.split('/')))).toBe(false);
		expect(await exists(path.join(mediaRoot, ...untouchedRelativePath.split('/')))).toBe(true);
		const [untouched] = await database
			.select()
			.from(players)
			.where(eq(players.id, untouchedPlayer.id));
		expect(untouched.imagePath).toBe(untouchedRelativePath);
	});

	test('deletes an ordinary player without resetting saved state', async () => {
		const player = await playerRepository.createPlayer(database, {
			fullName: 'Player One',
			displayName: 'Winner One'
		});
		const deletePlayer = requiredFunction(playerRepository.deletePlayer, 'deletePlayer');

		await expect(
			deletePlayer(database, { playerId: player.id, confirmReset: false })
		).resolves.toMatchObject({ deleted: true, reset: false });
		expect(await database.select().from(players).where(eq(players.id, player.id))).toEqual([]);
	});

	test('requires confirmation before resetting state and deleting its current winner', async () => {
		const player = await playerRepository.createPlayer(database, {
			fullName: 'Player One',
			displayName: 'Winner One'
		});
		const now = new Date('2026-08-08T00:00:00.000Z');
		await client.execute({
			sql: 'INSERT INTO tournaments (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
			args: ['tournament-one', 'Tournament One', 'tournament-one', now.getTime(), now.getTime()]
		});
		await client.execute({
			sql: 'INSERT INTO winner_board_state (id, tournament_id, winner_player_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			args: ['current', 'tournament-one', player.id, 'Winner', now.getTime(), now.getTime()]
		});
		const deletePlayer = requiredFunction(playerRepository.deletePlayer, 'deletePlayer');

		await expect(
			deletePlayer(database, { playerId: player.id, confirmReset: false })
		).resolves.toMatchObject({ kind: 'reset_required', label: 'Winner One' });
		expect(await database.select().from(players).where(eq(players.id, player.id))).toHaveLength(1);

		await expect(
			deletePlayer(database, { playerId: player.id, confirmReset: true })
		).resolves.toMatchObject({ deleted: true, reset: true });
		expect((await client.execute('SELECT * FROM winner_board_state')).rows).toEqual([]);
		expect(await database.select().from(players).where(eq(players.id, player.id))).toEqual([]);
	});
});
