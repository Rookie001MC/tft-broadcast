import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import tar from 'tar-stream';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { tournaments } from '../db/schema/tournaments.js';
import { resolveDdragonVersion, syncAndActivateCatalog } from './catalog-sync.js';

const CDRAGON_ROOT = 'https://raw.communitydragon.org';
const DDRAGON_ROOT = 'https://ddragon.leagueoflegends.com';
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

function cdragonFixture({ icon = true, augment = true } = {}) {
	return {
		sets: {
			13: {
				name: 'Into the Arcane',
				champions: [
					{
						apiName: 'TFT13_Ahri',
						name: 'Ahri localized',
						squareIcon: icon ? '/lol-game-data/assets/ASSETS/UX/TFT/Champions/Ahri.PNG' : null,
						cost: 4
					}
				]
			}
		},
		items: augment
			? [
					{
						apiName: 'TFT_Augment_JeweledLotus',
						name: 'Jeweled Lotus',
						icon: '/lol-game-data/assets/ASSETS/Maps/TFT/Icons/Augments/Lotus.PNG'
					}
				]
			: []
	};
}

function ddragonChampionFixture() {
	return {
		data: {
			TFT13_Ahri: {
				id: 'TFT13_Ahri',
				name: 'Ahri English',
				tier: 4,
				image: { full: 'TFT13_Ahri.png' }
			}
		}
	};
}

function ddragonAugmentFixture() {
	return {
		data: {
			TFT_Augment_JeweledLotus: {
				id: 'TFT_Augment_JeweledLotus',
				name: 'Jeweled Lotus',
				image: { full: 'TFT_Augment_JeweledLotus.png' }
			}
		}
	};
}

/** @param {Record<string, Buffer | string>} entries @returns {Promise<Buffer>} */
function tarGz(entries) {
	return new Promise((resolve, reject) => {
		const pack = tar.pack();
		const gzip = createGzip();
		/** @type {Buffer[]} */
		const chunks = [];
		gzip.on('data', (chunk) => chunks.push(chunk));
		gzip.on('error', reject);
		gzip.on('end', () => resolve(Buffer.concat(chunks)));
		pack.pipe(gzip);
		for (const [name, value] of Object.entries(entries)) pack.entry({ name }, value);
		pack.finalize();
	});
}

async function ddragonArchive({ locale = 'en_US', includeAugment = true } = {}) {
	const version = '16.15.1';
	/** @type {Record<string, Buffer | string>} */
	const entries = {
		[`${version}/data/${locale}/tft-champion.json`]: JSON.stringify(ddragonChampionFixture()),
		[`${version}/img/tft-champion/TFT13_Ahri.png`]: PNG
	};
	if (includeAugment) {
		entries[`${version}/data/${locale}/tft-augments.json`] =
			JSON.stringify(ddragonAugmentFixture());
		entries[`${version}/img/tft-augment/TFT_Augment_JeweledLotus.png`] = PNG;
	}
	return tarGz(entries);
}

/** @param {Record<string, unknown | Error>} routes @param {string[]} calls */
function fixtureJson(routes, calls) {
	return async (/** @type {string} */ url) => {
		calls.push(url);
		const value = routes[url];
		if (value === undefined) throw new Error(`Unexpected URL: ${url}`);
		if (value instanceof Error) throw value;
		return value;
	};
}

/** @param {Record<string, Response | (() => Response | Promise<Response>)>} routes @param {string[]} [calls] */
function fixtureResponse(routes, calls = []) {
	return async (/** @type {string} */ url) => {
		calls.push(url);
		const value = routes[url];
		if (!value) return new Response('missing', { status: 404 });
		return typeof value === 'function' ? value() : value;
	};
}

