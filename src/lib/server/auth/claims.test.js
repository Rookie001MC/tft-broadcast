import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { firstOperatorClaim } from '$lib/server/db/schema/setup.js';
import {
	FIRST_OPERATOR_CLAIM_STALE_MS,
	claimFirstOperator,
	completeFirstOperatorClaim,
	releaseFirstOperatorClaim
} from './claims.js';

describe('first-operator claim', () => {
	/** @type {import('@libsql/client').Client} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeAll(async () => {
		client = createClient({ url: 'file::memory:?cache=shared' });
		database = drizzle(client);
		await client.batch([
			`CREATE TABLE user (
				id TEXT PRIMARY KEY NOT NULL,
				name TEXT NOT NULL,
				email TEXT NOT NULL UNIQUE,
				email_verified INTEGER DEFAULT 0 NOT NULL,
				image TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)`,
			`CREATE TABLE first_operator_claim (
				id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
				token TEXT NOT NULL UNIQUE,
				status TEXT NOT NULL CHECK (status IN ('pending', 'complete')),
				claimed_at INTEGER NOT NULL,
				completed_at INTEGER
			)`
		]);
	});

	beforeEach(async () => {
		await client.batch(['DELETE FROM first_operator_claim', 'DELETE FROM user']);
	});

	afterAll(() => client.close());

	test('allows exactly one of two parallel claims to proceed', async () => {
		const results = await Promise.all([
			claimFirstOperator(database, 'claim-a'),
			claimFirstOperator(database, 'claim-b')
		]);

		expect(results.filter(Boolean)).toHaveLength(1);
		const rows = await database.select().from(firstOperatorClaim);
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('pending');
	});

	test('retries an extended SQLite lock code within the bounded attempt count', async () => {
		const lockedDatabase = {
			transaction: vi
				.fn()
				.mockRejectedValueOnce({ code: 'SQLITE_LOCKED_SHAREDCACHE' })
				.mockResolvedValueOnce(false)
		};

		await expect(claimFirstOperator(lockedDatabase, 'claim-a')).resolves.toBe(false);
		expect(lockedDatabase.transaction).toHaveBeenCalledTimes(2);
	});

	test('does not claim after a user already exists', async () => {
		const now = Date.now();
		await client.execute({
			sql: `
				INSERT INTO user (id, name, email, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?)
			`,
			args: ['operator-1', 'Operator', 'operator@example.com', now, now]
		});

		await expect(claimFirstOperator(database, 'claim-a')).resolves.toBe(false);
	});

	test('recovers one stale pending claim after the bounded timeout', async () => {
		const now = new Date('2026-08-02T12:00:00.000Z');
		await client.execute({
			sql: `
				INSERT INTO first_operator_claim (id, token, status, claimed_at)
				VALUES (1, ?, 'pending', ?)
			`,
			args: ['stale-claim', now.getTime() - FIRST_OPERATOR_CLAIM_STALE_MS - 1]
		});

		await expect(claimFirstOperator(database, 'replacement-claim', now)).resolves.toBe(true);
		const [row] = await database.select().from(firstOperatorClaim);
		expect(row).toEqual(
			expect.objectContaining({ token: 'replacement-claim', status: 'pending', claimedAt: now })
		);
	});

	test('does not recover a pending claim before the timeout', async () => {
		const now = new Date('2026-08-02T12:00:00.000Z');
		await expect(claimFirstOperator(database, 'claim-a', now)).resolves.toBe(true);

		await expect(
			claimFirstOperator(
				database,
				'claim-b',
				new Date(now.getTime() + FIRST_OPERATOR_CLAIM_STALE_MS - 1)
			)
		).resolves.toBe(false);
	});

	test('a completed claim permanently closes first-operator setup', async () => {
		const now = new Date('2026-08-02T12:00:00.000Z');
		await claimFirstOperator(database, 'claim-a', now);
		await completeFirstOperatorClaim(database, 'claim-a', now);
		await releaseFirstOperatorClaim(database, 'claim-a');

		await expect(
			claimFirstOperator(
				database,
				'claim-b',
				new Date(now.getTime() + FIRST_OPERATOR_CLAIM_STALE_MS * 2)
			)
		).resolves.toBe(false);
		const [row] = await database.select().from(firstOperatorClaim);
		expect(row.status).toBe('complete');
	});

	test('releasing a pending claim allows another setup attempt', async () => {
		await claimFirstOperator(database, 'claim-a');
		await releaseFirstOperatorClaim(database, 'claim-a');

		await expect(claimFirstOperator(database, 'claim-b')).resolves.toBe(true);
	});
});
