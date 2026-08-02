import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { catalogAugments, catalogChampions } from './catalog.js';
import { players } from './players.js';
import { tournaments } from './tournaments.js';

export const winnerBoards = sqliteTable('winner_boards', {
	id: text('id').primaryKey(),
	tournamentId: text('tournament_id')
		.notNull()
		.references(() => tournaments.id),
	winnerPlayerId: text('winner_player_id')
		.notNull()
		.references(() => players.id),
	title: text('title').notNull(),
	status: text('status', { enum: ['draft', 'published', 'hidden'] })
		.notNull()
		.default('draft'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	publishedAt: integer('published_at', { mode: 'timestamp_ms' })
});

export const winnerBoardChampions = sqliteTable('winner_board_champions', {
	id: text('id').primaryKey(),
	winnerBoardId: text('winner_board_id')
		.notNull()
		.references(() => winnerBoards.id, { onDelete: 'cascade' }),
	catalogChampionId: text('catalog_champion_id')
		.notNull()
		.references(() => catalogChampions.id, { onDelete: 'restrict' }),
	starLevel: integer('star_level'),
	displayOrder: integer('display_order').notNull()
});

export const winnerBoardAugments = sqliteTable('winner_board_augments', {
	id: text('id').primaryKey(),
	winnerBoardId: text('winner_board_id')
		.notNull()
		.references(() => winnerBoards.id, { onDelete: 'cascade' }),
	catalogAugmentId: text('catalog_augment_id')
		.notNull()
		.references(() => catalogAugments.id, { onDelete: 'restrict' }),
	displayOrder: integer('display_order').notNull()
});

export const graphicState = sqliteTable('graphic_state', {
	id: text('id').primaryKey(),
	publishedWinnerBoardId: text('published_winner_board_id').references(() => winnerBoards.id, {
		onDelete: 'set null'
	}),
	version: integer('version').notNull().default(0),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
