import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const tftMatchSettings = sqliteTable(
	'tft_match_settings',
	{
		id: integer('id').primaryKey(),
		region: text('region').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [check('tft_match_settings_singleton_ck', sql`${table.id} = 1`)]
);
