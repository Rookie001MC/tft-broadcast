import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	loadTournamentAdminData: vi.fn(),
	createTournament: vi.fn(),
	updateTournament: vi.fn(),
	deleteTournament: vi.fn(),
	createPlayer: vi.fn(),
	updatePlayer: vi.fn(),
	replacePlayerImage: vi.fn(),
	removePlayerImage: vi.fn(),
	deletePlayer: vi.fn(),
	stagePlayerImport: vi.fn(),
	commitStagedPlayerImport: vi.fn(),
	loadLatestPlayerImportPreview: vi.fn(),
	addRosterPlayers: vi.fn(),
	removeRosterPlayer: vi.fn(),
	moveRosterPlayer: vi.fn(),
	syncAndActivateCatalog: vi.fn(),
	createCatalogCorrection: vi.fn(),
	updateCatalogCorrection: vi.fn(),
	excludeCatalogResource: vi.fn(),
	restoreCatalogResource: vi.fn(),
	reconcileCatalogCorrectionImages: vi.fn(async () => undefined),
	saveDraftWinnerBoard: vi.fn(),
	publishWinnerBoard: vi.fn(),
	hidePublishedBoard: vi.fn(),
	saveWinnerBoardState: vi.fn(),
	setWinnerBoardLive: vi.fn(),
	resetWinnerBoardState: vi.fn(),
	signOut: vi.fn(),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	rm: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: 'media' } }));
