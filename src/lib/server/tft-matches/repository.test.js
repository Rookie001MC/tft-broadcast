import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertTftMatchSnapshot } from './repository.js';

function canonicalSnapshot() {
	return {
		contractVersion: 1,
		matchId: 'VN2_snapshot-test',
		region: 'VN2',
		queueId: 1100,
		completedAt: '2026-08-14T01:00:00.000Z',
		fetchedAt: '2026-08-14T01:05:00.000Z',
		participants: Array.from({ length: 8 }, (_, index) => ({
			puuid: `puuid-${index + 1}`,
			placement: index + 1,
			champions:
				index === 0
					? [
							{
								catalogChampionId: 'champion-2',
								externalId: 'TFT15_Champion2',
								displayName: 'Champion 2',
								iconPath: null,
								starLevel: 2,
								displayOrder: 0
							},
							{
								catalogChampionId: 'champion-2',
								externalId: 'TFT15_Champion2',
								displayName: 'Champion 2',
								iconPath: null,
								starLevel: 1,
								displayOrder: 1
							}
						]
					: [],
			omittedUnitCount: index
		}))
	};
}

describe('TFT match snapshot repository', () => {
	/** @type {ReturnType<typeof createClient>} */
	let client;
	/** @type {ReturnType<typeof drizzle>} */
	let database;

	beforeEach(async () => {
		client = createClient({ url: ':memory:' });
		await client.execute('PRAGMA foreign_keys = ON');
		await client.execute(`CREATE TABLE tft_match_snapshots (
			id TEXT PRIMARY KEY NOT NULL,
			tournament_id TEXT NOT NULL,
			riot_match_id TEXT NOT NULL,
			region TEXT NOT NULL,
			queue_id INTEGER NOT NULL,
			contract_version INTEGER NOT NULL,
			completed_at INTEGER NOT NULL,
			fetched_at INTEGER NOT NULL,
			saved_at INTEGER NOT NULL
		)`);
		await client.execute(`CREATE TABLE tft_match_snapshot_participants (
			id TEXT PRIMARY KEY NOT NULL,
			snapshot_id TEXT NOT NULL REFERENCES tft_match_snapshots(id) ON DELETE CASCADE,
			puuid TEXT NOT NULL,
			placement INTEGER NOT NULL,
			board_json TEXT NOT NULL,
			UNIQUE (snapshot_id, puuid),
			UNIQUE (snapshot_id, placement)
		)`);
		database = drizzle(client);
	});

	afterEach(() => client.close());

	it('inserts one canonical snapshot with exactly eight ordered participant boards', async () => {
		const source = canonicalSnapshot();
		const id = await insertTftMatchSnapshot(
			database,
			{ tournamentId: 'tournament-one', snapshot: source },
			{
				id: 'snapshot-one',
				savedAt: new Date('2026-08-14T01:10:00.000Z')
			}
		);

		expect(id).toBe('snapshot-one');
		expect((await client.execute('SELECT * FROM tft_match_snapshots')).rows).toEqual([
			expect.objectContaining({
				id: 'snapshot-one',
				tournament_id: 'tournament-one',
				riot_match_id: source.matchId,
				completed_at: Date.parse(source.completedAt),
				fetched_at: Date.parse(source.fetchedAt),
				saved_at: Date.parse('2026-08-14T01:10:00.000Z')
			})
		]);
		const rows = (
			await client.execute(
				'SELECT puuid, placement, board_json FROM tft_match_snapshot_participants ORDER BY placement'
			)
		).rows;
		expect(rows).toHaveLength(8);
		expect(
			rows.map((row) => ({
				puuid: row.puuid,
				placement: row.placement,
				...JSON.parse(/** @type {string} */ (row.board_json))
			}))
		).toEqual(source.participants);
		expect(JSON.parse(/** @type {string} */ (rows[0].board_json)).champions).toEqual(
			source.participants[0].champions
		);
	});

	it('revalidates the canonical contract before inserting any rows', async () => {
		const source = canonicalSnapshot();
		source.participants.pop();

		await expect(
			insertTftMatchSnapshot(database, {
				tournamentId: 'tournament-one',
				snapshot: source
			})
		).rejects.toThrow('TFT match snapshot is invalid.');
		expect((await client.execute('SELECT * FROM tft_match_snapshots')).rows).toEqual([]);
		expect((await client.execute('SELECT * FROM tft_match_snapshot_participants')).rows).toEqual(
			[]
		);
	});
});
