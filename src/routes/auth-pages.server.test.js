import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	hasAnyUser: vi.fn(),
	signUpEmail: vi.fn(),
	signInEmail: vi.fn()
}));

vi.mock('$lib/server/auth/guards.js', () => ({ hasAnyUser: mocks.hasAnyUser }));
vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			signUpEmail: mocks.signUpEmail,
			signInEmail: mocks.signInEmail
		}
	}
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

import { actions as loginActions, load as loadLogin } from './login/+page.server.js';
import { actions as setupActions, load as loadSetup } from './setup/+page.server.js';

/**
 * @param {string} url
 * @param {Record<string, string>} fields
 */
function formRequest(url, fields) {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	return new Request(url, { method: 'POST', body: form });
}

/** @param {Record<string, any>} event */
function asRequestEvent(event) {
	return /** @type {any} */ (event);
}

describe('first-user setup', () => {
	beforeEach(() => vi.clearAllMocks());

	test('redirects setup loads to login after the first user exists', async () => {
		mocks.hasAnyUser.mockResolvedValue(true);

		await expect(loadSetup(asRequestEvent({}))).rejects.toEqual(
			expect.objectContaining({ status: 303, location: '/login' })
		);
	});

	test('rejects blank names and emails without calling Better Auth', async () => {
		mocks.hasAnyUser.mockResolvedValue(false);
		const request = formRequest('https://broadcast.example/setup', {
			name: '   ',
			email: '   ',
			password: 'long-enough-password'
		});

		const result = await setupActions.default(asRequestEvent({ request }));

		expect(result).toEqual(expect.objectContaining({ status: 400 }));
		expect(mocks.signUpEmail).not.toHaveBeenCalled();
	});

	test('rejects passwords shorter than 12 characters', async () => {
		mocks.hasAnyUser.mockResolvedValue(false);
		const request = formRequest('https://broadcast.example/setup', {
			name: 'Tournament Operator',
			email: 'operator@example.com',
			password: 'too-short'
		});

		const result = await setupActions.default(asRequestEvent({ request }));

		expect(result).toEqual(expect.objectContaining({ status: 400 }));
		expect(mocks.signUpEmail).not.toHaveBeenCalled();
	});

	test('rechecks setup and redirects without signing up when a user now exists', async () => {
		mocks.hasAnyUser.mockResolvedValue(true);
		const request = formRequest('https://broadcast.example/setup', {
			name: 'Tournament Operator',
			email: 'operator@example.com',
			password: 'long-enough-password'
		});

		await expect(setupActions.default(asRequestEvent({ request }))).rejects.toEqual(
			expect.objectContaining({ status: 303, location: '/login' })
		);
		expect(mocks.signUpEmail).not.toHaveBeenCalled();
	});

	test('trims setup identity fields and redirects the new operator to admin', async () => {
		mocks.hasAnyUser.mockResolvedValue(false);
		const request = formRequest('https://broadcast.example/setup', {
			name: '  Tournament Operator  ',
			email: '  operator@example.com  ',
			password: 'long-enough-password'
		});

		await expect(setupActions.default(asRequestEvent({ request }))).rejects.toEqual(
			expect.objectContaining({ status: 303, location: '/admin' })
		);
		expect(mocks.signUpEmail).toHaveBeenCalledWith({
			headers: request.headers,
			body: {
				name: 'Tournament Operator',
				email: 'operator@example.com',
				password: 'long-enough-password'
			}
		});
	});

	test('returns a generic setup failure when Better Auth rejects registration', async () => {
		mocks.hasAnyUser.mockResolvedValue(false);
		mocks.signUpEmail.mockRejectedValue(new Error('database secret'));
		const request = formRequest('https://broadcast.example/setup', {
			name: 'Tournament Operator',
			email: 'operator@example.com',
			password: 'long-enough-password'
		});

		const result = await setupActions.default(asRequestEvent({ request }));

		expect(result).toEqual({
			status: 400,
			data: { message: 'Unable to create the operator account.' }
		});
	});
});

describe('operator login', () => {
	beforeEach(() => vi.clearAllMocks());

	test('redirects an authenticated user to admin', () => {
		expect(() =>
			loadLogin(asRequestEvent({ locals: { user: { id: 'operator-1' } } }))
		).toThrowError(expect.objectContaining({ status: 303, location: '/admin' }));
	});

	test('uses an admin next path after successful login', async () => {
		const request = formRequest('https://broadcast.example/login', {
			email: 'operator@example.com',
			password: 'long-enough-password'
		});
		const url = new URL('https://broadcast.example/login?next=%2Fadmin%2Fgraphics%3Fround%3Dfinal');

		await expect(loginActions.default(asRequestEvent({ request, url }))).rejects.toEqual(
			expect.objectContaining({
				status: 303,
				location: '/admin/graphics?round=final'
			})
		);
		expect(mocks.signInEmail).toHaveBeenCalledWith({
			headers: request.headers,
			body: { email: 'operator@example.com', password: 'long-enough-password' }
		});
	});

	test('falls back to admin when next is an external URL', async () => {
		const request = formRequest('https://broadcast.example/login', {
			email: 'operator@example.com',
			password: 'long-enough-password'
		});
		const url = new URL('https://broadcast.example/login?next=https%3A%2F%2Fevil.example');

		await expect(loginActions.default(asRequestEvent({ request, url }))).rejects.toEqual(
			expect.objectContaining({ status: 303, location: '/admin' })
		);
	});

	test('returns a generic login failure when credentials are rejected', async () => {
		mocks.signInEmail.mockRejectedValue(new Error('credential details'));
		const request = formRequest('https://broadcast.example/login', {
			email: 'operator@example.com',
			password: 'incorrect-password'
		});
		const url = new URL('https://broadcast.example/login');

		const result = await loginActions.default(asRequestEvent({ request, url }));

		expect(result).toEqual({
			status: 400,
			data: { message: 'Email or password is incorrect.' }
		});
	});
});
