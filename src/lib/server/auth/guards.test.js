import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { hasAnyUser, requireAdmin } from './guards.js';

describe('authentication guards', () => {
	/** @type {import('@libsql/client').Client} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		database = drizzle(client);
		await client.execute(`
			CREATE TABLE user (
				id TEXT PRIMARY KEY NOT NULL,
				name TEXT NOT NULL,
				email TEXT NOT NULL UNIQUE,
				email_verified INTEGER DEFAULT 0 NOT NULL,
				image TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`);
	});

	afterEach(() => client.close());

	test('hasAnyUser returns false when the user table is empty', async () => {
		await expect(hasAnyUser(database)).resolves.toBe(false);
	});

	test('hasAnyUser returns true after a user is inserted', async () => {
		await client.execute({
			sql: `
				INSERT INTO user (id, name, email, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?)
			`,
			args: ['operator-1', 'Tournament Operator', 'operator@example.com', Date.now(), Date.now()]
		});

		await expect(hasAnyUser(database)).resolves.toBe(true);
	});

	test('requireAdmin redirects anonymous requests to login with the requested admin URL', () => {
		const event = {
			locals: {},
			url: new URL('https://broadcast.example/admin/graphics?round=final')
		};

		expect(() => requireAdmin(event)).toThrowError(
			expect.objectContaining({
				status: 303,
				location: '/login?next=%2Fadmin%2Fgraphics%3Fround%3Dfinal'
			})
		);
	});

	test('requireAdmin returns normally for authenticated requests', () => {
		const event = {
			locals: { user: { id: 'operator-1' } },
			url: new URL('https://broadcast.example/admin')
		};

		expect(requireAdmin(/** @type {any} */ (event))).toBeUndefined();
	});
});