vi.mock('node:fs/promises', async (importOriginal) => ({
	...(await importOriginal()),
	mkdir: mocks.mkdir,
	writeFile: mocks.writeFile,
	rm: mocks.rm
}));
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
vi.mock('$lib/server/catalog/catalog-corrections.js', () => ({
	createCatalogCorrection: mocks.createCatalogCorrection,
	updateCatalogCorrection: mocks.updateCatalogCorrection,
	excludeCatalogResource: mocks.excludeCatalogResource,
	restoreCatalogResource: mocks.restoreCatalogResource,
	reconcileCatalogCorrectionImages: mocks.reconcileCatalogCorrectionImages
}));
vi.mock('$lib/server/import/staging.js', () => ({
	stagePlayerImport: mocks.stagePlayerImport,
	commitStagedPlayerImport: mocks.commitStagedPlayerImport,
	loadLatestPlayerImportPreview: mocks.loadLatestPlayerImportPreview
}));
vi.mock('$lib/server/players/repository.js', () => ({
	createPlayer: mocks.createPlayer,
	deletePlayer: mocks.deletePlayer,
	removePlayerImage: mocks.removePlayerImage,
	replacePlayerImage: mocks.replacePlayerImage,
	updatePlayer: mocks.updatePlayer
}));
vi.mock('$lib/server/tournaments/repository.js', () => ({
	addRosterPlayers: mocks.addRosterPlayers,
	createTournament: mocks.createTournament,
	deleteTournament: mocks.deleteTournament,
	loadTournamentAdminData: mocks.loadTournamentAdminData,
	moveRosterPlayer: mocks.moveRosterPlayer,
	removeRosterPlayer: mocks.removeRosterPlayer,
	updateTournament: mocks.updateTournament
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

const VALID_PNG = Uint8Array.from([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
	0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1,
	255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 68, 174, 66, 96, 130
]);

/** @type {Array<[string, Record<string, (event: any) => Promise<any>>, string[]]>} */
const actionRoutes = [
	[
		'/admin/players',
		playerActions,
		[
			'createPlayer',
			'updatePlayer',
			'replacePlayerImage',
			'removePlayerImage',
			'deletePlayer',
			'confirmDeletePlayer',
			'previewBundle',
			'commitBundle'
		]
	],
	[
		'/admin/tournaments',
		tournamentActions,
		[
			'createTournament',
			'updateTournament',
			'deleteTournament',
			'confirmDeleteTournament',
			'addRosterPlayers',
			'removeRosterPlayer',
			'moveRosterPlayer'
		]
	],
	[
		'/admin/game-resources',
		catalogActions,
		[
			'syncCatalog',
			'createCorrection',
			'updateCorrection',
			'excludeResource',
			'restoreResource',
			'confirmExcludeResource'
		]
	],
	['/admin/graphics', graphicActions, ['saveBoard', 'setLive', 'resetBoard']],
	['/admin/settings', settingsActions, ['logout']]
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

	for (const [path, actions, names] of actionRoutes) {
		for (const name of names) {
			test(`${path} ${name} redirects anonymous submissions before any write`, async () => {
				const action = actions[name];
				expect(action, `${path} must expose the ${name} mutation`).toBeTypeOf('function');
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

	test('loads persisted terminal import state instead of an older tournament aggregate', async () => {
		const stalePreview = { token: 'preview-one', status: 'previewed' };
		const committedPreview = {
			token: 'preview-one',
			status: 'committed',
			committedAt: new Date('2026-08-09T01:00:00.000Z'),
			summary: { created: 1, updated: 0, skipped: 0 }
		};
		mocks.loadTournamentAdminData.mockResolvedValue({ importPreview: stalePreview });
		mocks.loadLatestPlayerImportPreview.mockResolvedValue(committedPreview);

		const result = /** @type {any} */ (
			await load(
				asEvent({
					locals: { user: { id: 'operator-1' } },
					url: new URL('https://broadcast.example/admin')
				})
			)
		);

		expect(result.importPreview).toEqual(committedPreview);
		expect(mocks.reconcileCatalogCorrectionImages).toHaveBeenCalledWith({}, 'media');
	});

	test('maps a player uniqueness conflict to a safe 409 response', async () => {
		mocks.createPlayer.mockRejectedValue(
			new Error('SQLITE_CONSTRAINT_UNIQUE: players.riot_id_key leaked-internal-value')
		);
		const form = new FormData();
		form.set('fullName', 'Player One');
		form.set('displayName', 'Winner One');
		form.set('riotId', 'Winner#TAG');
		const request = new Request('https://broadcast.example/admin/players', {
			method: 'POST',
			body: form
		});

		const result = await playerActions.createPlayer(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(result).toMatchObject({
			status: 409,
			data: {
				action: 'createPlayer',
				message: 'A player with that Riot ID already exists.'
			}
		});
		expect(/** @type {any} */ (result).data.message).not.toContain('SQLITE');
	});

	test('maps repository validation to an action-specific safe 422 response', async () => {
		mocks.updatePlayer.mockRejectedValue(new Error('Full name and display name are required'));
		const form = new FormData();
		form.set('playerId', 'player-one');
		form.set('fullName', '');
		form.set('displayName', 'Winner One');
		const request = new Request('https://broadcast.example/admin/players', {
			method: 'POST',
			body: form
		});

		const result = await playerActions.updatePlayer(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(result).toMatchObject({
			status: 422,
			data: { action: 'updatePlayer', message: 'Player details are invalid.' }
		});
	});

	test('rejects a missing replacement upload before calling the player repository', async () => {
		const form = new FormData();
		form.set('playerId', 'player-one');
		const request = new Request('https://broadcast.example/admin/players', {
			method: 'POST',
			body: form
		});

		const result = await playerActions.replacePlayerImage(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(result).toMatchObject({
			status: 400,
			data: { action: 'replacePlayerImage', message: 'A player image is required.' }
		});
		expect(mocks.replacePlayerImage).not.toHaveBeenCalled();
	});

	test('treats an empty catalog image upload as absent', async () => {
		mocks.createCatalogCorrection.mockResolvedValue({ id: 'correction-one' });
		const form = new FormData();
		form.set('patchLabel', '14.15');
		form.set('resourceKind', 'champion');
		form.set('operation', 'add');
		form.set('manualExternalId', 'manual-one');
		form.set('displayNameOverride', 'Manual One');
		form.set('image', new File([], 'empty.png', { type: 'image/png' }));
		const request = new Request('https://broadcast.example/admin/game-resources', {
			method: 'POST',
			body: form
		});

		const result = await catalogActions.createCorrection(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.createCatalogCorrection).toHaveBeenCalledWith(
			{},
			expect.objectContaining({ imagePathOverride: null })
		);
		expect(result).toMatchObject({ action: 'createCorrection' });
	});

	test('returns a safe import-unavailable conflict without exposing staging internals', async () => {
		mocks.commitStagedPlayerImport.mockRejectedValue(
			new Error('ENOENT: D:\\private\\media\\import-staging\\token.zip')
		);
		const form = new FormData();
		form.set('token', 'token-one');
		const request = new Request('https://broadcast.example/admin/players', {
			method: 'POST',
			body: form
		});

		const result = await playerActions.commitBundle(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(result).toMatchObject({
			status: 409,
			data: {
				action: 'commitBundle',
				message: 'This import preview is no longer available. Create a new preview.'
			}
		});
		expect(/** @type {any} */ (result).data.message).not.toContain('ENOENT');
	});

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

	test('delegates normalized player identity updates to the repository', async () => {
		mocks.updatePlayer.mockResolvedValue({ id: 'player-one', displayName: 'Winner Updated' });
		const form = new FormData();
		form.set('playerId', 'player-one');
		form.set('fullName', 'Player Updated');
		form.set('displayName', 'Winner Updated');
		form.set('riotId', ' Winner # TAG ');
		const request = new Request('https://broadcast.example/admin/players', {
			method: 'POST',
			body: form
		});

		const action = playerActions.updatePlayer;
		expect(action, 'players actions must expose updatePlayer').toBeTypeOf('function');
		const result = await action(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.updatePlayer).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				playerId: 'player-one',
				fullName: 'Player Updated',
				displayName: 'Winner Updated',
				riotId: 'Winner # TAG'
			})
		);
		expect(result).toMatchObject({ action: 'updatePlayer' });
	});

	test('delegates validated player-image bytes to controlled media replacement', async () => {
		mocks.replacePlayerImage.mockResolvedValue({
			id: 'player-one',
			imagePath: 'player-images/player-one-new.png'
		});
		const form = new FormData();
		form.set('playerId', 'player-one');
		form.set('image', new File([VALID_PNG], 'winner.png', { type: 'image/png' }));
		const request = new Request('https://broadcast.example/admin/players', {
			method: 'POST',
			body: form
		});

		const action = playerActions.replacePlayerImage;
		expect(action, 'players actions must expose replacePlayerImage').toBeTypeOf('function');
		const result = await action(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.replacePlayerImage).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				playerId: 'player-one',
				mediaRoot: 'media',
				mime: 'image/png',
				bytes: expect.any(Uint8Array)
			})
		);
		expect(result).toMatchObject({ action: 'replacePlayerImage' });
	});

	test('delegates a named catalog correction update with operator fields only', async () => {
		mocks.updateCatalogCorrection.mockResolvedValue({
			id: 'correction-one',
			displayNameOverride: 'Corrected Ahri'
		});
		const form = new FormData();
		form.set('correctionId', 'correction-one');
		form.set('displayNameOverride', 'Corrected Ahri');
		form.set('tierOverride', '4');
		const request = new Request('https://broadcast.example/admin/game-resources', {
			method: 'POST',
			body: form
		});

		const action = catalogActions.updateCorrection;
		expect(action, 'catalog actions must expose updateCorrection').toBeTypeOf('function');
		const result = await action(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.updateCatalogCorrection).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				correctionId: 'correction-one',
				displayNameOverride: 'Corrected Ahri',
				tierOverride: 4
			})
		);
		expect(result).toMatchObject({ action: 'updateCorrection' });
	});

	test('deletes the prior controlled correction image only after a successful replacement', async () => {
		mocks.updateCatalogCorrection.mockImplementation(async (_database, input) => ({
			id: 'correction-one',
			imagePathOverride: input.imagePathOverride,
			previousImagePath: 'catalog-corrections/old.png'
		}));
		const form = new FormData();
		form.set('correctionId', 'correction-one');
		form.set('image', new File([VALID_PNG], 'replacement.png', { type: 'image/png' }));
		const request = new Request('https://broadcast.example/admin/game-resources', {
			method: 'POST',
			body: form
		});

		const result = await catalogActions.updateCorrection(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(result).toMatchObject({ action: 'updateCorrection' });
		expect(mocks.writeFile).toHaveBeenCalledOnce();
		expect(mocks.rm).toHaveBeenCalledWith(
			expect.stringMatching(/catalog-corrections[\\/]old\.png$/),
			{ force: true }
		);
	});

	test('preserves the prior correction image and removes only the staged replacement on failure', async () => {
		mocks.updateCatalogCorrection.mockRejectedValue(new Error('Catalog correction not found'));
		const form = new FormData();
		form.set('correctionId', 'correction-one');
		form.set('image', new File([VALID_PNG], 'replacement.png', { type: 'image/png' }));
		const request = new Request('https://broadcast.example/admin/game-resources', {
			method: 'POST',
			body: form
		});

		const result = await catalogActions.updateCorrection(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(result).toMatchObject({ status: 422, data: { action: 'updateCorrection' } });
		expect(mocks.rm).toHaveBeenCalledOnce();
		expect(mocks.rm.mock.calls[0][0]).toMatch(/catalog-corrections[\\/][0-9a-f-]+\.png$/);
	});

	test('never deletes a prior correction image outside controlled correction media', async () => {
		mocks.updateCatalogCorrection.mockImplementation(async (_database, input) => ({
			id: 'correction-one',
			imagePathOverride: input.imagePathOverride,
			previousImagePath: '/media/catalog-assets/snapshot/champion.png'
		}));
		const form = new FormData();
		form.set('correctionId', 'correction-one');
		form.set('image', new File([VALID_PNG], 'replacement.png', { type: 'image/png' }));
		const request = new Request('https://broadcast.example/admin/game-resources', {
			method: 'POST',
			body: form
		});

		await catalogActions.updateCorrection(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.rm).not.toHaveBeenCalled();
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

	test('resets the singleton before returning a requested tournament change', async () => {
		mocks.resetWinnerBoardState.mockResolvedValue({ reset: true, wasLive: true });
		const form = new FormData();
		form.set('boardId', 'legacy-client-target');
		form.set('nextTournamentId', 'tournament-2');
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
			nextTournamentId: 'tournament-2',
			result: { reset: true, wasLive: true }
		});
	});

	test.each([
		['deletePlayer', false],
		['confirmDeletePlayer', true]
	])('%s delegates a server-controlled player reset decision', async (actionName, confirmReset) => {
		mocks.deletePlayer.mockResolvedValue(
			confirmReset
				? { deleted: true, reset: true }
				: { kind: 'reset_required', label: 'Winner One' }
		);
		const action = /** @type {Record<string, any>} */ (playerActions)[actionName];
		expect(action, `players actions must expose ${actionName}`).toBeTypeOf('function');
		const form = new FormData();
		form.set('playerId', 'player-one');
		const request = new Request('https://broadcast.example/admin/players', {
			method: 'POST',
			body: form
		});

		const result = await action(
			asEvent({
				locals: { user: { id: 'operator-1' } },
				request,
				url: new URL(request.url)
			})
		);

		expect(mocks.deletePlayer).toHaveBeenCalledWith(
			{},
			expect.objectContaining({ playerId: 'player-one', confirmReset })
		);
		expect(result).toMatchObject({ action: actionName });
	});

	test.each([
		['deleteTournament', false],
		['confirmDeleteTournament', true]
	])(
		'%s delegates a server-controlled tournament reset decision',
		async (actionName, confirmReset) => {
			mocks.deleteTournament.mockResolvedValue(
				confirmReset
					? { deleted: true, reset: true }
					: { kind: 'reset_required', label: 'Tournament One' }
			);
			const action = /** @type {Record<string, any>} */ (tournamentActions)[actionName];
			expect(action, `tournament actions must expose ${actionName}`).toBeTypeOf('function');
			const form = new FormData();
			form.set('tournamentId', 'tournament-one');
			const request = new Request('https://broadcast.example/admin/tournaments', {
				method: 'POST',
				body: form
			});

			const result = await action(
				asEvent({
					locals: { user: { id: 'operator-1' } },
					request,
					url: new URL(request.url)
				})
			);

			expect(mocks.deleteTournament).toHaveBeenCalledWith(
				{},
				expect.objectContaining({ tournamentId: 'tournament-one', confirmReset })
			);
			expect(result).toMatchObject({ action: actionName });
		}
	);
});
