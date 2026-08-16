import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tftMatchSnapshots = sqliteTable(
	'tft_match_snapshots',
	{
		id: text('id').primaryKey(),
		riotMatchId: text('riot_match_id').notNull(),
		region: text('region').notNull(),
		tournamentId: text('tournament_id').notNull(),
		selectedPlayerId: text('selected_player_id').notNull(),
		activeCatalogSnapshotId: text('active_catalog_snapshot_id').notNull(),
		contractVersion: integer('contract_version').notNull(),
		payloadJson: text('payload_json').notNull(),
		fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
		savedAt: integer('saved_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('tft_match_snapshots_match_idx').on(table.region, table.riotMatchId),
		index('tft_match_snapshots_tournament_idx').on(table.tournamentId, table.savedAt)
	]
);