describe('catalog synchronization', () => {
	/** @type {import('@libsql/client').Client} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;
	/** @type {string} */
	let mediaRoot;

	beforeEach(async () => {
		mediaRoot = await mkdtemp(path.join(tmpdir(), 'tft-catalog-'));
		client = createClient({ url: 'file::memory:?cache=shared' });
		database = drizzle(client);
		await client.batch([
			'PRAGMA foreign_keys = ON',
			'DROP TABLE IF EXISTS tournaments',
			'DROP TABLE IF EXISTS catalog_augments',
			'DROP TABLE IF EXISTS catalog_champions',
			'DROP TABLE IF EXISTS catalog_snapshots',
			`CREATE TABLE catalog_snapshots (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL, locale TEXT NOT NULL, patch_label TEXT NOT NULL, set_label TEXT, synced_at INTEGER NOT NULL, is_available INTEGER DEFAULT 0 NOT NULL, metadata_json TEXT NOT NULL)`,
			`CREATE TABLE catalog_champions (id TEXT PRIMARY KEY NOT NULL, catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE, external_id TEXT NOT NULL, display_name TEXT NOT NULL, icon_path TEXT, tier INTEGER, metadata_json TEXT NOT NULL, UNIQUE(catalog_snapshot_id, external_id))`,
			`CREATE TABLE catalog_augments (id TEXT PRIMARY KEY NOT NULL, catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE, external_id TEXT NOT NULL, display_name TEXT NOT NULL, icon_path TEXT, tier INTEGER, metadata_json TEXT NOT NULL, UNIQUE(catalog_snapshot_id, external_id))`,
			`CREATE TABLE tournaments (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, active_catalog_snapshot_id TEXT REFERENCES catalog_snapshots(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
		]);
		const now = new Date();
		await database.insert(tournaments).values({
			id: 'tournament-1',
			name: 'Unitour',
			slug: 'unitour',
			createdAt: now,
			updatedAt: now
		});
	});

	afterEach(async () => {
		client.close();
		await rm(mediaRoot, { recursive: true, force: true });
	});

	test('downloads CommunityDragon images and activates only immutable local paths', async () => {
		const catalogUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/vi_vn.json`;
		const imageRoot = `${CDRAGON_ROOT}/14.10/plugins/rcp-be-lol-game-data/global/default/`;
		/** @type {any[]} */
		const progress = [];
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'vi_vn',
			mediaRoot,
			fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture() }, []),
			fetchResponse: fixtureResponse({
				[`${imageRoot}assets/ux/tft/champions/ahri.png`]: new Response(PNG),
				[`${imageRoot}assets/maps/tft/icons/augments/lotus.png`]: new Response(PNG)
			}),
			onProgress: (event) => progress.push(event)
		});

		expect(result).toMatchObject({ activated: true, source: 'communitydragon', locale: 'vi_vn' });
		expect(result.champions[0].iconPath).toMatch(
			/^\/media\/catalog-assets\/[0-9a-f-]+\/champions\//
		);
		expect(result.augments[0].iconPath).toMatch(/^\/media\/catalog-assets\/[0-9a-f-]+\/augments\//);
		const championIcon = result.champions[0].iconPath;
		expect(championIcon).not.toBeNull();
		const championFile = path.join(
			mediaRoot,
			/** @type {string} */ (championIcon).replace('/media/', '').replaceAll('/', path.sep)
		);
		expect(await readFile(championFile)).toEqual(PNG);
		expect(progress).toContainEqual(
			expect.objectContaining({ phase: 'downloading', completed: 2, total: 2, percent: 100 })
		);
		expect(await database.select().from(catalogChampions)).toHaveLength(1);
		expect(await database.select().from(catalogAugments)).toHaveLength(1);
	});

	test('preserves nullable images instead of inventing remote paths', async () => {
		const catalogUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'en_us',
			mediaRoot,
			fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture({ icon: false, augment: false }) }, []),
			fetchResponse: fixtureResponse({})
		});
		expect(result.champions[0].iconPath).toBeNull();
		expect(result.warning).toContain('Augments');
	});

	test('falls back to a full Data Dragon package when CommunityDragon asset installation fails', async () => {
		const catalogUrl = `${CDRAGON_ROOT}/16.15/cdragon/tft/en_us.json`;
		const archiveUrl = `${DDRAGON_ROOT}/cdn/dragontail-16.15.1.tgz`;
		const archive = await ddragonArchive();
		/** @type {string[]} */
		const responseCalls = [];
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '16.15',
			locale: 'en_us',
			mediaRoot,
			fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture() }, []),
			fetchResponse: fixtureResponse(
				{ [archiveUrl]: () => new Response(Uint8Array.from(archive)) },
				responseCalls
			),
			getVersions: async () => ['16.15.1', '16.14.1']
		});

		expect(result).toMatchObject({
			activated: true,
			source: 'datadragon',
			locale: 'en_US'
		});
		expect(responseCalls.at(-1)).toBe(archiveUrl);
		expect(result.champions[0].iconPath).toContain('/media/catalog-assets/');
		expect(await readdir(path.join(mediaRoot, 'catalog-staging'))).toEqual([]);
	});

	test('preserves the prior snapshot and leaves no staging files when both sources fail', async () => {
		const now = new Date();
		await database.insert(catalogSnapshots).values({
			id: 'prior-snapshot',
			source: 'communitydragon',
			sourceUrl: 'https://example.test/catalog.json',
			locale: 'en_us',
			patchLabel: '14.9',
			setLabel: 'Prior',
			syncedAt: now,
			isAvailable: true,
			metadataJson: '{}'
		});
		await database.update(tournaments).set({ activeCatalogSnapshotId: 'prior-snapshot' });
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'en_us',
			mediaRoot,
			fetchJson: async () => {
				throw new Error('offline');
			},
			fetchResponse: fixtureResponse({}),
			getVersions: async () => ['14.10.1']
		});
		expect(result).toMatchObject({ activated: false, snapshotId: 'prior-snapshot' });
		expect((await database.select().from(catalogSnapshots)).map((row) => row.id)).toEqual([
			'prior-snapshot'
		]);
		expect(await readdir(path.join(mediaRoot, 'catalog-staging'))).toEqual([]);
	});

	test('removes promoted files when database activation rolls back', async () => {
		await client.execute(
			`CREATE TRIGGER reject_catalog_activation BEFORE UPDATE OF active_catalog_snapshot_id ON tournaments BEGIN SELECT RAISE(ABORT, 'activation failed'); END`
		);
		const catalogUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;
		const imageUrl = `${CDRAGON_ROOT}/14.10/plugins/rcp-be-lol-game-data/global/default/assets/ux/tft/champions/ahri.png`;
		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '14.10',
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture({ augment: false }) }, []),
				fetchResponse: fixtureResponse({ [imageUrl]: new Response(PNG) })
			})
		).rejects.toThrow();
		expect(await readdir(path.join(mediaRoot, 'catalog-assets'))).toEqual([]);
		expect(await database.select().from(catalogSnapshots)).toEqual([]);
	});

	test('checks tournament existence before touching network or media', async () => {
		let fetched = false;
		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'missing',
				patch: 'latest',
				locale: 'en_us',
				mediaRoot,
				fetchJson: async () => {
					fetched = true;
				}
			})
		).rejects.toThrow('Tournament not found');
		expect(fetched).toBe(false);
	});
});

test('Data Dragon version resolution selects latest exact patch-prefix match', () => {
	expect(resolveDdragonVersion(['16.14.1', '16.15.1', '16.15.3'], '16.15')).toBe('16.15.3');
	expect(resolveDdragonVersion(['16.15.3', '16.15.1'], 'latest')).toBe('16.15.3');
	expect(() => resolveDdragonVersion(['16.15.1'], '16.16')).toThrow('was not found');
});
