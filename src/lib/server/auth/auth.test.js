import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	options: /** @type {any} */ ({}),
	hasAnyUser: vi.fn(),
	claimFirstOperator: vi.fn(),
	completeFirstOperatorClaim: vi.fn(),
	releaseFirstOperatorClaim: vi.fn(),
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
vi.mock('$lib/server/auth/claims.js', () => ({
	FIRST_OPERATOR_CLAIM_HEADER: 'x-first-operator-claim',
	claimFirstOperator: mocks.claimFirstOperator,
	completeFirstOperatorClaim: mocks.completeFirstOperatorClaim,
	releaseFirstOperatorClaim: mocks.releaseFirstOperatorClaim
}));

await import('../auth.js');

describe('Better Auth first-user hook', () => {
	beforeEach(() => vi.clearAllMocks());

	test('does not claim for unrelated auth endpoints', async () => {
		await mocks.options.hooks.before({ path: '/sign-in/email' });

		expect(mocks.claimFirstOperator).not.toHaveBeenCalled();
	});

	test('claims and propagates a token for direct email sign-up', async () => {
		mocks.claimFirstOperator.mockResolvedValue(true);
		const token = '0e690229-428a-4baa-b409-52f3c286f994';

		await expect(
			mocks.options.hooks.before({
				path: '/sign-up/email',
				headers: new Headers({ 'x-first-operator-claim': token })
			})
		).resolves.toEqual({ context: { firstOperatorClaimToken: token } });
		expect(mocks.claimFirstOperator).toHaveBeenCalledWith(mocks.database, token);
	});

	test('forbids direct email sign-up when the singleton claim is unavailable', async () => {
		mocks.claimFirstOperator.mockResolvedValue(false);

		await expect(
			mocks.options.hooks.before({ path: '/sign-up/email', headers: new Headers() })
		).rejects.toEqual(expect.objectContaining({ status: 'FORBIDDEN' }));
	});

	test('allows exactly one of two parallel direct sign-up hooks to proceed', async () => {
		let claimed = false;
		mocks.claimFirstOperator.mockImplementation(async () => {
			await Promise.resolve();
			if (claimed) return false;
			claimed = true;
			return true;
		});

		const results = await Promise.allSettled([
			mocks.options.hooks.before({ path: '/sign-up/email', headers: new Headers() }),
			mocks.options.hooks.before({ path: '/sign-up/email', headers: new Headers() })
		]);

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
	});

	test('marks the claim complete after sign-up creates a user', async () => {
		mocks.hasAnyUser.mockResolvedValue(true);

		await mocks.options.hooks.after({
			path: '/sign-up/email',
			firstOperatorClaimToken: 'claim-a'
		});

		expect(mocks.completeFirstOperatorClaim).toHaveBeenCalledWith(mocks.database, 'claim-a');
		expect(mocks.releaseFirstOperatorClaim).not.toHaveBeenCalled();
	});

	test('releases the claim after sign-up fails without creating a user', async () => {
		mocks.hasAnyUser.mockResolvedValue(false);

		await mocks.options.hooks.after({
			path: '/sign-up/email',
			firstOperatorClaimToken: 'claim-a'
		});

		expect(mocks.releaseFirstOperatorClaim).toHaveBeenCalledWith(mocks.database, 'claim-a');
		expect(mocks.completeFirstOperatorClaim).not.toHaveBeenCalled();
	});
});
