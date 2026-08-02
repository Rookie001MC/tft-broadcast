import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('players', {
	id: text('id').primaryKey(),
	riotId: text('riot_id'),
	riotIdKey: text('riot_id_key').unique(),
	riotGameName: text('riot_game_name'),
	riotTagline: text('riot_tagline'),
	fullName: text('full_name').notNull(),
	displayName: text('display_name').notNull(),
	imagePath: text('image_path'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
