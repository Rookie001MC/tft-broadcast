import {
	actionFailure,
	requireTournamentId,
	text,
	toStringValues
} from '$lib/server/admin/form-helpers.js';
import { redirect } from '@sveltejs/kit';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import { loadTournamentAdminData } from '$lib/server/tournaments/repository.js';
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
