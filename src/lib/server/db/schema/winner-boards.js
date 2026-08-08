import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { catalogAugments, catalogChampions } from './catalog.js';
import { players } from './players.js';
import { tournaments } from './tournaments.js';

export const winnerBoardState = sqliteTable('winner_board_state', {
	id: text('id').primaryKey(),
	tournamentId: text('tournament_id')
		.notNull()
		.references(() => tournaments.id),
	winnerPlayerId: text('winner_player_id')
		.notNull()
		.references(() => players.id),
	title: text('title').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const winnerBoardStateChampions = sqliteTable('winner_board_state_champions', {
	id: text('id').primaryKey(),
	winnerBoardStateId: text('winner_board_state_id')
		.notNull()
		.references(() => winnerBoardState.id, { onDelete: 'cascade' }),
	catalogChampionId: text('catalog_champion_id')
		.notNull()
		.references(() => catalogChampions.id, { onDelete: 'restrict' }),
	starLevel: integer('star_level'),
	displayOrder: integer('display_order').notNull()
});

export const winnerBoardStateAugments = sqliteTable('winner_board_state_augments', {
	id: text('id').primaryKey(),
	winnerBoardStateId: text('winner_board_state_id')
		.notNull()
		.references(() => winnerBoardState.id, { onDelete: 'cascade' }),
	catalogAugmentId: text('catalog_augment_id')
		.notNull()
		.references(() => catalogAugments.id, { onDelete: 'restrict' }),
	displayOrder: integer('display_order').notNull()
});

export const winnerBoardPublications = sqliteTable('winner_board_publications', {
	id: text('id').primaryKey(),
	sourceStateUpdatedAt: integer('source_state_updated_at', { mode: 'timestamp_ms' }).notNull(),
	graphicVersion: integer('graphic_version').notNull().unique(),
	renderPayloadJson: text('render_payload_json').notNull(),
	mediaDirectory: text('media_directory').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const graphicState = sqliteTable('graphic_state', {
	id: text('id').primaryKey(),
	publishedPublicationId: text('published_publication_id').references(
		() => winnerBoardPublications.id,
		{
			onDelete: 'set null'
		}
	),
	version: integer('version').notNull().default(0),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
