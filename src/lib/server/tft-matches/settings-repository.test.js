import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { tftMatchSettings } from '../db/schema/tft-match-settings.js';
import { getTftMatchSettings, saveTftMatchRegion } from './settings-repository.js';

describe('TFT match settings repository', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		await client.execute(`CREATE TABLE tft_match_settings (
			id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
			region TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`);
		database = drizzle(client);
	});

	afterEach(() => client.close());

	test('returns an unconfigured setting when the singleton row is absent', async () => {
		await expect(getTftMatchSettings(database)).resolves.toEqual({ region: null });
	});

	test('upserts singleton ID 1 and records the injected timestamp', async () => {
		const first = new Date('2026-08-16T04:00:00.000Z');
		const second = new Date('2026-08-16T05:00:00.000Z');

		await expect(saveTftMatchRegion(database, 'VN2', { updatedAt: first })).resolves.toEqual({
			region: 'VN2'
		});
		await expect(saveTftMatchRegion(database, 'EUN1', { updatedAt: second })).resolves.toEqual({
			region: 'EUN1'
		});

		expect(await database.select().from(tftMatchSettings)).toEqual([
			{ id: 1, region: 'EUN1', updatedAt: second }
		]);
	});

	test('validates before writing', async () => {
		await expect(saveTftMatchRegion(database, 'vn2')).rejects.toThrow();
		expect(await database.select().from(tftMatchSettings)).toEqual([]);
	});
});
