import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const catalogSnapshots = sqliteTable('catalog_snapshots', {
	id: text('id').primaryKey(),
	source: text('source').notNull(),
	sourceUrl: text('source_url').notNull(),
	locale: text('locale').notNull(),
	patchLabel: text('patch_label').notNull(),
	setLabel: text('set_label'),
	canonicalSetKey: text('canonical_set_key'),
	syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
	isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(false),
	metadataJson: text('metadata_json').notNull()
});

export const catalogCorrections = sqliteTable(
	'catalog_corrections',
	{
		id: text('id').primaryKey(),
		canonicalSetKey: text('canonical_set_key'),
		patchLabel: text('patch_label').notNull(),
		resourceKind: text('resource_kind', { enum: ['champion', 'augment'] }).notNull(),
		operation: text('operation', { enum: ['add', 'override', 'exclude'] }).notNull(),
		targetExternalId: text('target_external_id'),
		manualExternalId: text('manual_external_id'),
		displayNameOverride: text('display_name_override'),
		tierOverride: integer('tier_override'),
		imagePathOverride: text('image_path_override'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('catalog_corrections_scope_idx').on(
			table.canonicalSetKey,
			table.patchLabel,
			table.resourceKind
		)
	]
);

export const catalogChampions = sqliteTable(
	'catalog_champions',
	{
		id: text('id').primaryKey(),
		catalogSnapshotId: text('catalog_snapshot_id')
			.notNull()
			.references(() => catalogSnapshots.id, { onDelete: 'cascade' }),
		externalId: text('external_id').notNull(),
		displayName: text('display_name').notNull(),
		iconPath: text('icon_path'),
		tier: integer('tier'),
		metadataJson: text('metadata_json').notNull(),
		correctionId: text('correction_id').references(() => catalogCorrections.id, {
			onDelete: 'set null'
		}),
		isExcluded: integer('is_excluded', { mode: 'boolean' }).notNull().default(false),
		provenanceJson: text('provenance_json').notNull().default('{"source":"upstream"}')
	},
	(table) => [
		uniqueIndex('catalog_champions_snapshot_external_uq').on(
			table.catalogSnapshotId,
			table.externalId
		)
	]
);

export const catalogAugments = sqliteTable(
	'catalog_augments',
	{
		id: text('id').primaryKey(),
		catalogSnapshotId: text('catalog_snapshot_id')
			.notNull()
			.references(() => catalogSnapshots.id, { onDelete: 'cascade' }),
		externalId: text('external_id').notNull(),
		displayName: text('display_name').notNull(),
		iconPath: text('icon_path'),
		tier: integer('tier'),
		metadataJson: text('metadata_json').notNull(),
		correctionId: text('correction_id').references(() => catalogCorrections.id, {
			onDelete: 'set null'
		}),
		isExcluded: integer('is_excluded', { mode: 'boolean' }).notNull().default(false),
		provenanceJson: text('provenance_json').notNull().default('{"source":"upstream"}')
	},
	(table) => [
		uniqueIndex('catalog_augments_snapshot_external_uq').on(
			table.catalogSnapshotId,
			table.externalId
		)
	]
);
