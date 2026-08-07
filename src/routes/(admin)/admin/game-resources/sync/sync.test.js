import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ syncAndActivateCatalog: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: 'test-media' } }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/catalog/catalog-sync.js', () => ({
	syncAndActivateCatalog: mocks.syncAndActivateCatalog
}));

import { POST } from './+server.js';

/** @param {{ tournamentId?: string, user?: { id: string } | null }} [input] */
function requestEvent({ tournamentId = 'tournament-1', user = { id: 'operator-1' } } = {}) {
	const form = new FormData();
	form.set('tournamentId', tournamentId);
	form.set('patch', 'latest');
	form.set('locale', 'vi_vn');
	const request = new Request('https://broadcast.example/admin/game-resources/sync', {
		method: 'POST',
		body: form
	});
	return /** @type {any} */ ({
		locals: user ? { user } : {},
		request,
		url: new URL(request.url)
	});
}

describe('catalog progress stream', () => {
	beforeEach(() => vi.clearAllMocks());

	test('requires an authenticated operator', async () => {
		await expect(POST(requestEvent({ user: null }))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
		expect(mocks.syncAndActivateCatalog).not.toHaveBeenCalled();
	});

	test('streams ordered progress and completion events with no-buffer headers', async () => {
		mocks.syncAndActivateCatalog.mockImplementation(async ({ onProgress }) => {
			onProgress({
				type: 'progress',
				phase: 'downloading',
				message: 'Downloading',
				completed: 1,
				total: 2,
				percent: 50
			});
			return {
				activated: true,
				snapshotId: 'snapshot-1',
				source: 'communitydragon',
				warning: null
			};
		});
		const response = await POST(requestEvent());
		const events = (await response.text())
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(events.map((event) => event.type)).toEqual(['progress', 'complete']);
		expect(events[1]).toMatchObject({ snapshotId: 'snapshot-1', activated: true });
		expect(response.headers.get('content-type')).toContain('application/x-ndjson');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-accel-buffering')).toBe('no');
	});

	test('rejects a competing sync for the same tournament with HTTP 409', async () => {
		let finish = () => {};
		mocks.syncAndActivateCatalog.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = () =>
						resolve({
							activated: true,
							snapshotId: 'snapshot-1',
							source: 'communitydragon',
							warning: null
						});
				})
		);
		const first = await POST(requestEvent());
		await expect(POST(requestEvent())).rejects.toEqual(expect.objectContaining({ status: 409 }));
		finish();
		await first.text();
	});

	test('sanitizes unexpected server failures into an error event', async () => {
		mocks.syncAndActivateCatalog.mockRejectedValue(new Error('database path and secret details'));
		const response = await POST(requestEvent());
		const event = JSON.parse((await response.text()).trim());
		expect(event).toEqual({
			type: 'error',
			message: 'Catalog synchronization failed; the prior snapshot remains active.'
		});
	});

	test('aborts upstream work when the response consumer disconnects', async () => {
		let observedAbort = false;
		mocks.syncAndActivateCatalog.mockImplementation(
			({ signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener(
						'abort',
						() => {
							observedAbort = true;
							reject(signal.reason);
						},
						{ once: true }
					);
				})
		);
		const response = await POST(requestEvent({ tournamentId: 'disconnect-test' }));
		await response.body?.cancel();
		await vi.waitFor(() => expect(observedAbort).toBe(true));
	});
});
