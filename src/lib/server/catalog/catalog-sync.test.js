import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { tournaments } from '../db/schema/tournaments.js';
import { syncAndActivateCatalog } from './catalog-sync.js';

const CDRAGON_ROOT = 'https://raw.communitydragon.org';
const DDRAGON_ROOT = 'https://ddragon.leagueoflegends.com';

/**
 * @param {{ championName?: string, includeAugments?: boolean }} [options]
 */
function cdragonFixture({ championName = 'Ahri localized', includeAugments = true } = {}) {
	return {
		sets: {
			3: {
				name: 'Old set',
				champions: [
					{
						apiName: 'TFT3_Old',
						name: 'Old champion',
						squareIcon: '/lol-game-data/assets/ASSETS/UX/TFT/Champions/Old.png',
						cost: 1
					}
				]
			},
			nonNumericPreview: {
				name: 'Preview',
				champions: [
					{
						apiName: 'TFT_Preview',
						name: 'Preview champion',
						squareIcon: '/lol-game-data/assets/ASSETS/UX/TFT/Champions/Preview.png'
					}
				]
			},
			13: {
				name: 'Into the Arcane',
				champions: [
					{
						apiName: 'TFT13_Ahri',
						name: championName,
						squareIcon: '/lol-game-data/assets/ASSETS/UX/TFT/Champions/Ahri.PNG',
						cost: 4
					},
					{
						apiName: 'TFT13_HTTPS',
						name: 'HTTPS champion',
						squareIcon: 'https://cdn.example.test/champion.png',
						cost: 2
					},
					{ apiName: '', name: '', squareIcon: '' },
					{
						apiName: 'TFT13_Blank',
						name: 'TFT13_Blank',
						squareIcon: '/lol-game-data/assets/ASSETS/UX/TFT/Champions/Blank.png'
					}
				]
			}
		},
		items: includeAugments
			? [
					{
						apiName: 'TFT_Augment_JeweledLotus',
						name: 'Jeweled Lotus localized',
						icon: '/lol-game-data/assets/ASSETS/Maps/TFT/Icons/Augments/JeweledLotus.TEX.PNG',
						incompatibleTraits: []
					},
					{
						apiName: 'TFT_Item_Unrelated',
						name: 'Not an augment',
						icon: '/lol-game-data/assets/unrelated.png'
					}
				]
			: []
	};
}

