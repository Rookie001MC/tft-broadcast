import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	options: /** @type {any} */ ({}),
	hasAnyUser: vi.fn(),
	database: {}
}));

vi.mock('better-auth/minimal', () => ({
	betterAuth: vi.fn((options) => {
		mocks.options = options;
		return { options };
	})
}));
vi.mock('better-auth/api', () => ({
	APIError: class APIError extends Error {
		/** @param {string} status */
		constructor(status) {
			super(status);
			this.status = status;
		}
	},
	createAuthMiddleware: vi.fn((handler) => handler)
}));
vi.mock('better-auth/adapters/drizzle', () => ({
	drizzleAdapter: vi.fn(() => 'database-adapter')
}));
vi.mock('better-auth/svelte-kit', () => ({
	sveltekitCookies: vi.fn(() => ({ id: 'sveltekit-cookies' }))
}));
vi.mock('$app/server', () => ({ getRequestEvent: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({
	env: { ORIGIN: 'https://broadcast.example', BETTER_AUTH_SECRET: 'test-secret' }
}));
vi.mock('$lib/server/db', () => ({ db: mocks.database }));
vi.mock('$lib/server/auth/guards.js', () => ({ hasAnyUser: mocks.hasAnyUser }));

await import('../auth.js');

describe('Better Auth first-user hook', () => {
	beforeEach(() => vi.clearAllMocks());

	test('does not query the user table for unrelated auth endpoints', async () => {
		await mocks.options.hooks.before({ path: '/sign-in/email' });

		expect(mocks.hasAnyUser).not.toHaveBeenCalled();
	});

	test('allows direct email sign-up while the user table is empty', async () => {
		mocks.hasAnyUser.mockResolvedValue(false);

		await expect(mocks.options.hooks.before({ path: '/sign-up/email' })).resolves.toBeUndefined();
		expect(mocks.hasAnyUser).toHaveBeenCalledWith(mocks.database);
	});

	test('forbids direct email sign-up after the first user exists', async () => {
		mocks.hasAnyUser.mockResolvedValue(true);

		await expect(mocks.options.hooks.before({ path: '/sign-up/email' })).rejects.toEqual(
			expect.objectContaining({ status: 'FORBIDDEN' })
		);
	});
});
