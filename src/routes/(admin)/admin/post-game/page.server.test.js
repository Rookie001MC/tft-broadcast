import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ options: vi.fn(), changeState: vi.fn() }));
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({ innerJoin: () => ({ where: () => ({ orderBy: mocks.options }) }) })
		})
	}
}));
vi.mock('$lib/server/post-game/store.js', () => ({
	changeState: mocks.changeState,
	getState: vi.fn(),
	sceneState: vi.fn()
}));

import { actions } from './+page.server.js';

/** @param {Record<string, string>} values @param {boolean} authenticated */
function event(values, authenticated = true) {
	return /** @type {import('./$types').RequestEvent} */ (
		/** @type {unknown} */ ({
			locals: authenticated ? { user: { id: 'operator' } } : {},
			url: new URL('http://localhost/admin/post-game'),
			request: new Request('http://localhost/admin/post-game?/augments', {
				method: 'POST',
				body: new URLSearchParams(values)
			})
		})
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.options.mockResolvedValue([
		{ id: 'augment-1', name: 'First augment', icon: '/media/catalog-assets/test/1.png' }
	]);
});

test('augment action requires an authenticated operator before reading the catalog', async () => {
	await expect(actions.augments(event({}, false))).rejects.toMatchObject({ status: 303 });
	expect(mocks.options).not.toHaveBeenCalled();
	expect(mocks.changeState).not.toHaveBeenCalled();
});

test('augment action saves catalog values and empty slots to the requested draft game', async () => {
	await actions.augments(event({ gameId: '42', augmentCount: '3', augment0: 'augment-1' }));
	expect(mocks.changeState).toHaveBeenCalledWith('augments', {
		gameId: 42,
		augments: [
			{ id: 'augment-1', name: 'First augment', icon: '/media/catalog-assets/test/1.png' },
			null,
			null
		]
	});
});

test.each([
	{ augmentCount: '5', augment0: 'augment-1' },
	{ augmentCount: '3', augment0: 'unknown' }
])('rejects invalid augment submissions: %j', async (values) => {
	await expect(actions.augments(event({ gameId: '42', ...values }))).resolves.toMatchObject({
		status: 400
	});
	expect(mocks.changeState).not.toHaveBeenCalled();
});
