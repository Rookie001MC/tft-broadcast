import { fail, redirect } from '@sveltejs/kit';
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
	addRosterPlayers,
	createTournament,
	moveRosterPlayer,
	removeRosterPlayer
} from '$lib/server/tournaments/repository.js';

/** @type {import('./$types').PageServerLoad} */
export const load = loadAdminData;

/** @satisfies {import('./$types').Actions} */
export const actions = {
	createTournament: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		let tournament;
		try {
			tournament = await createTournament(db, { name: text(form.get('name')) });
			if (!tournament) {
				return fail(400, { action: 'createTournament', message: 'Tournament was not created.' });
			}
		} catch (error) {
			return actionFailure('createTournament', error);
		}
		redirect(303, `/admin/tournaments?tournament=${tournament.id}`);
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
	}
};
