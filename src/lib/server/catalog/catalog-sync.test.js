import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { zipSync } from 'fflate';
import tar from 'tar-stream';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { tournaments } from '../db/schema/tournaments.js';
import {
	catalogOperatorMessage,
	CatalogSyncError,
	resolveDdragonVersion,
	syncAndActivateCatalog
} from './catalog-sync.js';

const CDRAGON_ROOT = 'https://raw.communitydragon.org';
const DDRAGON_ROOT = 'https://ddragon.leagueoflegends.com';
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

function cdragonFixture({
	icon = true,
	augment = true,
	modernPaths = false,
	setNumber = 13,
	setName = 'Into the Arcane'
} = {}) {
	const championIcon = modernPaths
		? 'ASSETS/UX/TFT/Champions/Ahri_Mobile.tex'
		: '/lol-game-data/assets/ASSETS/UX/TFT/Champions/Ahri.PNG';
	const augmentIcon = modernPaths
		? 'ASSETS/Maps/TFT/Icons/Augments/Hexcore/Lotus.tex'
		: '/lol-game-data/assets/ASSETS/Maps/TFT/Icons/Augments/Lotus.PNG';
	return {
		setData: [
			{
				name: setName,
				number: setNumber,
				mutator: `TFTSet${setNumber}`,
				champions: [
					{
						apiName: `TFT${setNumber}_Ahri`,
						name: 'Ahri localized',
						squareIcon: icon ? championIcon : null,
						cost: 4,
						traits: ['Arcana']
					}
				],
				augments: augment ? ['TFT_Augment_JeweledLotus'] : []
			}
		],
		items: augment
			? [
					{
						apiName: 'TFT_Augment_JeweledLotus',
						name: 'Jeweled Lotus',
						icon: augmentIcon
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

function ddragonZip({ locale = 'en_US' } = {}) {
	const version = '10.10.5';
	return Buffer.from(
		zipSync({
			[`${version}/data/${locale}/tft-champion.json`]: Buffer.from(
				JSON.stringify(ddragonChampionFixture())
			),
			[`${version}/data/${locale}/tft-augments.json`]: Buffer.from(
				JSON.stringify(ddragonAugmentFixture())
			),
			[`${version}/img/tft-champion/TFT13_Ahri.png`]: PNG,
			[`${version}/img/tft-augment/TFT_Augment_JeweledLotus.png`]: PNG
		})
	);
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

async function correctionApi() {
	let api;
	try {
		api = await import('./catalog-corrections.js');
	} catch (error) {
		expect.fail(
			`catalog correction maintenance must be exposed from catalog-corrections.js: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	expect(api.excludeCatalogResource).toBeTypeOf('function');
	expect(api.restoreCatalogResource).toBeTypeOf('function');
	return /** @type {{ excludeCatalogResource: (...args: any[]) => Promise<any>, restoreCatalogResource: (...args: any[]) => Promise<any> }} */ (
		api
	);
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
			'DROP TABLE IF EXISTS winner_board_state_augments',
			'DROP TABLE IF EXISTS winner_board_state_champions',
			'DROP TABLE IF EXISTS winner_board_state',
			'DROP TABLE IF EXISTS graphic_state',
			'DROP TABLE IF EXISTS winner_board_publications',
			'DROP TABLE IF EXISTS players',
			'DROP TABLE IF EXISTS tournaments',
			'DROP TABLE IF EXISTS catalog_augments',
			'DROP TABLE IF EXISTS catalog_champions',
			'DROP TABLE IF EXISTS catalog_snapshots',
			'DROP TABLE IF EXISTS catalog_corrections',
			`CREATE TABLE catalog_snapshots (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL, locale TEXT NOT NULL, patch_label TEXT NOT NULL, set_label TEXT, canonical_set_key TEXT, synced_at INTEGER NOT NULL, is_available INTEGER DEFAULT 0 NOT NULL, metadata_json TEXT NOT NULL)`,
			`CREATE TABLE catalog_corrections (id TEXT PRIMARY KEY NOT NULL, canonical_set_key TEXT, patch_label TEXT NOT NULL, resource_kind TEXT NOT NULL, operation TEXT NOT NULL, target_external_id TEXT, manual_external_id TEXT, display_name_override TEXT, tier_override INTEGER, image_path_override TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
			`CREATE TABLE catalog_champions (id TEXT PRIMARY KEY NOT NULL, catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE, external_id TEXT NOT NULL, display_name TEXT NOT NULL, icon_path TEXT, tier INTEGER, metadata_json TEXT NOT NULL, correction_id TEXT REFERENCES catalog_corrections(id) ON DELETE SET NULL, is_excluded INTEGER DEFAULT 0 NOT NULL, provenance_json TEXT DEFAULT '{"source":"upstream"}' NOT NULL, UNIQUE(catalog_snapshot_id, external_id))`,
			`CREATE TABLE catalog_augments (id TEXT PRIMARY KEY NOT NULL, catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE, external_id TEXT NOT NULL, display_name TEXT NOT NULL, icon_path TEXT, tier INTEGER, metadata_json TEXT NOT NULL, correction_id TEXT REFERENCES catalog_corrections(id) ON DELETE SET NULL, is_excluded INTEGER DEFAULT 0 NOT NULL, provenance_json TEXT DEFAULT '{"source":"upstream"}' NOT NULL, UNIQUE(catalog_snapshot_id, external_id))`,
			`CREATE TABLE tournaments (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, active_catalog_snapshot_id TEXT REFERENCES catalog_snapshots(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
			`CREATE TABLE players (id TEXT PRIMARY KEY NOT NULL, riot_id TEXT, riot_id_key TEXT UNIQUE, riot_game_name TEXT, riot_tagline TEXT, full_name TEXT NOT NULL, display_name TEXT NOT NULL, image_path TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
			`CREATE TABLE winner_board_publications (id TEXT PRIMARY KEY NOT NULL, source_state_updated_at INTEGER NOT NULL, graphic_version INTEGER NOT NULL UNIQUE, render_payload_json TEXT NOT NULL, media_directory TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)`,
			`CREATE TABLE graphic_state (id TEXT PRIMARY KEY NOT NULL, published_publication_id TEXT REFERENCES winner_board_publications(id) ON DELETE SET NULL, version INTEGER DEFAULT 0 NOT NULL, updated_at INTEGER NOT NULL)`,
			`CREATE TABLE winner_board_state (id TEXT PRIMARY KEY NOT NULL, tournament_id TEXT NOT NULL REFERENCES tournaments(id), winner_player_id TEXT NOT NULL REFERENCES players(id), title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
			`CREATE TABLE winner_board_state_champions (id TEXT PRIMARY KEY NOT NULL, winner_board_state_id TEXT NOT NULL REFERENCES winner_board_state(id) ON DELETE CASCADE, catalog_champion_id TEXT NOT NULL REFERENCES catalog_champions(id) ON DELETE RESTRICT, star_level INTEGER, display_order INTEGER NOT NULL)`,
			`CREATE TABLE winner_board_state_augments (id TEXT PRIMARY KEY NOT NULL, winner_board_state_id TEXT NOT NULL REFERENCES winner_board_state(id) ON DELETE CASCADE, catalog_augment_id TEXT NOT NULL REFERENCES catalog_augments(id) ON DELETE RESTRICT, display_order INTEGER NOT NULL)`
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

	test('normalizes the standard CommunityDragon set and modern game asset paths', async () => {
		const fixture = cdragonFixture({ modernPaths: true });
		fixture.setData[0].number = 17;
		fixture.setData[0].mutator = 'TFTSet17';
		fixture.setData[0].name = 'Set 17';
		fixture.setData[0].champions.push(
			{
				apiName: 'TFT17_PVE_Minion',
				name: 'Cosmic Squid',
				squareIcon: 'ASSETS/UX/TFT/ChampionSplashes/PVE.tex',
				cost: 1,
				traits: []
			},
			{
				apiName: 'TFT17_Summon',
				name: 'Summon',
				squareIcon: 'ASSETS/UX/TFT/ChampionSplashes/Summon.tex',
				cost: 11,
				traits: ['Special']
			}
		);
		fixture.setData.push({
			name: 'Set 17 Event',
			number: 17,
			mutator: 'TFTSetEvent5YR',
			champions: [
				{
					apiName: 'TFTEvent_Fake',
					name: 'Event unit',
					squareIcon: 'ASSETS/UX/TFT/ChampionSplashes/Event.tex',
					cost: 3,
					traits: ['Event']
				}
			],
			augments: []
		});
		fixture.items.push({
			apiName: 'TFT_Augment_Historical',
			name: 'Historical augment',
			icon: 'ASSETS/Maps/TFT/Icons/Augments/Historical.tex'
		});
		const catalogUrl = `${CDRAGON_ROOT}/16.15/cdragon/tft/en_us.json`;
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '16.15',
			locale: 'en_us',
			mediaRoot,
			fetchJson: fixtureJson({ [catalogUrl]: fixture }, []),
			fetchResponse: fixtureResponse({
				[`${CDRAGON_ROOT}/16.15/game/assets/ux/tft/champions/ahri_mobile.png`]: new Response(PNG),
				[`${CDRAGON_ROOT}/16.15/game/assets/maps/tft/icons/augments/hexcore/lotus.png`]:
					new Response(PNG)
			})
		});

		expect(result).toMatchObject({ source: 'communitydragon' });
		expect(result.champions.map((champion) => champion.externalId)).toEqual(['TFT13_Ahri']);
		expect(result.augments.map((augment) => augment.externalId)).toEqual([
			'TFT_Augment_JeweledLotus'
		]);
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
		expect(result.warning).toContain('CommunityDragon failed during downloading');
		expect(result.warning).toContain('Data Dragon was used instead');
		expect(responseCalls.at(-1)).toBe(archiveUrl);
		expect(result.champions[0].iconPath).toContain('/media/catalog-assets/');
		expect(await readdir(path.join(mediaRoot, 'catalog-staging'))).toEqual([]);
	});

	test('uses the documented legacy Data Dragon ZIP only when the tgz is unavailable', async () => {
		const catalogUrl = `${CDRAGON_ROOT}/10.10/cdragon/tft/en_us.json`;
		const tgzUrl = `${DDRAGON_ROOT}/cdn/dragontail-10.10.5.tgz`;
		const zipUrl = `${DDRAGON_ROOT}/cdn/dragontail-10.10.5.zip`;
		/** @type {string[]} */
		const responseCalls = [];
		const result = await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '10.10',
			locale: 'en_us',
			mediaRoot,
			fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture() }, []),
			fetchResponse: fixtureResponse(
				{
					[tgzUrl]: new Response('missing', { status: 404 }),
					[zipUrl]: new Response(Uint8Array.from(ddragonZip()))
				},
				responseCalls
			),
			getVersions: async () => ['10.10.5']
		});

		expect(result.source).toBe('datadragon');
		expect(responseCalls.slice(-2)).toEqual([tgzUrl, zipUrl]);
	});

	test('reports configured Data Dragon package limits and removes staging files', async () => {
		const catalogUrl = `${CDRAGON_ROOT}/16.15/cdragon/tft/en_us.json`;
		const archiveUrl = `${DDRAGON_ROOT}/cdn/dragontail-16.15.1.tgz`;
		const logger = { warn: vi.fn(), error: vi.fn() };
		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '16.15',
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture() }, []),
				fetchResponse: fixtureResponse({
					[archiveUrl]: new Response('0123456789', {
						headers: { 'Content-Length': '10' }
					})
				}),
				getVersions: async () => ['16.15.1'],
				archiveLimits: { maxArchiveBytes: 9, maxExtractedBytes: 100 },
				logger
			})
		).rejects.toThrow('package exceeded the configured size limit');
		expect(logger.warn).toHaveBeenCalledWith(
			'catalog_sync_attempt_failed',
			expect.objectContaining({ source: 'datadragon', category: 'size_limit' })
		);
		expect(await readdir(path.join(mediaRoot, 'catalog-staging'))).toEqual([]);
	});

	test('rejects unresolved augment references instead of activating an incomplete candidate', async () => {
		const fixture = cdragonFixture();
		fixture.setData[0].augments = ['TFT_Augment_Missing'];
		const catalogUrl = `${CDRAGON_ROOT}/16.15/cdragon/tft/en_us.json`;
		const logger = { warn: vi.fn(), error: vi.fn() };
		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '16.15',
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson({ [catalogUrl]: fixture }, []),
				fetchResponse: fixtureResponse({}),
				getVersions: async () => ['16.15.1'],
				logger
			})
		).rejects.toThrow('prior snapshot remains active');
		expect(logger.warn).toHaveBeenCalledWith(
			'catalog_sync_attempt_failed',
			expect.objectContaining({
				source: 'communitydragon',
				category: 'invalid_catalog',
				cause: 'CommunityDragon augment TFT_Augment_Missing was unresolved'
			})
		);
		expect(await database.select().from(catalogSnapshots)).toEqual([]);
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
		const logger = { warn: vi.fn(), error: vi.fn() };
		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '14.10',
				locale: 'en_us',
				mediaRoot,
				fetchJson: async () => {
					throw new Error('offline');
				},
				fetchResponse: fixtureResponse({}),
				getVersions: async () => ['14.10.1'],
				logger
			})
		).rejects.toThrow(/CommunityDragon.*Data Dragon.*prior snapshot remains active/);
		expect(logger.warn).toHaveBeenCalledWith(
			'catalog_sync_attempt_failed',
			expect.objectContaining({
				tournamentId: 'tournament-1',
				source: 'communitydragon',
				phase: 'resolving',
				cause: 'offline'
			})
		);
		expect(logger.error).toHaveBeenCalledWith(
			'catalog_sync_failed',
			expect.objectContaining({
				activeSnapshotId: 'prior-snapshot',
				attempts: expect.any(Array)
			})
		);
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
		const logger = { warn: vi.fn(), error: vi.fn() };
		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '14.10',
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture({ augment: false }) }, []),
				fetchResponse: fixtureResponse({ [imageUrl]: new Response(PNG) }),
				logger
			})
		).rejects.toThrow(/database could not activate.*Sync reference:/);
		expect(logger.error).toHaveBeenCalledWith(
			'catalog_sync_unexpected_failure',
			expect.objectContaining({
				tournamentId: 'tournament-1',
				phase: 'activating',
				cause: 'activation failed'
			})
		);
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

	test('materializes add, partial override, exclude, and restore corrections with optional images', async () => {
		const now = Date.parse('2026-08-08T00:00:00.000Z');
		const manualImagePath = 'catalog-corrections/add-manual-image.png';
		await mkdir(path.join(mediaRoot, 'catalog-corrections'), { recursive: true });
		await writeFile(path.join(mediaRoot, ...manualImagePath.split('/')), PNG);
		await client.batch([
			{
				sql: `INSERT INTO catalog_corrections (id, canonical_set_key, patch_label, resource_kind, operation, manual_external_id, display_name_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'add-manual',
					'TFTSet13',
					'14.10',
					'champion',
					'add',
					'TFT13_ManualHero',
					'Manual Hero',
					now,
					now
				]
			},
			{
				sql: `INSERT INTO catalog_corrections (id, canonical_set_key, patch_label, resource_kind, operation, manual_external_id, display_name_override, image_path_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'add-manual-image',
					'TFTSet13',
					'14.10',
					'champion',
					'add',
					'TFT13_ManualWithImage',
					'Manual With Image',
					manualImagePath,
					now,
					now
				]
			},
			{
				sql: `INSERT INTO catalog_corrections (id, canonical_set_key, patch_label, resource_kind, operation, target_external_id, display_name_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'override-ahri',
					'TFTSet13',
					'14.10',
					'champion',
					'override',
					'TFT13_Ahri',
					'Ahri Corrected',
					now,
					now
				]
			},
			{
				sql: `INSERT INTO catalog_corrections (id, canonical_set_key, patch_label, resource_kind, operation, target_external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'exclude-lotus',
					'TFTSet13',
					'14.10',
					'augment',
					'exclude',
					'TFT_Augment_JeweledLotus',
					now,
					now
				]
			}
		]);

		for (const patch of ['14.10', '14.11']) {
			const catalogUrl = `${CDRAGON_ROOT}/${patch}/cdragon/tft/en_us.json`;
			const imageRoot = `${CDRAGON_ROOT}/${patch}/plugins/rcp-be-lol-game-data/global/default/`;
			await syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch,
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture({ icon: false }) }, []),
				fetchResponse: fixtureResponse({
					[`${imageRoot}assets/maps/tft/icons/augments/lotus.png`]: new Response(PNG)
				})
			});

			const [{ active_catalog_snapshot_id: snapshotId }] = /** @type {any[]} */ (
				(await client.execute('SELECT active_catalog_snapshot_id FROM tournaments')).rows
			);
			const champions = /** @type {any[]} */ (
				(
					await client.execute({
						sql: 'SELECT id, external_id, display_name, icon_path, tier, correction_id, is_excluded, provenance_json FROM catalog_champions WHERE catalog_snapshot_id = ? ORDER BY external_id',
						args: [snapshotId]
					})
				).rows
			);
			const augments = /** @type {any[]} */ (
				(
					await client.execute({
						sql: 'SELECT id, external_id, correction_id, is_excluded FROM catalog_augments WHERE catalog_snapshot_id = ?',
						args: [snapshotId]
					})
				).rows
			);

			expect(champions).toEqual([
				expect.objectContaining({
					external_id: 'TFT13_Ahri',
					display_name: 'Ahri Corrected',
					tier: 4,
					correction_id: 'override-ahri',
					is_excluded: 0
				}),
				expect.objectContaining({
					external_id: 'TFT13_ManualHero',
					display_name: 'Manual Hero',
					icon_path: null,
					correction_id: 'add-manual',
					is_excluded: 0
				}),
				expect.objectContaining({
					external_id: 'TFT13_ManualWithImage',
					display_name: 'Manual With Image',
					icon_path: expect.stringMatching(/^\/media\/catalog-assets\/.+\.png$/),
					correction_id: 'add-manual-image',
					is_excluded: 0
				})
			]);
			const manualWithImage = champions.find(
				({ external_id }) => external_id === 'TFT13_ManualWithImage'
			);
			expect(
				await readFile(
					path.join(mediaRoot, ...manualWithImage.icon_path.replace('/media/', '').split('/'))
				)
			).toEqual(PNG);
			expect(champions.every(({ provenance_json }) => JSON.parse(provenance_json))).toBe(true);
			expect(augments).toEqual([
				expect.objectContaining({
					external_id: 'TFT_Augment_JeweledLotus',
					correction_id: patch === '14.10' ? 'exclude-lotus' : null,
					is_excluded: patch === '14.10' ? 1 : 0
				})
			]);

			if (patch === '14.10') {
				const { restoreCatalogResource } = await correctionApi();
				await expect(
					restoreCatalogResource(database, {
						tournamentId: 'tournament-1',
						resourceKind: 'augment',
						resourceId: augments[0].id
					})
				).resolves.toMatchObject({ restored: true });
				expect(
					(
						await client.execute({
							sql: 'SELECT correction_id, is_excluded FROM catalog_augments WHERE catalog_snapshot_id = ? AND external_id = ?',
							args: [snapshotId, 'TFT_Augment_JeweledLotus']
						})
					).rows
				).toEqual([{ correction_id: null, is_excluded: 0 }]);
			}
		}
	});

	test('requires reset confirmation before excluding a resource selected by saved state', async () => {
		const catalogUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;
		await syncAndActivateCatalog({
			db: database,
			tournamentId: 'tournament-1',
			patch: '14.10',
			locale: 'en_us',
			mediaRoot,
			fetchJson: fixtureJson({ [catalogUrl]: cdragonFixture({ icon: false, augment: false }) }, []),
			fetchResponse: fixtureResponse({})
		});
		const [champion] = /** @type {any[]} */ (
			(await client.execute("SELECT id FROM catalog_champions WHERE external_id = 'TFT13_Ahri'"))
				.rows
		);
		const timestamp = Date.parse('2026-08-08T00:00:00.000Z');
		await client.batch([
			{
				sql: 'INSERT INTO players (id, full_name, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
				args: ['player-one', 'Player One', 'Winner One', timestamp, timestamp]
			},
			{
				sql: 'INSERT INTO winner_board_publications (id, source_state_updated_at, graphic_version, render_payload_json, media_directory, created_at) VALUES (?, ?, ?, ?, ?, ?)',
				args: [
					'publication-one',
					timestamp,
					1,
					'{"title":"Published winner"}',
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
				args: ['current', 'tournament-1', 'player-one', 'Winner', timestamp, timestamp]
			},
			{
				sql: 'INSERT INTO winner_board_state_champions (id, winner_board_state_id, catalog_champion_id, star_level, display_order) VALUES (?, ?, ?, ?, ?)',
				args: ['selected-champion', 'current', champion.id, 3, 0]
			}
		]);
		const { excludeCatalogResource } = await correctionApi();

		await expect(
			excludeCatalogResource(database, {
				tournamentId: 'tournament-1',
				resourceKind: 'champion',
				resourceId: champion.id,
				confirmReset: false
			})
		).resolves.toMatchObject({ kind: 'reset_required', label: 'Ahri localized' });
		expect((await client.execute('SELECT id FROM winner_board_state')).rows).toEqual([
			{ id: 'current' }
		]);
		expect(
			(
				await client.execute({
					sql: 'SELECT is_excluded FROM catalog_champions WHERE id = ?',
					args: [champion.id]
				})
			).rows
		).toEqual([{ is_excluded: 0 }]);

		await expect(
			excludeCatalogResource(database, {
				tournamentId: 'tournament-1',
				resourceKind: 'champion',
				resourceId: champion.id,
				confirmReset: true
			})
		).resolves.toMatchObject({ excluded: true, reset: true });
		expect((await client.execute('SELECT * FROM winner_board_state')).rows).toEqual([]);
		expect(
			(await client.execute('SELECT published_publication_id FROM graphic_state')).rows
		).toEqual([{ published_publication_id: null }]);
		expect((await client.execute('SELECT id FROM winner_board_publications')).rows).toEqual([
			{ id: 'publication-one' }
		]);
		expect(
			(
				await client.execute({
					sql: 'SELECT correction_id, is_excluded FROM catalog_champions WHERE id = ?',
					args: [champion.id]
				})
			).rows
		).toEqual([{ correction_id: expect.any(String), is_excluded: 1 }]);
	});

	test('reapplies a correction to the same canonical set without leaking it to another set', async () => {
		const now = Date.parse('2026-08-08T00:00:00.000Z');
		await client.execute({
			sql: `INSERT INTO catalog_corrections (id, canonical_set_key, patch_label, resource_kind, operation, target_external_id, display_name_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				'override-set-13',
				'TFTSet13',
				'14.10',
				'champion',
				'override',
				'TFT13_Ahri',
				'Set 13 Ahri',
				now,
				now
			]
		});

		for (const fixture of [
			{ patch: '14.10', setNumber: 13, expectedName: 'Set 13 Ahri' },
			{ patch: '14.11', setNumber: 13, expectedName: 'Set 13 Ahri' },
			{ patch: '14.12', setNumber: 14, expectedName: 'Ahri localized' }
		]) {
			const catalogUrl = `${CDRAGON_ROOT}/${fixture.patch}/cdragon/tft/en_us.json`;
			const result = await syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: fixture.patch,
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson(
					{
						[catalogUrl]: cdragonFixture({
							icon: false,
							augment: false,
							setNumber: fixture.setNumber,
							setName: `Set ${fixture.setNumber}`
						})
					},
					[]
				),
				fetchResponse: fixtureResponse({})
			});

			expect(result.champions[0]).toMatchObject({ displayName: fixture.expectedName });
		}

		const snapshots = /** @type {any[]} */ (
			(await client.execute('SELECT canonical_set_key FROM catalog_snapshots ORDER BY patch_label'))
				.rows
		);
		expect(snapshots).toEqual([
			{ canonical_set_key: 'TFTSet13' },
			{ canonical_set_key: 'TFTSet13' },
			{ canonical_set_key: 'TFTSet14' }
		]);
	});

	test('preserves the active snapshot and removes staging when a manual image is missing', async () => {
		const now = Date.parse('2026-08-08T00:00:00.000Z');
		await client.batch([
			{
				sql: `INSERT INTO catalog_snapshots (id, source, source_url, locale, patch_label, set_label, canonical_set_key, synced_at, is_available, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'prior-snapshot',
					'communitydragon',
					'https://example.test/prior.json',
					'en_us',
					'14.9',
					'Set 13',
					'TFTSet13',
					now,
					1,
					'{}'
				]
			},
			{
				sql: `INSERT INTO catalog_corrections (id, canonical_set_key, patch_label, resource_kind, operation, manual_external_id, display_name_override, image_path_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'missing-manual-image',
					'TFTSet13',
					'14.10',
					'champion',
					'add',
					'TFT13_ManualMissing',
					'Manual Missing',
					'catalog-corrections/missing.png',
					now,
					now
				]
			}
		]);
		await client.execute(
			"UPDATE tournaments SET active_catalog_snapshot_id = 'prior-snapshot' WHERE id = 'tournament-1'"
		);
		const catalogUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;

		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '14.10',
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson(
					{ [catalogUrl]: cdragonFixture({ icon: false, augment: false }) },
					[]
				),
				fetchResponse: fixtureResponse({})
			})
		).rejects.toThrow(/prior snapshot remains active/i);
		expect(
			(await client.execute('SELECT active_catalog_snapshot_id FROM tournaments')).rows
		).toEqual([{ active_catalog_snapshot_id: 'prior-snapshot' }]);
		expect((await client.execute('SELECT id FROM catalog_snapshots')).rows).toEqual([
			{ id: 'prior-snapshot' }
		]);
		expect(await readdir(path.join(mediaRoot, 'catalog-staging'))).toEqual([]);
		expect(
			await readdir(path.join(mediaRoot, 'catalog-assets')).catch((error) => {
				if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
				throw error;
			})
		).toEqual([]);
	});

	test('preserves the active snapshot when applying a malformed correction fails', async () => {
		const now = Date.parse('2026-08-08T00:00:00.000Z');
		await client.execute({
			sql: `INSERT INTO catalog_snapshots (id, source, source_url, locale, patch_label, set_label, canonical_set_key, synced_at, is_available, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				'prior-snapshot',
				'communitydragon',
				'https://example.test/prior.json',
				'en_us',
				'14.9',
				'Set 13',
				'TFTSet13',
				now,
				1,
				'{}'
			]
		});
		await client.execute(
			"UPDATE tournaments SET active_catalog_snapshot_id = 'prior-snapshot' WHERE id = 'tournament-1'"
		);
		await client.execute({
			sql: `INSERT INTO catalog_corrections (id, canonical_set_key, patch_label, resource_kind, operation, display_name_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: ['invalid-add', 'TFTSet13', '14.10', 'champion', 'add', 'Missing identity', now, now]
		});
		const catalogUrl = `${CDRAGON_ROOT}/14.10/cdragon/tft/en_us.json`;

		await expect(
			syncAndActivateCatalog({
				db: database,
				tournamentId: 'tournament-1',
				patch: '14.10',
				locale: 'en_us',
				mediaRoot,
				fetchJson: fixtureJson(
					{ [catalogUrl]: cdragonFixture({ icon: false, augment: false }) },
					[]
				),
				fetchResponse: fixtureResponse({})
			})
		).rejects.toThrow(/correction|manual external/i);
		expect(
			(await client.execute('SELECT active_catalog_snapshot_id FROM tournaments')).rows
		).toEqual([{ active_catalog_snapshot_id: 'prior-snapshot' }]);
	});
});

test('Data Dragon version resolution selects latest exact patch-prefix match', () => {
	expect(resolveDdragonVersion(['16.14.1', '16.15.1', '16.15.3'], '16.15')).toBe('16.15.3');
	expect(resolveDdragonVersion(['16.15.3', '16.15.1'], 'latest')).toBe('16.15.3');
	expect(() => resolveDdragonVersion(['16.15.1'], '16.16')).toThrow('was not found');
});

test('operator messages preserve catalog diagnostics but sanitize unexpected failures', () => {
	expect(catalogOperatorMessage(new CatalogSyncError('Safe source summary.', []))).toBe(
		'Safe source summary.'
	);
	expect(catalogOperatorMessage(new Error('C:\\private\\database.db failed'))).toBe(
		'Catalog synchronization failed; the prior snapshot remains active.'
	);
});
