import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const firstOperatorClaim = sqliteTable(
	'first_operator_claim',
	{
		id: integer('id').primaryKey(),
		token: text('token').notNull().unique(),
		status: text('status', { enum: ['pending', 'complete'] }).notNull(),
		claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }).notNull(),
		completedAt: integer('completed_at', { mode: 'timestamp_ms' })
	},
	(table) => [
		check('first_operator_claim_singleton_ck', sql`${table.id} = 1`),
		check('first_operator_claim_status_ck', sql`${table.status} IN ('pending', 'complete')`)
	]
);
