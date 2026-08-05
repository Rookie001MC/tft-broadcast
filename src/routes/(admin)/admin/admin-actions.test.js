import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadTournamentAdminData: vi.fn(),
	createTournament: vi.fn(),
	createPlayer: vi.fn(),
	stagePlayerImport: vi.fn(),
	commitStagedPlayerImport: vi.fn(),
	addRosterPlayers: vi.fn(),
	removeRosterPlayer: vi.fn(),
	moveRosterPlayer: vi.fn(),
	syncAndActivateCatalog: vi.fn(),
	saveDraftWinnerBoard: vi.fn(),
	publishWinnerBoard: vi.fn(),
	hidePublishedBoard: vi.fn(),
	signOut: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: 'media' } }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signOut: mocks.signOut } } }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/catalog/catalog-sync.js', () => ({
	syncAndActivateCatalog: mocks.syncAndActivateCatalog
}));
vi.mock('$lib/server/import/staging.js', () => ({
	stagePlayerImport: mocks.stagePlayerImport,
	commitStagedPlayerImport: mocks.commitStagedPlayerImport
}));
vi.mock('$lib/server/players/repository.js', () => ({ createPlayer: mocks.createPlayer }));
vi.mock('$lib/server/tournaments/repository.js', () => ({
	addRosterPlayers: mocks.addRosterPlayers,
	createTournament: mocks.createTournament,
	loadTournamentAdminData: mocks.loadTournamentAdminData,
	moveRosterPlayer: mocks.moveRosterPlayer,
	removeRosterPlayer: mocks.removeRosterPlayer
}));
vi.mock('$lib/server/winner-boards/repository.js', () => ({
	hidePublishedBoard: mocks.hidePublishedBoard,
	publishWinnerBoard: mocks.publishWinnerBoard,
	saveDraftWinnerBoard: mocks.saveDraftWinnerBoard
}));

import { actions, load } from './+page.server.js';

/** @param {string} url */
function emptyRequest(url = 'https://broadcast.example/admin') {
	return new Request(url, { method: 'POST' });
}

/** @param {Record<string, any>} event */
function asEvent(event) {
	return /** @type {any} */ (event);
}

describe('admin route authorization', () => {
	beforeEach(() => vi.clearAllMocks());

	test('redirects anonymous loads to login before loading data', async () => {
		await expect(
			load(asEvent({ locals: {}, url: new URL('https://broadcast.example/admin') }))
		).rejects.toEqual(expect.objectContaining({ status: 303, location: '/login?next=%2Fadmin' }));
		expect(mocks.loadTournamentAdminData).not.toHaveBeenCalled();
	});

	for (const [name, action] of Object.entries(actions)) {
		test(`${name} redirects anonymous submissions to login before any write`, async () => {
			await expect(
				action(
					asEvent({
						locals: {},
						request: emptyRequest(),
						url: new URL('https://broadcast.example/admin')
					})
				)
			).rejects.toEqual(expect.objectContaining({ status: 303, location: '/login?next=%2Fadmin' }));
			expect(mocks.createTournament).not.toHaveBeenCalled();
			expect(mocks.createPlayer).not.toHaveBeenCalled();
			expect(mocks.stagePlayerImport).not.toHaveBeenCalled();
			expect(mocks.commitStagedPlayerImport).not.toHaveBeenCalled();
			expect(mocks.addRosterPlayers).not.toHaveBeenCalled();
			expect(mocks.removeRosterPlayer).not.toHaveBeenCalled();
			expect(mocks.moveRosterPlayer).not.toHaveBeenCalled();
			expect(mocks.syncAndActivateCatalog).not.toHaveBeenCalled();
			expect(mocks.saveDraftWinnerBoard).not.toHaveBeenCalled();
			expect(mocks.publishWinnerBoard).not.toHaveBeenCalled();
			expect(mocks.hidePublishedBoard).not.toHaveBeenCalled();
			expect(mocks.signOut).not.toHaveBeenCalled();
		});
	}
});

describe('admin action results', () => {
	beforeEach(() => vi.clearAllMocks());

	test('redirects to the newly created tournament without catching the redirect', async () => {
		mocks.createTournament.mockResolvedValue({ id: 'tournament-1' });
		const form = new FormData();
		form.set('name', 'HCMUSEC Finals');
		const request = new Request('https://broadcast.example/admin', { method: 'POST', body: form });

		await expect(
			actions.createTournament(
				asEvent({
					locals: { user: { id: 'operator-1' } },
					request,
					url: new URL(request.url)
				})
			)
		).rejects.toEqual(
			expect.objectContaining({ status: 303, location: '/admin?tournament=tournament-1' })
		);
	});
});
