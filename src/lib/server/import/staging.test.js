import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { zipSync } from 'fflate';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { playerImportPreviews } from '$lib/server/db/schema/imports.js';
import { players } from '$lib/server/db/schema/players.js';
import {
	deleteManagedFile,
	readManagedPlayerImage,
	resolveContainedPath,
	writeManagedPlayerImage
} from '../media/player-images.js';
import { commitStagedPlayerImport, stagePlayerImport } from './staging.js';

const ONE_BY_ONE_PNG = Uint8Array.from([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
	0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1,
	255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

/** @type {string[]} */
const temporaryDirectories = [];

async function temporaryDirectory() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'tft-player-import-'));
	temporaryDirectories.push(directory);
	return directory;
}

/** @param {string[]} rows */
function playerBundle(rows = ['Nguyen Van A,Player A,PlayerOne#tag']) {
	return zipSync({
		'players.csv': new TextEncoder().encode(
			`full_name,display_name,riot_id\r\n${rows.join('\r\n')}\r\n`
		),
		'player_images/playerone_tag.png': ONE_BY_ONE_PNG
	});
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

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe('staged player imports', () => {
	/** @type {import('@libsql/client').Client} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;
	/** @type {string} */
	let mediaRoot;

	beforeEach(async () => {
		mediaRoot = await temporaryDirectory();
		client = createClient({ url: 'file::memory:?cache=shared' });
		database = drizzle(client);
		await client.batch([
			'DROP TABLE IF EXISTS player_import_previews',
			'DROP TABLE IF EXISTS players',
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
			`CREATE TABLE player_import_previews (
				token TEXT PRIMARY KEY NOT NULL,
				staged_path TEXT NOT NULL,
				sha256 TEXT NOT NULL,
				preview_json TEXT NOT NULL,
				status TEXT DEFAULT 'previewed' NOT NULL,
				expires_at INTEGER NOT NULL,
				created_at INTEGER NOT NULL
			)`
		]);
	});

	afterEach(() => client.close());

	test('stages without player or managed-image writes, then commits the exact previewed bundle', async () => {
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});

		expect(staged.preview.canCommit).toBe(true);
		expect(await database.select().from(players)).toEqual([]);
		expect(await exists(path.join(mediaRoot, 'player-images'))).toBe(false);
		const [previewRow] = await database.select().from(playerImportPreviews);
		expect(previewRow.stagedPath).toBe(`import-staging/${staged.token}.zip`);
		expect(await readFile(resolveContainedPath(mediaRoot, previewRow.stagedPath))).toEqual(
			Buffer.from(playerBundle())
		);

		const result = await commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot });
		const [player] = await database.select().from(players);
		const [committedPreview] = await database.select().from(playerImportPreviews);

		expect(result).toEqual({ imported: 1 });
		expect(player).toMatchObject({
			riotId: 'PlayerOne#tag',
			riotIdKey: 'playerone#tag',
			fullName: 'Nguyen Van A',
			displayName: 'Player A'
		});
		expect(player.imagePath).toMatch(/^player-images[/\\]/);
		if (!player.imagePath) throw new Error('Committed player image path was not set');
		expect(await readManagedPlayerImage({ mediaRoot, relativePath: player.imagePath })).toEqual(
			Buffer.from(ONE_BY_ONE_PNG)
		);
		expect(committedPreview.status).toBe('committed');
		expect(await exists(resolveContainedPath(mediaRoot, previewRow.stagedPath))).toBe(false);
	});

	test('returns validation errors without writing players or managed images and refuses commit', async () => {
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(['Missing Riot,Player,not-a-riot-id']),
			mediaRoot,
			existingPlayers: []
		});

		expect(staged.preview.canCommit).toBe(false);
		await expect(
			commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot })
		).rejects.toThrow('Import has validation errors');
		expect(await database.select().from(players)).toEqual([]);
		expect(await exists(path.join(mediaRoot, 'player-images'))).toBe(false);
	});

	test('rejects expired and already-used preview tokens', async () => {
		const expired = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		await client.execute({
			sql: 'UPDATE player_import_previews SET expires_at = ? WHERE token = ?',
			args: [Date.now() - 1, expired.token]
		});
		await expect(
			commitStagedPlayerImport({ db: database, token: expired.token, mediaRoot })
		).rejects.toThrow('Import preview has expired');

		const usable = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		await commitStagedPlayerImport({ db: database, token: usable.token, mediaRoot });
		await expect(
			commitStagedPlayerImport({ db: database, token: usable.token, mediaRoot })
		).rejects.toThrow('Import preview has already been used');
	});

	test('rejects digest mismatches and previews made stale by current player data', async () => {
		const changedBytes = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		const [changedRow] = await database.select().from(playerImportPreviews);
		await writeFile(resolveContainedPath(mediaRoot, changedRow.stagedPath), 'changed');
		await expect(
			commitStagedPlayerImport({ db: database, token: changedBytes.token, mediaRoot })
		).rejects.toThrow('Import bundle digest does not match preview');

		const stale = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		const now = new Date();
		await database.insert(players).values({
			id: 'existing-player',
			riotId: 'PlayerOne#tag',
			riotIdKey: 'playerone#tag',
			riotGameName: 'PlayerOne',
			riotTagline: 'tag',
			fullName: 'Existing',
			displayName: 'Existing',
			createdAt: now,
			updatedAt: now
		});
		await expect(
			commitStagedPlayerImport({ db: database, token: stale.token, mediaRoot })
		).rejects.toThrow('Import preview is stale');
	});

	test('deletes only newly written images when the database transaction rolls back', async () => {
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		await client.execute(
			`CREATE TRIGGER reject_player_import BEFORE INSERT ON players
			 BEGIN SELECT RAISE(ABORT, 'player import failed'); END`
		);

		await expect(
			commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot })
		).rejects.toThrow();
		expect(await readdir(path.join(mediaRoot, 'player-images'))).toEqual([]);
		const [preview] = await database.select().from(playerImportPreviews);
		expect(preview.status).toBe('previewed');
		expect(await exists(resolveContainedPath(mediaRoot, preview.stagedPath))).toBe(true);
	});

	test('removes expired staging files and cleans up a new file when its preview insert fails', async () => {
		const orphanRelativePath = 'import-staging/orphan.zip';
		await mkdir(resolveContainedPath(mediaRoot, 'import-staging'), { recursive: true });
		await writeFile(resolveContainedPath(mediaRoot, orphanRelativePath), 'orphan');
		await database.insert(playerImportPreviews).values({
			token: 'orphan',
			stagedPath: orphanRelativePath,
			sha256: 'old',
			previewJson: '{}',
			status: 'previewed',
			expiresAt: new Date(Date.now() - 1),
			createdAt: new Date(Date.now() - 60_000)
		});

		await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		expect(await exists(resolveContainedPath(mediaRoot, orphanRelativePath))).toBe(false);
		expect(
			(await database.select().from(playerImportPreviews)).some(({ token }) => token === 'orphan')
		).toBe(false);

		await client.execute(
			`CREATE TRIGGER reject_preview_insert BEFORE INSERT ON player_import_previews
			 BEGIN SELECT RAISE(ABORT, 'preview insert failed'); END`
		);
		await expect(
			stagePlayerImport({
				db: database,
				zipBytes: playerBundle(),
				mediaRoot,
				existingPlayers: []
			})
		).rejects.toThrow();
		expect(await readdir(resolveContainedPath(mediaRoot, 'import-staging'))).toHaveLength(1);
	});
});

