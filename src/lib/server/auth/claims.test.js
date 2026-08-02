import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { firstOperatorClaim } from '$lib/server/db/schema/setup.js';
import {
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

	test('never replaces an arbitrarily old pending claim', async () => {
		const claimedAt = new Date('2000-01-01T00:00:00.000Z');
		await client.execute({
			sql: `
				INSERT INTO first_operator_claim (id, token, status, claimed_at)
				VALUES (1, ?, 'pending', ?)
			`,
			args: ['original-claim', claimedAt.getTime()]
		});

		await expect(claimFirstOperator(database, 'replacement-claim')).resolves.toBe(false);
		const [row] = await database.select().from(firstOperatorClaim);
		expect(row).toEqual(
			expect.objectContaining({ token: 'original-claim', status: 'pending', claimedAt })
		);
	});

	test('rejects every late-resume claimant while the original token remains pending', async () => {
		await expect(claimFirstOperator(database, 'original-claim')).resolves.toBe(true);
		const resumedAges = [
			new Date('2026-08-02T11:58:00.000Z'),
			new Date('2026-07-02T12:00:00.000Z'),
			new Date('2020-01-01T00:00:00.000Z')
		];

		for (const [index, claimedAt] of resumedAges.entries()) {
			await client.execute({
				sql: 'UPDATE first_operator_claim SET claimed_at = ? WHERE id = 1',
				args: [claimedAt.getTime()]
			});
			await expect(claimFirstOperator(database, `late-claim-${index}`)).resolves.toBe(false);
		}

		const [row] = await database.select().from(firstOperatorClaim);
		expect(row.token).toBe('original-claim');
		expect(row.status).toBe('pending');
	});

	test('a completed claim permanently closes first-operator setup', async () => {
		const now = new Date('2026-08-02T12:00:00.000Z');
		await claimFirstOperator(database, 'claim-a');
		await completeFirstOperatorClaim(database, 'claim-a', now);
		await releaseFirstOperatorClaim(database, 'claim-a');

		await expect(claimFirstOperator(database, 'claim-b')).resolves.toBe(false);
		const [row] = await database.select().from(firstOperatorClaim);
		expect(row.status).toBe('complete');
	});

	test('releasing a pending claim allows another setup attempt', async () => {
		await claimFirstOperator(database, 'claim-a');
		await releaseFirstOperatorClaim(database, 'claim-a');

		await expect(claimFirstOperator(database, 'claim-b')).resolves.toBe(true);
	});
});
