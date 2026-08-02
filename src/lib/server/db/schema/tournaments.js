import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { catalogSnapshots } from './catalog.js';
import { players } from './players.js';

export const tournaments = sqliteTable('tournaments', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	activeCatalogSnapshotId: text('active_catalog_snapshot_id').references(
		() => catalogSnapshots.id,
		{
			onDelete: 'set null'
		}
	),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const tournamentPlayers = sqliteTable(
	'tournament_players',
	{
		tournamentId: text('tournament_id')
			.notNull()
			.references(() => tournaments.id, { onDelete: 'cascade' }),
		playerId: text('player_id')
			.notNull()
			.references(() => players.id, { onDelete: 'cascade' }),
		displayOrder: integer('display_order').notNull(),
		notes: text('notes')
	},
	(table) => [primaryKey({ columns: [table.tournamentId, table.playerId] })]
);