describe('managed player images', () => {
	test('resolves contained paths and rejects paths outside the managed root', () => {
		const root = path.resolve('managed-test-root');

		expect(resolveContainedPath(root, 'player-images/player.png')).toBe(
			path.join(root, 'player-images', 'player.png')
		);
		expect(() => resolveContainedPath(root, '../outside.png')).toThrow('Path escapes managed root');
		expect(() => resolveContainedPath(root, path.resolve(root, '..', 'outside.png'))).toThrow(
			'Path escapes managed root'
		);
	});

	test('writes validated images to unique app-generated names and reads or deletes them safely', async () => {
		const mediaRoot = await temporaryDirectory();
		const first = await writeManagedPlayerImage({
			mediaRoot,
			playerId: 'player-1',
			bytes: ONE_BY_ONE_PNG,
			mime: 'image/png'
		});
		const second = await writeManagedPlayerImage({
			mediaRoot,
			playerId: 'player-1',
			bytes: ONE_BY_ONE_PNG,
			mime: 'image/png'
		});

		expect(first).toMatch(/^player-images[/\\]player-1-[a-f0-9-]+\.png$/);
		expect(second).not.toBe(first);
		expect(await readManagedPlayerImage({ mediaRoot, relativePath: first })).toEqual(
			Buffer.from(ONE_BY_ONE_PNG)
		);

		await deleteManagedFile(mediaRoot, first);
		expect(await readdir(path.join(mediaRoot, 'player-images'))).toHaveLength(1);
	});

	test('rejects an image whose declared MIME does not match its signature', async () => {
		const mediaRoot = await temporaryDirectory();

		await expect(
			writeManagedPlayerImage({
				mediaRoot,
				playerId: 'player-1',
				bytes: ONE_BY_ONE_PNG,
				mime: 'image/jpeg'
			})
		).rejects.toThrow('Image content does not match its MIME type');
	});

	test('does not read a contained non-image file through player-images traversal', async () => {
		const mediaRoot = await temporaryDirectory();
		await mkdir(resolveContainedPath(mediaRoot, 'import-staging'), { recursive: true });
		await writeFile(resolveContainedPath(mediaRoot, 'import-staging/secret.zip'), 'secret');

		await expect(
			readManagedPlayerImage({
				mediaRoot,
				relativePath: 'player-images/../import-staging/secret.zip'
			})
		).rejects.toThrow('Path escapes managed root');
	});
});
