import {
	actionFailure,
	requireTournamentId,
	text,
	toStringValues
} from '$lib/server/admin/form-helpers.js';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import {
	getTftMatchApiAvailability,
	requireTftMatchApiConfig
} from '$lib/server/tft-matches/config.js';
import {
	resolveTftMatchPreviewForSave,
	TftMatchPreviewConflictError
} from '$lib/server/tft-matches/discovery.js';
import { deleteTftMatchPreviewBatch } from '$lib/server/tft-matches/cache.js';
import { loadTournamentAdminData } from '$lib/server/tournaments/repository.js';
import {
	getWinnerBoardState,
	resetWinnerBoardState,
	saveWinnerBoardState,
	setWinnerBoardLive
} from '$lib/server/winner-boards/repository.js';

/** @param {string} value */
function parseStarLevel(value) {
	const starLevel = value ? Number(value) : Number.NaN;
	return Number.isInteger(starLevel) ? starLevel : null;
}

/** @type {import('./$types').PageServerLoad} */
export async function load(event) {
	const [adminData, savedBoard] = await Promise.all([
		loadAdminData(event),
		getWinnerBoardState(db)
	]);
	return {
		tournaments: adminData.tournaments,
		selectedTournament: adminData.selectedTournament,
		roster: adminData.roster,
		activeCatalog: adminData.activeCatalog,
		savedBoard,
		livePublicationId: adminData.liveBoard?.id ?? null,
		tftMatchApi: getTftMatchApiAvailability(env)
	};
}

/** @satisfies {import('./$types').Actions} */
export const actions = {
	saveBoard: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const tftPreviewToken = text(form.get('tftPreviewToken'));
			const tftMatchId = text(form.get('tftMatchId'));
			if (Boolean(tftPreviewToken) !== Boolean(tftMatchId))
				throw new TftMatchPreviewConflictError();
			const championIds = toStringValues(form.getAll('championCatalogId'));
			const starLevels = toStringValues(form.getAll('championStarLevel'));
			if (championIds.length !== starLevels.length) throw new Error('Invalid champion slots');
			const champions = championIds.map((catalogChampionId, displayOrder) => ({
				catalogChampionId,
				starLevel: parseStarLevel(starLevels[displayOrder])
			}));
			const sourceSnapshot =
				tftPreviewToken && tftMatchId
					? await resolveTftMatchPreviewForSave({
							database: db,
							token: tftPreviewToken,
							matchId: tftMatchId,
							tournamentId,
							config: requireTftMatchApiConfig(env)
						})
					: null;
			const board = await saveWinnerBoardState(db, {
				tournamentId,
				winnerPlayerId: text(form.get('winnerPlayerId')),
				title: text(form.get('title')),
				champions,
				augmentIds: toStringValues(form.getAll('augmentIds')),
				...(sourceSnapshot ? { sourceSnapshot } : {})
			});
			if (tftPreviewToken) deleteTftMatchPreviewBatch(tftPreviewToken);
			return { action: 'saveBoard', board };
		} catch (error) {
			if (error instanceof TftMatchPreviewConflictError)
				return actionFailure(
					'saveBoard',
					new Error('This API preview is no longer available. Fetch it again.'),
					409
				);
			return actionFailure('saveBoard', new Error('Winner board details are invalid.'), 422);
		}
	},
	setLive: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const live = await setWinnerBoardLive(db, text(form.get('enabled')) === 'true');
			return { action: 'setLive', live };
		} catch {
			return actionFailure('setLive', new Error('Live status could not be changed.'), 409);
		}
	},
	resetBoard: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const nextTournamentId = text(form.get('nextTournamentId')) || null;
			const result = await resetWinnerBoardState(db);
			return {
				action: 'resetBoard',
				...(nextTournamentId ? { nextTournamentId } : {}),
				result
			};
		} catch {
			return actionFailure('resetBoard', new Error('Winner board could not be reset.'), 409);
		}
	},
	resetAndSelectTournament: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		const nextTournamentId = text(form.get('nextTournamentId'));
		if (!nextTournamentId) {
			return actionFailure(
				'resetAndSelectTournament',
				new Error('A target tournament is required.'),
				400
			);
		}
		try {
			const { selectedTournament } = await loadTournamentAdminData(db, nextTournamentId);
			if (selectedTournament?.id !== nextTournamentId) {
				return actionFailure(
					'resetAndSelectTournament',
					new Error('The target tournament is no longer available.'),
					400
				);
			}
			await resetWinnerBoardState(db);
		} catch {
			return actionFailure(
				'resetAndSelectTournament',
				new Error('Winner board could not be reset.'),
				409
			);
		}
		redirect(303, `/admin/graphics?tournament=${encodeURIComponent(nextTournamentId)}`);
	}
};
