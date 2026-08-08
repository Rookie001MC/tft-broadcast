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
		} catch (error) {
			return actionFailure('saveBoard', error);
		}
	},
	setLive: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const live = await setWinnerBoardLive(db, text(form.get('enabled')) === 'true');
			return { action: 'setLive', live };
		} catch (error) {
			return actionFailure('setLive', error);
		}
	},
	resetBoard: async (event) => {
		requireAdmin(event);
		try {
			const result = await resetWinnerBoardState(db);
			return { action: 'resetBoard', result };
		} catch (error) {
			return actionFailure('resetBoard', error);
		}
	}
};
