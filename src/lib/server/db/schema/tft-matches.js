import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const tftMatchSnapshots = sqliteTable(
	'tft_match_snapshots',
	{
		id: text('id').primaryKey(),
		tournamentId: text('tournament_id').notNull(),
		riotMatchId: text('riot_match_id').notNull(),
		region: text('region').notNull(),
		queueId: integer('queue_id').notNull(),
		contractVersion: integer('contract_version').notNull(),
		completedAt: integer('completed_at', { mode: 'timestamp_ms' }).notNull(),
		fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
		savedAt: integer('saved_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [
		index('tft_match_snapshots_match_idx').on(table.region, table.riotMatchId),
		index('tft_match_snapshots_tournament_idx').on(table.tournamentId, table.savedAt)
	]
);

export const tftMatchSnapshotParticipants = sqliteTable(
	'tft_match_snapshot_participants',
	{
		id: text('id').primaryKey(),
		snapshotId: text('snapshot_id')
			.notNull()
			.references(() => tftMatchSnapshots.id, { onDelete: 'cascade' }),
		puuid: text('puuid').notNull(),
		placement: integer('placement').notNull(),
		boardJson: text('board_json').notNull()
	},
	(table) => [
		uniqueIndex('tft_match_snapshot_participants_puuid_uq').on(table.snapshotId, table.puuid),
		uniqueIndex('tft_match_snapshot_participants_placement_uq').on(
			table.snapshotId,
			table.placement
		)
	]
);
