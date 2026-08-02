import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const playerImportPreviews = sqliteTable('player_import_previews', {
	token: text('token').primaryKey(),
	stagedPath: text('staged_path').notNull(),
	sha256: text('sha256').notNull(),
	previewJson: text('preview_json').notNull(),
	status: text('status', { enum: ['previewed', 'committed'] })
		.notNull()
		.default('previewed'),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});
