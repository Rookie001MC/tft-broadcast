import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { auth } from '$lib/server/auth';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { syncAndActivateCatalog } from '$lib/server/catalog/catalog-sync.js';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema/players.js';
import { commitStagedPlayerImport, stagePlayerImport } from '$lib/server/import/staging.js';
import { createPlayer } from '$lib/server/players/repository.js';
import {
	addRosterPlayers,
	createTournament,
	loadTournamentAdminData,
	moveRosterPlayer,
	removeRosterPlayer
} from '$lib/server/tournaments/repository.js';
import {
	hidePublishedBoard,
	publishWinnerBoard,
	saveDraftWinnerBoard
} from '$lib/server/winner-boards/repository.js';

const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';

/** @param {unknown} value */
function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @param {FormDataEntryValue[]} values */
function toStringValues(values) {
	return values
		.filter((value) => typeof value === 'string' && value.trim())
		.map((value) => /** @type {string} */ (value).trim());
}

/** @param {string} action @param {unknown} error @param {number} [status] */
function actionFailure(action, error, status = 400) {
	const message = error instanceof Error ? error.message : 'The requested action failed.';
	return fail(status, { action, message });
}

/** @param {{ request: Request, url: URL }} event */
async function requireTournamentId(event) {
	const form = await event.request.formData();
	const rawTournamentId = form.get('tournamentId') ?? event.url.searchParams.get('tournament');
	const tournamentId = text(rawTournamentId);
	if (!tournamentId) throw new Error('Tournament must be selected');
	return { form, tournamentId };
}

/** @type {import('./$types').PageServerLoad} */
export async function load(event) {
	requireAdmin(event);
	return loadTournamentAdminData(db, event.url.searchParams.get('tournament'));
}

/** @satisfies {import('./$types').Actions} */
export const actions = {
	createTournament: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		try {
			const tournament = await createTournament(db, { name: text(form.get('name')) });
			if (!tournament) {
				return fail(400, { action: 'createTournament', message: 'Tournament was not created.' });
			}
			redirect(303, `/admin?tournament=${tournament.id}`);
		} catch (error) {
			return actionFailure('createTournament', error);
		}
	},
	createPlayer: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		try {
			const player = await createPlayer(db, {
				fullName: text(form.get('fullName')),
				displayName: text(form.get('displayName')),
				riotId: text(form.get('riotId')) || null
			});
			return { action: 'createPlayer', player };
		} catch (error) {
			const status = error instanceof Error && /unique|constraint/i.test(error.message) ? 409 : 400;
			return actionFailure('createPlayer', error, status);
		}
	},
	previewBundle: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const rawFile = form.get('bundle');
			if (!(rawFile instanceof File)) {
				return fail(400, { action: 'previewBundle', message: 'A ZIP file is required.' });
			}
			if (!rawFile.name.toLowerCase().endsWith('.zip')) {
				return fail(400, {
					action: 'previewBundle',
					message: 'The uploaded file must be named .zip.'
				});
			}
			if (rawFile.size > MAX_BUNDLE_BYTES) {
				return fail(400, { action: 'previewBundle', message: 'ZIP file is too large.' });
			}
			const existingPlayers = await db.select().from(players);
			const { token, preview } = await stagePlayerImport({
				db,
				zipBytes: new Uint8Array(await rawFile.arrayBuffer()),
				mediaRoot: MEDIA_ROOT,
				existingPlayers
			});
			return { action: 'previewBundle', token, preview };
		} catch (error) {
			return actionFailure('previewBundle', error);
		}
	},
	commitBundle: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const token = text(form.get('token'));
			if (!token) {
				return fail(400, { action: 'commitBundle', message: 'An import token is required.' });
			}
			const result = await commitStagedPlayerImport({ db, token, mediaRoot: MEDIA_ROOT });
			return { action: 'commitBundle', ...result };
		} catch (error) {
			return actionFailure('commitBundle', error);
		}
	},
	addRosterPlayers: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const playerIds = toStringValues(form.getAll('playerIds'));
			if (playerIds.length === 0) {
				return fail(400, {
					action: 'addRosterPlayers',
					message: 'At least one player is required.'
				});
			}
			await addRosterPlayers(db, { tournamentId, playerIds });
			return { action: 'addRosterPlayers', tournamentId };
		} catch (error) {
			return actionFailure('addRosterPlayers', error);
		}
	},
	removeRosterPlayer: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const playerId = text(form.get('playerId'));
			if (!playerId) {
				return fail(400, { action: 'removeRosterPlayer', message: 'A roster player is required.' });
			}
			await removeRosterPlayer(db, { tournamentId, playerId });
			return { action: 'removeRosterPlayer', tournamentId, playerId };
		} catch (error) {
			return actionFailure('removeRosterPlayer', error);
		}
	},
	moveRosterPlayer: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const playerId = text(form.get('playerId'));
			const displayOrder = Number(form.get('displayOrder'));
			if (!playerId || !Number.isInteger(displayOrder)) {
				return fail(400, {
					action: 'moveRosterPlayer',
					message: 'A player and valid order are required.'
				});
			}
			await moveRosterPlayer(db, { tournamentId, playerId, displayOrder });
			return { action: 'moveRosterPlayer', tournamentId, playerId, displayOrder };
		} catch (error) {
			return actionFailure('moveRosterPlayer', error);
		}
	},
	syncCatalog: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const patch = text(form.get('patch')) || 'latest';
			const locale = text(form.get('locale')) || 'vi_vn';
			const result = await syncAndActivateCatalog({
				db,
				tournamentId,
				patch,
				locale,
				fetchJson: async (url) => {
					const response = await fetch(url);
					if (!response.ok) throw new Error(`Catalog sync failed for ${url}`);
					return response.json();
				}
			});
			return { action: 'syncCatalog', ...result };
		} catch (error) {
			return actionFailure('syncCatalog', error, 422);
		}
	},
	saveBoard: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const championIds = toStringValues(form.getAll('championIds'));
			const champions = championIds.map((catalogChampionId) => ({
				catalogChampionId,
				starLevel: (() => {
					const rawStarLevel = form.get(`starLevel:${catalogChampionId}`);
					const starLevel = Number(rawStarLevel);
					return Number.isInteger(starLevel) ? starLevel : null;
				})()
			}));
			const augmentIds = toStringValues(form.getAll('augmentIds'));
			const board = await saveDraftWinnerBoard(db, {
				boardId: text(form.get('boardId')) || null,
				tournamentId,
				winnerPlayerId: text(form.get('winnerPlayerId')),
				title: text(form.get('title')),
				champions,
				augmentIds
			});
			return { action: 'saveBoard', board };
		} catch (error) {
			return actionFailure('saveBoard', error);
		}
	},
	publishBoard: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const boardId = text(form.get('boardId'));
			if (!boardId) {
				return fail(400, { action: 'publishBoard', message: 'A board ID is required.' });
			}
			const board = await publishWinnerBoard(db, boardId);
			return { action: 'publishBoard', board };
		} catch (error) {
			return actionFailure('publishBoard', error);
		}
	},
	hideBoard: async (event) => {
		requireAdmin(event);
		try {
			const hidden = await hidePublishedBoard(db);
			return { action: 'hideBoard', hidden };
		} catch (error) {
			return actionFailure('hideBoard', error);
		}
	},
	logout: async (event) => {
		requireAdmin(event);
		await auth.api.signOut({ headers: event.request.headers });
		redirect(303, '/login');
	}
};
