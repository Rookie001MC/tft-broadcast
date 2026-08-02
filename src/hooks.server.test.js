import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	svelteKitHandler: vi.fn()
}));

vi.mock('$app/environment', () => ({ building: false }));
vi.mock('$lib/server/auth', () => ({
	auth: { api: { getSession: mocks.getSession } }
}));
vi.mock('better-auth/svelte-kit', () => ({
	svelteKitHandler: mocks.svelteKitHandler
}));

import { handle } from './hooks.server.js';

/** @param {string} pathname */
function requestEvent(pathname) {
	const url = new URL(`https://broadcast.example${pathname}`);
	return /** @type {any} */ ({
		request: new Request(url, { method: 'POST' }),
		url,
		locals: {}
	});
}

describe('admin request hook guard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSession.mockResolvedValue(null);
		mocks.svelteKitHandler.mockResolvedValue(new Response('resolved'));
	});

	test('redirects an anonymous admin POST before route action resolution', async () => {
		const event = requestEvent('/admin/winner-boards?/publish');
		const resolve = vi.fn();

		await expect(handle({ event, resolve })).rejects.toEqual(
			expect.objectContaining({
				status: 303,
				location: '/login?next=%2Fadmin%2Fwinner-boards%3F%2Fpublish'
			})
		);
		expect(mocks.svelteKitHandler).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	test.each(['/administrator', '/admin-old'])(
		'does not guard the sibling path %s',
		async (path) => {
			const event = requestEvent(path);
			const resolve = vi.fn();

			await expect(handle({ event, resolve })).resolves.toBeInstanceOf(Response);
			expect(mocks.svelteKitHandler).toHaveBeenCalledOnce();
		}
	);
});
