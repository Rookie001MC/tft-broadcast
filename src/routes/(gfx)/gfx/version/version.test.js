import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getGraphicVersion: vi.fn() }));

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/winner-boards/repository.js', () => ({
	getGraphicVersion: mocks.getGraphicVersion
}));

import { GET } from './+server.js';

describe('/gfx/version', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getGraphicVersion.mockResolvedValue(7);
	});

	test('returns the current version, quoted ETag, and no-store', async () => {
		const response = await GET(
			/** @type {any} */ ({ request: new Request('https://broadcast.example/gfx/version') })
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ version: 7 });
		expect(response.headers.get('etag')).toBe('"gfx-7"');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	test('returns 304 without a body when If-None-Match matches', async () => {
		const response = await GET(
			/** @type {any} */ ({
				request: new Request('https://broadcast.example/gfx/version', {
					headers: { 'If-None-Match': '"gfx-7"' }
				})
			})
		);

		expect(response.status).toBe(304);
		expect(await response.text()).toBe('');
		expect(response.headers.get('etag')).toBe('"gfx-7"');
	});

	test('returns a fresh response after the version changes', async () => {
		mocks.getGraphicVersion.mockResolvedValue(8);
		const response = await GET(
			/** @type {any} */ ({
				request: new Request('https://broadcast.example/gfx/version', {
					headers: { 'If-None-Match': '"gfx-7"' }
				})
			})
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ version: 8 });
		expect(response.headers.get('etag')).toBe('"gfx-8"');
	});
});
