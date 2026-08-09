import {
	actionFailure,
	requireTournamentId,
	text,
	toStringValues
} from '$lib/server/admin/form-helpers.js';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import {
	getWinnerBoardState,
	resetWinnerBoardState,
	saveWinnerBoardState,
	setWinnerBoardLive
} from '$lib/server/winner-boards/repository.js';

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
		livePublicationId: adminData.liveBoard?.id ?? null
	};
}

/** @satisfies {import('./$types').Actions} */
export const actions = {
	saveBoard: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const championIds = toStringValues(form.getAll('championIds'));
			const champions = championIds.map((catalogChampionId) => ({
				catalogChampionId,
				starLevel: (() => {
					const value = form.get(`starLevel:${catalogChampionId}`);
					const starLevel = typeof value === 'string' && value ? Number(value) : Number.NaN;
					return Number.isInteger(starLevel) ? starLevel : null;
				})()
			}));
			const board = await saveWinnerBoardState(db, {
				tournamentId,
				winnerPlayerId: text(form.get('winnerPlayerId')),
				title: text(form.get('title')),
				champions,
				augmentIds: toStringValues(form.getAll('augmentIds'))
			});
			return { action: 'saveBoard', board };
		} catch {
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
	}
};
