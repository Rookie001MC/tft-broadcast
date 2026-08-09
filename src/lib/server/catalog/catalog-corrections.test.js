import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { catalogChampions, catalogCorrections, catalogSnapshots } from '../db/schema/catalog.js';
import {
	applyCatalogCorrections,
	createCatalogCorrection,
	excludeCatalogResource,
	restoreCatalogResource,
	updateCatalogCorrection
} from './catalog-corrections.js';

const upstreamChampion = {
	externalId: 'TFT13_Ahri',
	displayName: 'Ahri',
	iconPath: '/media/catalog-assets/__SNAPSHOT__/champions/ahri.png',
	tier: 4,
	metadataJson: '{"apiName":"TFT13_Ahri"}'
};

describe('applyCatalogCorrections', () => {
	test('returns normalized upstream records when there are no corrections', () => {
		expect(
			applyCatalogCorrections({
				resources: [upstreamChampion],
				corrections: [],
				canonicalSetKey: 'TFTSet13',
				patchLabel: '14.10'
			})
		).toEqual([
			expect.objectContaining({
				externalId: 'TFT13_Ahri',
				correctionId: null,
				isExcluded: false,
				provenanceJson: expect.any(String)
			})
		]);
	});

	test('scopes corrections, overlays only supplied fields, and records provenance', () => {
		const result = applyCatalogCorrections({
			resources: [upstreamChampion],
			resourceKind: 'champion',
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.11',
			corrections: [
				{
					id: 'override-same-set',
					canonicalSetKey: 'TFTSet13',
					patchLabel: '14.10',
					resourceKind: 'champion',
					operation: 'override',
					targetExternalId: 'TFT13_Ahri',
					displayNameOverride: 'Ahri Corrected',
					tierOverride: null,
					imagePathOverride: null
				},
				{
					id: 'patch-only-other-patch',
					canonicalSetKey: null,
					patchLabel: '14.10',
					resourceKind: 'champion',
					operation: 'exclude',
					targetExternalId: 'TFT13_Ahri'
				},
				{
					id: 'manual-same-set',
					canonicalSetKey: 'TFTSet13',
					patchLabel: '14.10',
					resourceKind: 'champion',
					operation: 'add',
					manualExternalId: 'TFT13_Manual',
					displayNameOverride: 'Manual Hero',
					tierOverride: 5,
					imagePathOverride: null
				}
			]
		});

		expect(result).toEqual([
			expect.objectContaining({
				externalId: 'TFT13_Ahri',
				displayName: 'Ahri Corrected',
				tier: 4,
				correctionId: 'override-same-set',
				isExcluded: false,
				provenanceJson: expect.any(String)
			}),
			expect.objectContaining({
				externalId: 'TFT13_Manual',
				displayName: 'Manual Hero',
				tier: 5,
				iconPath: null,
				correctionId: 'manual-same-set',
				isExcluded: false,
				provenanceJson: expect.any(String)
			})
		]);
		expect(JSON.parse(result[0].provenanceJson)).toMatchObject({
			source: 'upstream',
			correctionId: 'override-same-set'
		});
		expect(JSON.parse(result[1].provenanceJson)).toMatchObject({
			source: 'manual',
			correctionId: 'manual-same-set'
		});
	});

	test('uses exact patch scope without a canonical set and marks exclusions', () => {
		const [result] = applyCatalogCorrections({
			resources: [upstreamChampion],
			resourceKind: 'champion',
			canonicalSetKey: null,
			patchLabel: '16.15.1',
			corrections: [
				{
					id: 'patch-exclusion',
					canonicalSetKey: null,
					patchLabel: '16.15.1',
					resourceKind: 'champion',
					operation: 'exclude',
					targetExternalId: 'TFT13_Ahri'
				}
			]
		});

		expect(result).toMatchObject({
			externalId: 'TFT13_Ahri',
			correctionId: 'patch-exclusion',
			isExcluded: true
		});
	});

	test('does not let a later override implicitly restore an exclusion', () => {
		const [result] = applyCatalogCorrections({
			resources: [upstreamChampion],
			resourceKind: 'champion',
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			corrections: [
				{
					id: 'exclude-ahri',
					canonicalSetKey: 'TFTSet13',
					patchLabel: '14.10',
					resourceKind: 'champion',
					operation: 'exclude',
					targetExternalId: 'TFT13_Ahri'
				},
				{
					id: 'override-ahri',
					canonicalSetKey: 'TFTSet13',
					patchLabel: '14.10',
					resourceKind: 'champion',
					operation: 'override',
					targetExternalId: 'TFT13_Ahri',
					displayNameOverride: 'Ahri Corrected'
				}
			]
		});

		expect(result).toMatchObject({ displayName: 'Ahri Corrected', isExcluded: true });
	});

	test('preserves manual provenance when a later correction targets a manual entry', () => {
		const [result] = applyCatalogCorrections({
			resources: [],
			resourceKind: 'champion',
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			corrections: [
				{
					id: 'add-manual',
					canonicalSetKey: 'TFTSet13',
					patchLabel: '14.10',
					resourceKind: 'champion',
					operation: 'add',
					manualExternalId: 'TFT13_Manual'
				},
				{
					id: 'exclude-manual',
					canonicalSetKey: 'TFTSet13',
					patchLabel: '14.10',
					resourceKind: 'champion',
					operation: 'exclude',
					targetExternalId: 'TFT13_Manual'
				}
			]
		});

		expect(JSON.parse(result.provenanceJson)).toMatchObject({
			source: 'manual',
			correctionId: 'exclude-manual',
			previous: { correctionId: 'add-manual', source: 'manual' }
		});
	});

	test('rejects duplicate external IDs within a resource kind', () => {
		expect(() =>
			applyCatalogCorrections({
				resources: [upstreamChampion],
				resourceKind: 'champion',
				canonicalSetKey: 'TFTSet13',
				patchLabel: '14.10',
				corrections: [
					{
						id: 'duplicate-add',
						canonicalSetKey: 'TFTSet13',
						patchLabel: '14.10',
						resourceKind: 'champion',
						operation: 'add',
						manualExternalId: 'TFT13_Ahri'
					}
				]
			})
		).toThrow(/unique external ID/i);
	});
});

