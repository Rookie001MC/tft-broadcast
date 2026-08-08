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
	saveWinnerBoardState: vi.fn(),
	setWinnerBoardLive: vi.fn(),
	resetWinnerBoardState: vi.fn(),
	signOut: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: 'media' } }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signOut: mocks.signOut } } }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/catalog/catalog-sync.js', () => ({
	/** @param {unknown} caught */
	catalogOperatorMessage: (caught) =>
		caught instanceof Error
			? caught.message
			: 'Catalog synchronization failed; the prior snapshot remains active.',
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
	saveDraftWinnerBoard: mocks.saveDraftWinnerBoard,
	resetWinnerBoardState: mocks.resetWinnerBoardState,
	saveWinnerBoardState: mocks.saveWinnerBoardState,
	setWinnerBoardLive: mocks.setWinnerBoardLive
}));

import { load } from './+page.server.js';
import { actions as playerActions } from './players/+page.server.js';
import { actions as tournamentActions } from './tournaments/+page.server.js';
import { actions as catalogActions } from './game-resources/+page.server.js';
import { actions as graphicActions } from './graphics/+page.server.js';
import { actions as settingsActions } from './settings/+page.server.js';

/** @type {Array<[string, Record<string, (event: any) => Promise<any>>]>} */
const actionRoutes = [
	['/admin/players', playerActions],
	['/admin/tournaments', tournamentActions],
	['/admin/game-resources', catalogActions],
	['/admin/graphics', graphicActions],
	['/admin/settings', settingsActions]
];

/** @param {string} url */
function emptyRequest(url) {
	return new Request(url, { method: 'POST' });
}

/** @param {Record<string, any>} event */
function asEvent(event) {
	return /** @type {any} */ (event);
}

describe('admin route authorization', () => {
	beforeEach(() => vi.clearAllMocks());

	test('redirects anonymous dashboard loads to login before loading data', async () => {
		await expect(
			load(asEvent({ locals: {}, url: new URL('https://broadcast.example/admin') }))
		).rejects.toEqual(expect.objectContaining({ status: 303, location: '/login?next=%2Fadmin' }));
		expect(mocks.loadTournamentAdminData).not.toHaveBeenCalled();
	});

	for (const [path, actions] of actionRoutes) {
		for (const [name, action] of Object.entries(actions)) {
			test(`${path} ${name} redirects anonymous submissions before any write`, async () => {
				const url = `https://broadcast.example${path}`;
				await expect(
					action(asEvent({ locals: {}, request: emptyRequest(url), url: new URL(url) }))
				).rejects.toEqual(
					expect.objectContaining({
						status: 303,
						location: `/login?next=${encodeURIComponent(path)}`
					})
				);
				for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
			});
		}
	}
});

describe('admin action results', () => {
	beforeEach(() => vi.clearAllMocks());

	test('redirects to the newly created tournament route without catching the redirect', async () => {
		mocks.createTournament.mockResolvedValue({ id: 'tournament-1' });
		const form = new FormData();
		form.set('name', 'HCMUSEC Finals');
		const request = new Request('https://broadcast.example/admin/tournaments', {
			method: 'POST',
			body: form
		});

		await expect(
			tournamentActions.createTournament(
				asEvent({
					locals: { user: { id: 'operator-1' } },
					request,
					url: new URL(request.url)
				})
			)
		).rejects.toEqual(
			expect.objectContaining({
				status: 303,
				location: '/admin/tournaments?tournament=tournament-1'
			})
		);
	});

	test('returns the safe catalog failure summary from the no-JavaScript action', async () => {
		const message =
			'CommunityDragon failed during downloading: the source referenced an unsupported asset. Data Dragon failed during downloading: the package exceeded the configured size limit. The prior snapshot remains active.';
		mocks.syncAndActivateCatalog.mockRejectedValue(new Error(message));
		const form = new FormData();
		form.set('tournamentId', 'tournament-1');
		form.set('patch', 'latest');
		form.set('locale', 'vi_vn');
		const request = new Request('https://broadcast.example/admin/game-resources', {
			method: 'POST',
			body: form
		});

		const result = await catalogActions.syncCatalog(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);
		expect(result).toMatchObject({
			status: 422,
			data: { action: 'syncCatalog', message }
		});
	});

	test('saves the singleton board without accepting a client board ID', async () => {
		mocks.saveWinnerBoardState.mockResolvedValue({ id: 'current', title: 'TFT Champion' });
		const form = new FormData();
		form.set('boardId', 'legacy-draft-id');
		form.set('tournamentId', 'tournament-1');
		form.set('winnerPlayerId', 'player-1');
		form.set('title', 'TFT Champion');
		form.append('championIds', 'champion-2');
		form.append('championIds', 'champion-1');
		form.set('starLevel:champion-2', '3');
		form.append('augmentIds', 'augment-2');
		const request = new Request('https://broadcast.example/admin/graphics', {
			method: 'POST',
			body: form
		});

		const result = await graphicActions.saveBoard(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.saveWinnerBoardState).toHaveBeenCalledWith(
			{},
			{
				tournamentId: 'tournament-1',
				winnerPlayerId: 'player-1',
				title: 'TFT Champion',
				champions: [
					{ catalogChampionId: 'champion-2', starLevel: 3 },
					{ catalogChampionId: 'champion-1', starLevel: null }
				],
				augmentIds: ['augment-2']
			}
		);
		expect(mocks.saveDraftWinnerBoard).not.toHaveBeenCalled();
		expect(result).toEqual({
			action: 'saveBoard',
			board: { id: 'current', title: 'TFT Champion' }
		});
	});

	test.each([
		['true', true],
		['false', false]
	])('sets Live to %s from the persisted singleton', async (enabled, parsed) => {
		mocks.setWinnerBoardLive.mockResolvedValue(parsed);
		const form = new FormData();
		form.set('enabled', enabled);
		form.set('boardId', 'legacy-client-target');
		const request = new Request('https://broadcast.example/admin/graphics', {
			method: 'POST',
			body: form
		});

		const result = await graphicActions.setLive(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.setWinnerBoardLive).toHaveBeenCalledWith({}, parsed);
		expect(result).toEqual({ action: 'setLive', live: parsed });
	});

	test('resets the singleton without a client-selected target', async () => {
		mocks.resetWinnerBoardState.mockResolvedValue({ reset: true, wasLive: true });
		const form = new FormData();
		form.set('boardId', 'legacy-client-target');
		const request = new Request('https://broadcast.example/admin/graphics', {
			method: 'POST',
			body: form
		});

		const result = await graphicActions.resetBoard(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.resetWinnerBoardState).toHaveBeenCalledWith({});
		expect(result).toEqual({
			action: 'resetBoard',
			result: { reset: true, wasLive: true }
		});
	});
});
