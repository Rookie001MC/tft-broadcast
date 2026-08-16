import { afterEach, describe, expect, test } from 'vitest';

import {
	clearTftMatchPreviewCacheForTests,
	deleteTftMatchPreviewBatch,
	getTftMatchPreviewBatch,
	storeTftMatchPreviewBatch
} from './preview-cache.js';

const start = new Date('2026-08-16T00:00:00.000Z');

/** @param {string} matchId */
function batch(matchId) {
	return { snapshots: { [matchId]: { source: { matchId } } } };
}

describe('TFT match preview cache', () => {
	afterEach(() => clearTftMatchPreviewCacheForTests());

	test('creates distinct opaque 32-byte base64url tokens', () => {
		const first = storeTftMatchPreviewBatch(batch('one'), { now: start });
		const second = storeTftMatchPreviewBatch(batch('two'), { now: start });

		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(second).not.toBe(first);
	});

	test('clones values on ingress and egress', () => {
		const original = batch('one');
		const token = storeTftMatchPreviewBatch(original, { now: start, tokenFactory: () => 'token' });
		original.snapshots.one.source.matchId = 'mutated-before-read';

		const firstRead = getTftMatchPreviewBatch(token, { now: start });
		firstRead.snapshots.one.source.matchId = 'mutated-after-read';

		expect(getTftMatchPreviewBatch(token, { now: start })).toEqual(batch('one'));
	});

	test('expires exactly at fifteen minutes and cleans up lazily', () => {
		const token = storeTftMatchPreviewBatch(batch('one'), {
			now: start,
			tokenFactory: () => 'old'
		});

		expect(
			getTftMatchPreviewBatch(token, { now: new Date(start.getTime() + 15 * 60 * 1000 - 1) })
		).toEqual(batch('one'));
		expect(
			getTftMatchPreviewBatch(token, { now: new Date(start.getTime() + 15 * 60 * 1000) })
		).toBeNull();

		storeTftMatchPreviewBatch(batch('new'), {
			now: new Date(start.getTime() + 15 * 60 * 1000),
			tokenFactory: () => 'new'
		});
		expect(getTftMatchPreviewBatch('old', { now: new Date(start.getTime() + 1) })).toBeNull();
	});

	test('evicts the oldest insertion when a 33rd live batch is stored', () => {
		for (let index = 1; index <= 33; index += 1) {
			storeTftMatchPreviewBatch(batch(String(index)), {
				now: new Date(start.getTime() + index),
				tokenFactory: () => `token-${index}`
			});
		}

		expect(getTftMatchPreviewBatch('token-1', { now: start })).toBeNull();
		for (let index = 2; index <= 33; index += 1) {
			expect(getTftMatchPreviewBatch(`token-${index}`, { now: start })).not.toBeNull();
		}
	});

	test('retains failed saves and deletes the full batch only after explicit success', () => {
		const token = storeTftMatchPreviewBatch(batch('one'), {
			now: start,
			tokenFactory: () => 'save-token'
		});

		// A failed save does not call delete.
		expect(getTftMatchPreviewBatch(token, { now: start })).toEqual(batch('one'));
		expect(deleteTftMatchPreviewBatch(token)).toBe(true);
		expect(getTftMatchPreviewBatch(token, { now: start })).toBeNull();
		expect(deleteTftMatchPreviewBatch(token)).toBe(false);
	});
});
