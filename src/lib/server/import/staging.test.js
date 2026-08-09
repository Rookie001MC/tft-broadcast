import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { zipSync } from 'fflate';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { playerImportPreviews } from '$lib/server/db/schema/imports.js';
import { players } from '$lib/server/db/schema/players.js';
import {
	deleteManagedFile,
	readManagedPlayerImage,
	resolveContainedPath,
	writeManagedPlayerImage
} from '../media/player-images.js';
import * as stagingRepository from './staging.js';

const { commitStagedPlayerImport, stagePlayerImport } = stagingRepository;

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

/** @param {unknown} value @param {string} name */
function requiredFunction(value, name) {
	expect(value, `${name} must be a public staging function`).toBeTypeOf('function');
	return /** @type {(...args: any[]) => Promise<any>} */ (value);
}

afterEach(async () => {
	vi.useRealTimers();
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
				committed_at INTEGER,
				result_summary_json TEXT,
				created_at INTEGER NOT NULL
			)`
		]);
	});

	afterEach(() => client.close());

	test('stages without player or managed-image writes, then commits the exact previewed bundle', async () => {
		const zipBytes = playerBundle();
		const staged = await stagePlayerImport({
			db: database,
			zipBytes,
			mediaRoot,
			existingPlayers: []
		});

		expect(staged.preview.canCommit).toBe(true);
		expect(await database.select().from(players)).toEqual([]);
		expect(await exists(path.join(mediaRoot, 'player-images'))).toBe(false);
		const [previewRow] = await database.select().from(playerImportPreviews);
		expect(previewRow.stagedPath).toBe(`import-staging/${staged.token}.zip`);
		expect(await readFile(resolveContainedPath(mediaRoot, previewRow.stagedPath))).toEqual(
			Buffer.from(zipBytes)
		);

		const result = await commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot });
		const [player] = await database.select().from(players);
		const [committedPreview] = await database.select().from(playerImportPreviews);

		expect(result).toMatchObject({
			token: staged.token,
			status: 'committed',
			committedAt: expect.any(Date),
			summary: { created: 1, updated: 0, skipped: 0 }
		});
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

	test('persists a committed summary that distinguishes created, updated, and unchanged rows', async () => {
		const now = new Date('2026-08-08T00:00:00.000Z');
		await database.insert(players).values([
			{
				id: 'existing-update',
				riotId: 'ExistingUpdate#TAG',
				riotIdKey: 'existingupdate#tag',
				riotGameName: 'ExistingUpdate',
				riotTagline: 'TAG',
				fullName: 'Old Name',
				displayName: 'Old Display',
				createdAt: now,
				updatedAt: now
			},
			{
				id: 'existing-skip',
				riotId: 'ExistingSkip#TAG',
				riotIdKey: 'existingskip#tag',
				riotGameName: 'ExistingSkip',
				riotTagline: 'TAG',
				fullName: 'Same Name',
				displayName: 'Same Display',
				createdAt: now,
				updatedAt: now
			}
		]);
		const existingPlayers = await database.select().from(players);
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle([
				'Updated Name,Updated Display,ExistingUpdate#TAG',
				'Same Name,Same Display,ExistingSkip#TAG',
				'Created Name,Created Display,Created#TAG'
			]),
			mediaRoot,
			existingPlayers
		});

		const result = await commitStagedPlayerImport({
			db: database,
			token: staged.token,
			mediaRoot
		});

		expect(result).toMatchObject({
			status: 'committed',
			summary: { created: 1, updated: 1, skipped: 1 }
		});
		const [stored] = /** @type {any[]} */ (
			(
				await client.execute({
					sql: 'SELECT result_summary_json FROM player_import_previews WHERE token = ?',
					args: [staged.token]
				})
			).rows
		);
		expect(JSON.parse(stored.result_summary_json)).toEqual({
			created: 1,
			updated: 1,
			skipped: 1
		});
	});

	test('reloads a terminal committed preview with its persisted timestamp and summary', async () => {
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		await commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot });
		const loadLatestPlayerImportPreview = requiredFunction(
			stagingRepository.loadLatestPlayerImportPreview,
			'loadLatestPlayerImportPreview'
		);

		const reloaded = await loadLatestPlayerImportPreview({ db: database, mediaRoot });

		expect(reloaded).toMatchObject({
			token: staged.token,
			status: 'committed',
			committedAt: expect.any(Date),
			summary: { created: 1, updated: 0, skipped: 0 }
		});
		const rows = /** @type {any[]} */ (
			(
				await client.execute({
					sql: 'SELECT committed_at, result_summary_json FROM player_import_previews WHERE token = ?',
					args: [staged.token]
				})
			).rows
		);
		expect(rows[0].committed_at).toEqual(expect.any(Number));
		expect(JSON.parse(rows[0].result_summary_json)).toEqual({
			created: 1,
			updated: 0,
			skipped: 0
		});
	});

	test('persists and reloads committed metadata when deployed schema has no terminal columns', async () => {
		await client.batch([
			'DROP TABLE player_import_previews',
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
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});

		await commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot });
		const [stored] = /** @type {any[]} */ (
			(
				await client.execute({
					sql: 'SELECT preview_json, status FROM player_import_previews WHERE token = ?',
					args: [staged.token]
				})
			).rows
		);
		const persisted = JSON.parse(stored.preview_json);
		expect(stored.status).toBe('committed');
		expect(persisted.__committedImport).toMatchObject({
			committedAt: expect.any(String),
			summary: { created: 1, updated: 0, skipped: 0 }
		});
		await expect(
			stagingRepository.loadLatestPlayerImportPreview({ db: database, mediaRoot })
		).resolves.toMatchObject({
			token: staged.token,
			status: 'committed',
			committedAt: expect.any(Date),
			summary: { created: 1, updated: 0, skipped: 0 }
		});
	});

	test('breaks latest-preview timestamp ties by persisted insertion order', async () => {
		const createdAt = new Date('2026-08-09T00:00:00.000Z');
		for (const token of ['tie-z', 'tie-a']) {
			await database.insert(playerImportPreviews).values({
				token,
				stagedPath: `import-staging/${token}.zip`,
				sha256: token,
				previewJson: JSON.stringify({ canCommit: true, rows: [] }),
				status: 'committed',
				expiresAt: new Date(createdAt.getTime() + 60_000),
				createdAt
			});
		}

		await expect(
			stagingRepository.loadLatestPlayerImportPreview({ db: database, mediaRoot })
		).resolves.toMatchObject({ token: 'tie-a', status: 'committed' });
	});

	test('loads expired and missing-file previews as unavailable terminal states', async () => {
		const loadLatestPlayerImportPreview = requiredFunction(
			stagingRepository.loadLatestPlayerImportPreview,
			'loadLatestPlayerImportPreview'
		);
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

		await expect(loadLatestPlayerImportPreview({ db: database, mediaRoot })).resolves.toMatchObject(
			{ token: expired.token, status: 'expired' }
		);

		await client.execute({
			sql: 'DELETE FROM player_import_previews WHERE token = ?',
			args: [expired.token]
		});
		const missingFile = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		const [missingRow] = await database.select().from(playerImportPreviews);
		await deleteManagedFile(mediaRoot, missingRow.stagedPath);

		await expect(loadLatestPlayerImportPreview({ db: database, mediaRoot })).resolves.toMatchObject(
			{ token: missingFile.token, status: 'unavailable' }
		);
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

	test('uses a fresh transaction claim time when a preview expires while waiting', async () => {
		const start = new Date('2026-08-09T00:00:00.000Z');
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(start);
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		const delayedDatabase = new Proxy(database, {
			get(target, property, receiver) {
				if (property === 'transaction') {
					return async (/** @type {(tx: any) => Promise<unknown>} */ callback) => {
						vi.setSystemTime(new Date(start.getTime() + 31 * 60 * 1000));
						return database.transaction(callback);
					};
				}
				const value = Reflect.get(target, property, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});

		await expect(
			commitStagedPlayerImport({ db: delayedDatabase, token: staged.token, mediaRoot })
		).rejects.toThrow('Import preview has expired');
		expect(await database.select().from(players)).toEqual([]);
		expect(await exists(path.join(mediaRoot, 'player-images'))).toBe(false);
		expect((await database.select().from(playerImportPreviews))[0].status).toBe('previewed');
	});

	test('allows only one true concurrent commit and writes one player image set', async () => {
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});

		const outcomes = await Promise.allSettled([
			commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot }),
			commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot })
		]);

		expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
		expect(await database.select().from(players)).toHaveLength(1);
		expect(await readdir(path.join(mediaRoot, 'player-images'))).toHaveLength(1);
		expect((await database.select().from(playerImportPreviews))[0].status).toBe('committed');
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

	test('revalidates the preview inside the write transaction and cleans images after a roster race', async () => {
		const staged = await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});
		const now = new Date();
		const racingDatabase = new Proxy(database, {
			get(target, property, receiver) {
				if (property === 'transaction') {
					return async (/** @type {(tx: any) => Promise<unknown>} */ callback) => {
						await database.insert(players).values({
							id: 'racing-player',
							riotId: 'PlayerOne#tag',
							riotIdKey: 'playerone#tag',
							riotGameName: 'PlayerOne',
							riotTagline: 'tag',
							fullName: 'Racing Player',
							displayName: 'Racing Player',
							createdAt: now,
							updatedAt: now
						});
						return database.transaction(callback);
					};
				}
				const value = Reflect.get(target, property, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});

		await expect(
			commitStagedPlayerImport({ db: racingDatabase, token: staged.token, mediaRoot })
		).rejects.toThrow('Import preview is stale');
		expect(await exists(path.join(mediaRoot, 'player-images'))).toBe(false);
		const [preview] = await database.select().from(playerImportPreviews);
		expect(preview.status).toBe('previewed');
		expect((await database.select().from(players)).map(({ id }) => id)).toEqual(['racing-player']);
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

	test('keeps an expired preview row when its valid staging path cannot be deleted', async () => {
		const token = 'retry-cleanup';
		const stagedPath = `import-staging/${token}.zip`;
		await mkdir(resolveContainedPath(mediaRoot, stagedPath), { recursive: true });
		await writeFile(resolveContainedPath(mediaRoot, `${stagedPath}/child`), 'blocks deletion');
		await database.insert(playerImportPreviews).values({
			token,
			stagedPath,
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

		expect(
			(await database.select().from(playerImportPreviews)).some(
				(preview) => preview.token === token
			)
		).toBe(true);
		expect(await exists(resolveContainedPath(mediaRoot, `${stagedPath}/child`))).toBe(true);
	});

	test('reconciles old untracked staging ZIPs and managed images without touching referenced files', async () => {
		const stagingOrphan = `import-staging/${randomUUID()}.zip`;
		const imageOrphan = `player-images/orphan-${randomUUID()}.png`;
		const referencedImage = `player-images/referenced-${randomUUID()}.png`;
		await mkdir(resolveContainedPath(mediaRoot, 'import-staging'), { recursive: true });
		await mkdir(resolveContainedPath(mediaRoot, 'player-images'), { recursive: true });
		for (const relativePath of [stagingOrphan, imageOrphan, referencedImage]) {
			const absolutePath = resolveContainedPath(mediaRoot, relativePath);
			await writeFile(absolutePath, ONE_BY_ONE_PNG);
			const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
			await utimes(absolutePath, old, old);
		}
		const now = new Date();
		await database.insert(players).values({
			id: 'referenced-player',
			fullName: 'Referenced',
			displayName: 'Referenced',
			imagePath: referencedImage,
			createdAt: now,
			updatedAt: now
		});

		await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(),
			mediaRoot,
			existingPlayers: []
		});

		expect(await exists(resolveContainedPath(mediaRoot, stagingOrphan))).toBe(false);
		expect(await exists(resolveContainedPath(mediaRoot, imageOrphan))).toBe(false);
		expect(await exists(resolveContainedPath(mediaRoot, referencedImage))).toBe(true);
	});

	test('reconciles a terminal ZIP left by failed post-commit deletion without deleting metadata', async () => {
		const zipBytes = playerBundle();
		const staged = await stagePlayerImport({
			db: database,
			zipBytes,
			mediaRoot,
			existingPlayers: []
		});
		await commitStagedPlayerImport({ db: database, token: staged.token, mediaRoot });
		const terminalPath = resolveContainedPath(mediaRoot, `import-staging/${staged.token}.zip`);
		await writeFile(terminalPath, zipBytes, { flag: 'wx' });
		const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
		await utimes(terminalPath, old, old);

		const existingPlayers = await database.select().from(players);
		await stagePlayerImport({
			db: database,
			zipBytes: playerBundle(['Second Player,Second,Second#TAG']),
			mediaRoot,
			existingPlayers
		});

		expect(await exists(terminalPath)).toBe(false);
		const committedRows = await database.select().from(playerImportPreviews);
		expect(committedRows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ token: staged.token, status: 'committed' })
			])
		);
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