describe('catalog correction persistence', () => {
	/** @type {import('@libsql/client').Client} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: 'file::memory:?cache=shared' });
		database = drizzle(client);
		await client.batch([
			'PRAGMA foreign_keys = ON',
			'DROP TABLE IF EXISTS winner_board_state_augments',
			'DROP TABLE IF EXISTS winner_board_state_champions',
			'DROP TABLE IF EXISTS tournaments',
			'DROP TABLE IF EXISTS catalog_augments',
			'DROP TABLE IF EXISTS catalog_champions',
			'DROP TABLE IF EXISTS catalog_corrections',
			'DROP TABLE IF EXISTS catalog_snapshots',
			`CREATE TABLE catalog_snapshots (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL, locale TEXT NOT NULL, patch_label TEXT NOT NULL, set_label TEXT, canonical_set_key TEXT, synced_at INTEGER NOT NULL, is_available INTEGER DEFAULT 0 NOT NULL, metadata_json TEXT NOT NULL)`,
			`CREATE TABLE catalog_corrections (id TEXT PRIMARY KEY NOT NULL, canonical_set_key TEXT, patch_label TEXT NOT NULL, resource_kind TEXT NOT NULL, operation TEXT NOT NULL, target_external_id TEXT, manual_external_id TEXT, display_name_override TEXT, tier_override INTEGER, image_path_override TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
			`CREATE TABLE catalog_champions (id TEXT PRIMARY KEY NOT NULL, catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE, external_id TEXT NOT NULL, display_name TEXT NOT NULL, icon_path TEXT, tier INTEGER, metadata_json TEXT NOT NULL, correction_id TEXT REFERENCES catalog_corrections(id) ON DELETE SET NULL, is_excluded INTEGER DEFAULT 0 NOT NULL, provenance_json TEXT DEFAULT '{"source":"upstream"}' NOT NULL, UNIQUE(catalog_snapshot_id, external_id))`,
			`CREATE TABLE catalog_augments (id TEXT PRIMARY KEY NOT NULL, catalog_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE, external_id TEXT NOT NULL, display_name TEXT NOT NULL, icon_path TEXT, tier INTEGER, metadata_json TEXT NOT NULL, correction_id TEXT REFERENCES catalog_corrections(id) ON DELETE SET NULL, is_excluded INTEGER DEFAULT 0 NOT NULL, provenance_json TEXT DEFAULT '{"source":"upstream"}' NOT NULL, UNIQUE(catalog_snapshot_id, external_id))`,
			`CREATE TABLE winner_board_state_champions (id TEXT PRIMARY KEY NOT NULL, winner_board_state_id TEXT NOT NULL, catalog_champion_id TEXT NOT NULL REFERENCES catalog_champions(id), star_level INTEGER, display_order INTEGER NOT NULL)`,
			`CREATE TABLE winner_board_state_augments (id TEXT PRIMARY KEY NOT NULL, winner_board_state_id TEXT NOT NULL, catalog_augment_id TEXT NOT NULL REFERENCES catalog_augments(id), display_order INTEGER NOT NULL)`,
			`CREATE TABLE tournaments (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, active_catalog_snapshot_id TEXT REFERENCES catalog_snapshots(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`
		]);
	});

	afterEach(() => client.close());

	test('validates operation identities before persisting', async () => {
		await expect(
			createCatalogCorrection(database, {
				canonicalSetKey: 'TFTSet13',
				patchLabel: '14.10',
				resourceKind: 'champion',
				operation: 'add',
				displayNameOverride: 'Missing ID'
			})
		).rejects.toThrow(/manual external ID/i);
		await expect(
			createCatalogCorrection(database, {
				canonicalSetKey: null,
				patchLabel: '14.10',
				resourceKind: 'augment',
				operation: 'override',
				displayNameOverride: 'Missing target'
			})
		).rejects.toThrow(/target external ID/i);
		expect(await database.select().from(catalogCorrections)).toEqual([]);
	});

	test('creates and partially updates a valid correction', async () => {
		const created = await createCatalogCorrection(database, {
			canonicalSetKey: ' TFTSet13 ',
			patchLabel: ' 14.10 ',
			resourceKind: 'champion',
			operation: 'add',
			manualExternalId: ' TFT13_Manual ',
			displayNameOverride: 'Manual Hero'
		});
		const updated = await updateCatalogCorrection(database, {
			correctionId: created.id,
			tierOverride: 5
		});

		expect(updated).toMatchObject({
			id: created.id,
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			manualExternalId: 'TFT13_Manual',
			displayNameOverride: 'Manual Hero',
			tierOverride: 5
		});
	});

	test('excludes and restores an active resource through a persisted correction', async () => {
		const now = new Date('2026-08-08T00:00:00.000Z');
		await database.insert(catalogSnapshots).values({
			id: 'snapshot-1',
			source: 'communitydragon',
			sourceUrl: 'https://example.test/catalog.json',
			locale: 'en_us',
			patchLabel: '14.10',
			setLabel: 'Set 13',
			canonicalSetKey: 'TFTSet13',
			syncedAt: now,
			isAvailable: true,
			metadataJson: '{}'
		});
		await client.execute({
			sql: 'INSERT INTO tournaments (id, name, slug, active_catalog_snapshot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			args: ['tournament-1', 'Unitour', 'unitour', 'snapshot-1', now.getTime(), now.getTime()]
		});
		await database.insert(catalogChampions).values({
			id: 'champion-1',
			catalogSnapshotId: 'snapshot-1',
			externalId: 'TFT13_Ahri',
			displayName: 'Ahri',
			iconPath: null,
			tier: 4,
			metadataJson: '{}'
		});

		const excluded = await excludeCatalogResource(database, {
			tournamentId: 'tournament-1',
			resourceKind: 'champion',
			resourceId: 'champion-1'
		});
		expect(excluded).toMatchObject({ excluded: true, reset: false });
		expect(await database.select().from(catalogCorrections)).toEqual([
			expect.objectContaining({
				canonicalSetKey: 'TFTSet13',
				operation: 'exclude',
				targetExternalId: 'TFT13_Ahri'
			})
		]);
		expect(await database.select().from(catalogChampions)).toEqual([
			expect.objectContaining({ isExcluded: true, correctionId: expect.any(String) })
		]);

		await expect(
			restoreCatalogResource(database, {
				tournamentId: 'tournament-1',
				resourceKind: 'champion',
				resourceId: 'champion-1'
			})
		).resolves.toMatchObject({ restored: true });
		expect(await database.select().from(catalogCorrections)).toEqual([]);
		expect(await database.select().from(catalogChampions)).toEqual([
			expect.objectContaining({ isExcluded: false, correctionId: null })
		]);

		const addCorrection = await createCatalogCorrection(database, {
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			resourceKind: 'champion',
			operation: 'add',
			manualExternalId: 'TFT13_Ahri'
		});
		const manualProvenance = JSON.stringify({
			source: 'manual',
			correctionId: addCorrection.id,
			operation: 'add'
		});
		await database
			.update(catalogChampions)
			.set({ correctionId: addCorrection.id, provenanceJson: manualProvenance })
			.where(eq(catalogChampions.id, 'champion-1'));
		await excludeCatalogResource(database, {
			tournamentId: 'tournament-1',
			resourceKind: 'champion',
			resourceId: 'champion-1'
		});
		await restoreCatalogResource(database, {
			tournamentId: 'tournament-1',
			resourceKind: 'champion',
			resourceId: 'champion-1'
		});

		expect(await database.select().from(catalogCorrections)).toEqual([
			expect.objectContaining({ id: addCorrection.id, operation: 'add' })
		]);
		expect(await database.select().from(catalogChampions)).toEqual([
			expect.objectContaining({
				isExcluded: false,
				correctionId: addCorrection.id,
				provenanceJson: manualProvenance
			})
		]);
	});

	test('restores every same-set materialization linked to an exclusion correction', async () => {
		const now = new Date('2026-08-08T00:00:00.000Z');
		const addCorrection = await createCatalogCorrection(database, {
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			resourceKind: 'champion',
			operation: 'add',
			manualExternalId: 'TFT13_Manual'
		});
		const manualProvenance = JSON.stringify({
			source: 'manual',
			correctionId: addCorrection.id,
			operation: 'add'
		});
		await database.insert(catalogSnapshots).values([
			{
				id: 'snapshot-1',
				source: 'communitydragon',
				sourceUrl: 'https://example.test/catalog-1.json',
				locale: 'en_us',
				patchLabel: '14.10',
				setLabel: 'Set 13',
				canonicalSetKey: 'TFTSet13',
				syncedAt: now,
				isAvailable: true,
				metadataJson: '{}'
			},
			{
				id: 'snapshot-2',
				source: 'communitydragon',
				sourceUrl: 'https://example.test/catalog-2.json',
				locale: 'en_us',
				patchLabel: '14.11',
				setLabel: 'Set 13',
				canonicalSetKey: 'TFTSet13',
				syncedAt: now,
				isAvailable: true,
				metadataJson: '{}'
			}
		]);
		await client.batch([
			{
				sql: 'INSERT INTO tournaments (id, name, slug, active_catalog_snapshot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
				args: [
					'tournament-1',
					'Unitour One',
					'unitour-one',
					'snapshot-1',
					now.getTime(),
					now.getTime()
				]
			},
			{
				sql: 'INSERT INTO tournaments (id, name, slug, active_catalog_snapshot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
				args: [
					'tournament-2',
					'Unitour Two',
					'unitour-two',
					'snapshot-2',
					now.getTime(),
					now.getTime()
				]
			}
		]);
		await database.insert(catalogChampions).values(
			['snapshot-1', 'snapshot-2'].map((catalogSnapshotId, index) => ({
				id: `manual-${index + 1}`,
				catalogSnapshotId,
				externalId: 'TFT13_Manual',
				displayName: 'Manual Hero',
				iconPath: null,
				tier: 5,
				metadataJson: '{}',
				correctionId: addCorrection.id,
				provenanceJson: manualProvenance
			}))
		);

		const excluded = await excludeCatalogResource(database, {
			tournamentId: 'tournament-1',
			resourceKind: 'champion',
			resourceId: 'manual-1'
		});
		const [firstExcluded] = await database
			.select()
			.from(catalogChampions)
			.where(eq(catalogChampions.id, 'manual-1'));
		await database
			.update(catalogChampions)
			.set({
				correctionId: excluded.correctionId,
				isExcluded: true,
				provenanceJson: firstExcluded.provenanceJson
			})
			.where(eq(catalogChampions.id, 'manual-2'));

		await restoreCatalogResource(database, {
			tournamentId: 'tournament-1',
			resourceKind: 'champion',
			resourceId: 'manual-1'
		});

		expect(
			(await database.select().from(catalogChampions)).map((resource) => ({
				id: resource.id,
				correctionId: resource.correctionId,
				isExcluded: resource.isExcluded,
				provenanceJson: resource.provenanceJson
			}))
		).toEqual([
			{
				id: 'manual-1',
				correctionId: addCorrection.id,
				isExcluded: false,
				provenanceJson: manualProvenance
			},
			{
				id: 'manual-2',
				correctionId: addCorrection.id,
				isExcluded: false,
				provenanceJson: manualProvenance
			}
		]);
		expect(await database.select().from(catalogCorrections)).toEqual([
			expect.objectContaining({ id: addCorrection.id, operation: 'add' })
		]);
	});

	test('restores layered exclusions one correction at a time', async () => {
		const now = new Date('2026-08-08T00:00:00.000Z');
		await database.insert(catalogSnapshots).values({
			id: 'snapshot-layered',
			source: 'communitydragon',
			sourceUrl: 'https://example.test/catalog-layered.json',
			locale: 'en_us',
			patchLabel: '14.10',
			setLabel: 'Set 13',
			canonicalSetKey: 'TFTSet13',
			syncedAt: now,
			isAvailable: true,
			metadataJson: '{}'
		});
		await client.execute({
			sql: 'INSERT INTO tournaments (id, name, slug, active_catalog_snapshot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			args: [
				'tournament-layered',
				'Unitour Layered',
				'unitour-layered',
				'snapshot-layered',
				now.getTime(),
				now.getTime()
			]
		});
		const first = await createCatalogCorrection(database, {
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			resourceKind: 'champion',
			operation: 'exclude',
			targetExternalId: upstreamChampion.externalId
		});
		const second = await createCatalogCorrection(database, {
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			resourceKind: 'champion',
			operation: 'exclude',
			targetExternalId: upstreamChampion.externalId
		});
		const [layered] = applyCatalogCorrections({
			resources: [upstreamChampion],
			resourceKind: 'champion',
			canonicalSetKey: 'TFTSet13',
			patchLabel: '14.10',
			corrections: [first, second]
		});
		const firstProvenance = JSON.stringify(JSON.parse(layered.provenanceJson).previous);
		await database.insert(catalogChampions).values({
			id: 'champion-layered',
			catalogSnapshotId: 'snapshot-layered',
			externalId: layered.externalId,
			displayName: layered.displayName,
			iconPath: layered.iconPath,
			tier: layered.tier,
			metadataJson: layered.metadataJson,
			correctionId: layered.correctionId,
			isExcluded: layered.isExcluded,
			provenanceJson: layered.provenanceJson
		});

		await restoreCatalogResource(database, {
			tournamentId: 'tournament-layered',
			resourceKind: 'champion',
			resourceId: 'champion-layered'
		});
		expect(await database.select().from(catalogChampions)).toEqual([
			expect.objectContaining({
				correctionId: first.id,
				isExcluded: true,
				provenanceJson: firstProvenance
			})
		]);
		expect(await database.select().from(catalogCorrections)).toEqual([
			expect.objectContaining({ id: first.id, operation: 'exclude' })
		]);

		await restoreCatalogResource(database, {
			tournamentId: 'tournament-layered',
			resourceKind: 'champion',
			resourceId: 'champion-layered'
		});
		expect(await database.select().from(catalogChampions)).toEqual([
			expect.objectContaining({ correctionId: null, isExcluded: false })
		]);
		expect(await database.select().from(catalogCorrections)).toEqual([]);
	});
});
