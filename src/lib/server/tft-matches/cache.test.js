import { describe, expect, test } from 'vitest';
import {
	clearTftMatchPreviewCacheForTests,
	deleteTftMatchPreviewBatch,
	getTftMatchPreviewBatch,
	storeTftMatchPreviewBatch
} from './cache.js';

describe('TFT match preview cache', () => {
	test('stores opaque copies for exactly fifteen minutes and removes expired batches lazily', () => {
		clearTftMatchPreviewCacheForTests();
		const startedAt = new Date('2026-08-14T00:00:00.000Z');
		const token = storeTftMatchPreviewBatch(
			{ tournamentId: 'tournament-1', snapshots: { VN2_1: { matchId: 'VN2_1' } } },
			{ now: startedAt, tokenFactory: () => 'opaque-token' }
		);

		const beforeExpiry = getTftMatchPreviewBatch(token, {
			now: new Date(startedAt.getTime() + 15 * 60_000 - 1)
		});
		beforeExpiry.snapshots.VN2_1.matchId = 'changed-outside-cache';
		expect(getTftMatchPreviewBatch(token, { now: startedAt }).snapshots.VN2_1.matchId).toBe(
			'VN2_1'
		);
		expect(
			getTftMatchPreviewBatch(token, { now: new Date(startedAt.getTime() + 15 * 60_000) })
		).toBeNull();
	});

	test('retains a batch after a failed save and removes it only when explicitly deleted', () => {
		clearTftMatchPreviewCacheForTests();
		const token = storeTftMatchPreviewBatch(
			{ tournamentId: 'tournament-1', snapshots: {} },
			{ tokenFactory: () => 'save-token' }
		);
		expect(getTftMatchPreviewBatch(token)).not.toBeNull();
		expect(deleteTftMatchPreviewBatch(token)).toBe(true);
		expect(getTftMatchPreviewBatch(token)).toBeNull();
	});
});