/** @param {string} championName */
function ddragonChampionFixture(championName) {
	return {
		data: {
			TFT13_Ahri: {
				id: 'TFT13_Ahri',
				name: championName,
				tier: 4,
				image: { full: 'TFT13_Ahri.png' }
			},
			Placeholder: { id: '', name: '', image: { full: '' } }
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

/**
 * @param {Record<string, unknown | Error | ((url: string) => unknown | Promise<unknown>)>} routes
 * @param {string[]} calls
 */
function fixtureFetch(routes, calls) {
	return async (/** @type {string} */ url) => {
		calls.push(url);
		const response = routes[url];
		if (response === undefined) throw new Error(`Unexpected URL: ${url}`);
		if (response instanceof Error) throw response;
		return typeof response === 'function' ? response(url) : response;
	};
}

describe('catalog synchronization', () => {
	/** @type {import('@libsql/client').Client} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: 'file::memory:?cache=shared' });
		database = drizzle(client);
		await client.batch([
			'PRAGMA foreign_keys = ON',
			'DROP TABLE IF EXISTS tournaments',
			'DROP TABLE IF EXISTS catalog_augments',
			'DROP TABLE IF EXISTS catalog_champions',
			'DROP TABLE IF EXISTS catalog_snapshots',
			`CREATE TABLE catalog_snapshots (
				id TEXT PRIMARY KEY NOT NULL,
				source TEXT NOT NULL,
				source_url TEXT NOT NULL,
				locale TEXT NOT NULL,
				patch_label TEXT NOT NULL,
				set_label TEXT,
				synced_at INTEGER NOT NULL,
				is_available INTEGER DEFAULT 0 NOT NULL,
				metadata_json TEXT NOT NULL
			)`,
			`CREATE TABLE catalog_champions (
				id TEXT PRIMARY KEY NOT NULL,
				catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
				external_id TEXT NOT NULL,
				display_name TEXT NOT NULL,
				icon_path TEXT,
				tier INTEGER,
				metadata_json TEXT NOT NULL,
				UNIQUE(catalog_snapshot_id, external_id)
			)`,
			`CREATE TABLE catalog_augments (
				id TEXT PRIMARY KEY NOT NULL,
				catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
				external_id TEXT NOT NULL,
				display_name TEXT NOT NULL,
				icon_path TEXT,
				tier INTEGER,
				metadata_json TEXT NOT NULL,
				UNIQUE(catalog_snapshot_id, external_id)
			)`,
			`CREATE TABLE tournaments (
				id TEXT PRIMARY KEY NOT NULL,
				name TEXT NOT NULL,
				slug TEXT NOT NULL UNIQUE,
				active_catalog_snapshot_id TEXT REFERENCES catalog_snapshots(id) ON DELETE SET NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`
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

	afterEach(() => client.close());

	test('uses the requested CDragon locale and normalizes its active set and HTTPS icons', async () => {
		/** @type {string[]} */
		const calls = [];
		const url = `${CDRAGON_ROOT}/14.10/cdragon/tft/vi_vn.json`;
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'vi_vn',
			fetchJson: fixtureFetch({ [url]: cdragonFixture() }, calls)
		});

		expect(calls).toEqual([url]);
		expect(result).toMatchObject({
			activated: true,
			source: 'communitydragon',
			locale: 'vi_vn',
			warning: null
		});
		expect(
			result.champions.map(({ externalId, displayName, iconPath, tier }) => ({
				externalId,
				displayName,
				iconPath,
				tier
			}))
		).toEqual([
			{
				externalId: 'TFT13_Ahri',
				displayName: 'Ahri localized',
				iconPath: `${CDRAGON_ROOT}/14.10/plugins/rcp-be-lol-game-data/global/default/assets/ux/tft/champions/ahri.png`,
				tier: 4
			},
			{
				externalId: 'TFT13_HTTPS',
				displayName: 'HTTPS champion',
				iconPath: 'https://cdn.example.test/champion.png',
				tier: 2
			}
		]);
		expect(result.augments).toHaveLength(1);
		const [snapshot] = await database.select().from(catalogSnapshots);
		expect(snapshot).toMatchObject({
			id: result.snapshotId,
			source: 'communitydragon',
			sourceUrl: url,
			locale: 'vi_vn',
			patchLabel: '14.10',
			setLabel: 'Into the Arcane',
			isAvailable: true
		});
		expect(await database.select().from(catalogChampions)).toHaveLength(2);
		expect(await database.select().from(catalogAugments)).toHaveLength(1);
		const [tournament] = await database.select().from(tournaments);
		expect(tournament.activeCatalogSnapshotId).toBe(result.snapshotId);
	});

	test('falls back from the requested CDragon locale to en_us before Data Dragon', async () => {
		/** @type {string[]} */
		const calls = [];
		const requestedUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/vi_vn.json`;
		const englishUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'vi_vn',
			fetchJson: fixtureFetch(
				{
					[requestedUrl]: new Error('not found'),
					[englishUrl]: cdragonFixture({ championName: 'Ahri English' })
				},
				calls
			)
		});

		expect(calls).toEqual([requestedUrl, englishUrl]);
		expect(result).toMatchObject({
			activated: true,
			source: 'communitydragon',
			locale: 'en_us'
		});
		expect(result.warning).toContain('en_us');
		expect(result.champions[0].displayName).toBe('Ahri English');
	});

	test('resolves CDragon latest to an immutable major/minor patch before fetching or storing URLs', async () => {
		/** @type {string[]} */
		const calls = [];
		const metadataUrl = `${CDRAGON_ROOT}/latest/content-metadata.json`;
		const immutableUrl = `${CDRAGON_ROOT}/16.15/cdragon/tft/en_us.json`;
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: 'latest',
			locale: 'en_us',
			fetchJson: fixtureFetch(
				{
					[metadataUrl]: {
						version: '16.15.7996036+branch.releases-16-15.content.release'
					},
					[immutableUrl]: cdragonFixture()
				},
				calls
			)
		});

		expect(calls).toEqual([metadataUrl, immutableUrl]);
		const [snapshot] = await database.select().from(catalogSnapshots);
		expect(snapshot.patchLabel).toBe('16.15');
		expect(snapshot.sourceUrl).toBe(immutableUrl);
		expect(result.champions[0].iconPath).toContain(`${CDRAGON_ROOT}/16.15/`);
		expect(result.champions[0].iconPath).not.toContain('/latest/');
	});

	test('falls back to an immutable Data Dragon version in requested then English locale order', async () => {
		/** @type {string[]} */
		const calls = [];
		const metadataUrl = `${CDRAGON_ROOT}/latest/content-metadata.json`;
		const cdragonRequested = `${CDRAGON_ROOT}/16.15/cdragon/tft/vi_vn.json`;
		const cdragonEnglish = `${CDRAGON_ROOT}/16.15/cdragon/tft/en_us.json`;
		const versionsUrl = `${DDRAGON_ROOT}/api/versions.json`;
		const viChampions = `${DDRAGON_ROOT}/cdn/16.15.1/data/vi_VN/tft-champion.json`;
		const englishChampions = `${DDRAGON_ROOT}/cdn/16.15.1/data/en_US/tft-champion.json`;
		const englishAugments = `${DDRAGON_ROOT}/cdn/16.15.1/data/en_US/tft-augments.json`;
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: 'latest',
			locale: 'vi_vn',
			fetchJson: fixtureFetch(
				{
					[metadataUrl]: {
						version: '16.15.7996036+branch.releases-16-15.content.release'
					},
					[cdragonRequested]: new Error('missing'),
					[cdragonEnglish]: new Error('missing'),
					[versionsUrl]: ['16.15.1', '16.14.1'],
					[viChampions]: new Error('missing'),
					[englishChampions]: ddragonChampionFixture('Ahri English'),
					[englishAugments]: ddragonAugmentFixture()
				},
				calls
			)
		});

		expect(calls).toEqual([
			metadataUrl,
			cdragonRequested,
			cdragonEnglish,
			versionsUrl,
			viChampions,
			englishChampions,
			englishAugments
		]);
		expect(result).toMatchObject({
			activated: true,
			source: 'datadragon',
			locale: 'en_US'
		});
		expect(result.warning).toContain('en_US');
		expect(result.champions[0].iconPath).toBe(
			`${DDRAGON_ROOT}/cdn/16.15.1/img/tft-champion/TFT13_Ahri.png`
		);
		expect(result.augments[0].iconPath).toBe(
			`${DDRAGON_ROOT}/cdn/16.15.1/img/tft-augment/TFT_Augment_JeweledLotus.png`
		);
		const [snapshot] = await database.select().from(catalogSnapshots);
		expect(snapshot.patchLabel).toBe('16.15.1');
		expect(snapshot.sourceUrl).toBe(englishChampions);
	});

	test('activates usable Data Dragon champions when optional augments fail', async () => {
		/** @type {string[]} */
		const calls = [];
		const cdragon = `${CDRAGON_ROOT}/14.10/cdragon/tft/vi_vn.json`;
		const cdragonEnglish = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;
		const champions = `${DDRAGON_ROOT}/cdn/14.10/data/vi_VN/tft-champion.json`;
		const augments = `${DDRAGON_ROOT}/cdn/14.10/data/vi_VN/tft-augments.json`;
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'vi_vn',
			fetchJson: fixtureFetch(
				{
					[cdragon]: new Error('missing'),
					[cdragonEnglish]: new Error('missing'),
					[champions]: ddragonChampionFixture('Ahri Vietnamese'),
					[augments]: new Error('optional endpoint unavailable')
				},
				calls
			)
		});

		expect(calls).toEqual([cdragon, cdragonEnglish, champions, augments]);
		expect(result).toMatchObject({
			activated: true,
			source: 'datadragon',
			locale: 'vi_VN',
			augments: []
		});
		expect(result.warning).toContain('Augments');
	});

	test('checks tournament existence before network access', async () => {
		/** @type {string[]} */
		const calls = [];

		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'missing',
				patch: 'latest',
				locale: 'en_us',
				fetchJson: fixtureFetch({}, calls)
			})
		).rejects.toThrow('Tournament not found');
		expect(calls).toEqual([]);
	});

	test('preserves the prior snapshot and writes nothing when every source fails', async () => {
		const now = new Date();
		await database.insert(catalogSnapshots).values({
			id: 'prior-snapshot',
			source: 'communitydragon',
			sourceUrl: `${CDRAGON_ROOT}/14.9/cdragon/tft/en_us.json`,
			locale: 'en_us',
			patchLabel: '14.9',
			setLabel: 'Prior',
			syncedAt: now,
			isAvailable: true,
			metadataJson: '{}'
		});
		await database.update(tournaments).set({ activeCatalogSnapshotId: 'prior-snapshot' });
		/** @type {string[]} */
		const calls = [];
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'en_us',
			fetchJson: async (url) => {
				calls.push(url);
				throw new Error('offline');
			}
		});

		expect(calls).toEqual([
			`${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`,
			`${DDRAGON_ROOT}/cdn/14.10/data/en_US/tft-champion.json`
		]);
		expect(result).toMatchObject({
			activated: false,
			snapshotId: 'prior-snapshot',
			source: null,
			locale: 'en_us',
			champions: [],
			augments: []
		});
		expect(result.warning).toContain('could not be synchronized');
		expect((await database.select().from(catalogSnapshots)).map(({ id }) => id)).toEqual([
			'prior-snapshot'
		]);
		const [tournament] = await database.select().from(tournaments);
		expect(tournament.activeCatalogSnapshotId).toBe('prior-snapshot');
	});

	test('rolls back snapshot children and activation when the transaction fails', async () => {
		const now = new Date();
		await database.insert(catalogSnapshots).values({
			id: 'prior-snapshot',
			source: 'communitydragon',
			sourceUrl: `${CDRAGON_ROOT}/14.9/cdragon/tft/en_us.json`,
			locale: 'en_us',
			patchLabel: '14.9',
			setLabel: 'Prior',
			syncedAt: now,
			isAvailable: true,
			metadataJson: '{}'
		});
		await database.update(tournaments).set({ activeCatalogSnapshotId: 'prior-snapshot' });
		await client.execute(
			`CREATE TRIGGER reject_catalog_activation BEFORE UPDATE OF active_catalog_snapshot_id ON tournaments
			 BEGIN SELECT RAISE(ABORT, 'activation failed'); END`
		);
		const url = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;

		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '14.10',
				locale: 'en_us',
				fetchJson: fixtureFetch({ [url]: cdragonFixture() }, [])
			})
		).rejects.toThrow();

		expect((await database.select().from(catalogSnapshots)).map(({ id }) => id)).toEqual([
			'prior-snapshot'
		]);
		expect(await database.select().from(catalogChampions)).toEqual([]);
		expect(await database.select().from(catalogAugments)).toEqual([]);
		const [tournament] = await database.select().from(tournaments);
		expect(tournament.activeCatalogSnapshotId).toBe('prior-snapshot');
	});

	test('rejects a candidate that would expose a non-HTTPS catalog icon', async () => {
		/** @type {string[]} */
		const calls = [];
		const cdragon = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;
		const ddragon = `${DDRAGON_ROOT}/cdn/14.10/data/en_US/tft-champion.json`;
		const unsafe = cdragonFixture();
		unsafe.sets['13'].champions[0].squareIcon = 'http://assets.example.test/ahri.png';
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'en_us',
			fetchJson: fixtureFetch(
				{
					[cdragon]: unsafe,
					[ddragon]: new Error('missing')
				},
				calls
			)
		});

		expect(calls).toEqual([cdragon, ddragon]);
		expect(result.activated).toBe(false);
		expect(await database.select().from(catalogSnapshots)).toEqual([]);
	});
});
