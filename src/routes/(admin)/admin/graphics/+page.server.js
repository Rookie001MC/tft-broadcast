import { fail } from '@sveltejs/kit';
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
	hidePublishedBoard,
	publishWinnerBoard,
	saveDraftWinnerBoard
} from '$lib/server/winner-boards/repository.js';

/** @type {import('./$types').PageServerLoad} */
export const load = loadAdminData;

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
					const starLevel = Number(form.get(`starLevel:${catalogChampionId}`));
					return Number.isInteger(starLevel) ? starLevel : null;
				})()
			}));
			const board = await saveDraftWinnerBoard(db, {
				boardId: text(form.get('boardId')) || null,
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
	}
};
