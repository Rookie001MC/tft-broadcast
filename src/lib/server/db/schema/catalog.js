import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const catalogSnapshots = sqliteTable('catalog_snapshots', {
	id: text('id').primaryKey(),
	source: text('source').notNull(),
	sourceUrl: text('source_url').notNull(),
	locale: text('locale').notNull(),
	patchLabel: text('patch_label').notNull(),
	setLabel: text('set_label'),
	syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
	isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(false),
	metadataJson: text('metadata_json').notNull()
});

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
		metadataJson: text('metadata_json').notNull()
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
		metadataJson: text('metadata_json').notNull()
	},
	(table) => [
		uniqueIndex('catalog_augments_snapshot_external_uq').on(
			table.catalogSnapshotId,
			table.externalId
		)
	]
);
