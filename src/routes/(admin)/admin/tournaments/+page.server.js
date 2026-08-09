import { fail, redirect } from '@sveltejs/kit';
import { requireTournamentId, text, toStringValues } from '$lib/server/admin/form-helpers.js';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import {
	addRosterPlayers,
	createTournament,
	deleteTournament,
	moveRosterPlayer,
	removeRosterPlayer,
	updateTournament
} from '$lib/server/tournaments/repository.js';

/** @param {unknown} error */
function isConflict(error) {
	return (
		error instanceof Error && /unique|constraint|already exists|duplicate/i.test(error.message)
	);
}

/** @param {string} action @param {unknown} error @param {string} message */
function tournamentFailure(action, error, message) {
	return fail(isConflict(error) ? 409 : 422, {
		action,
		message: isConflict(error) ? 'A tournament with that slug already exists.' : message
	});
}

/** @param {FormData} form @param {string} action @param {boolean} confirmReset */
async function deleteFromForm(form, action, confirmReset) {
	const tournamentId = text(form.get('tournamentId'));
	if (!tournamentId) return fail(400, { action, message: 'A tournament is required.' });
	const result = await deleteTournament(db, { tournamentId, confirmReset });
	return { action, result };
}

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
			return tournamentFailure('createTournament', error, 'Tournament details are invalid.');
		}
		redirect(303, `/admin/tournaments?tournament=${tournament.id}`);
	},
	updateTournament: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		const tournamentId = text(form.get('tournamentId'));
		if (!tournamentId)
			return fail(400, { action: 'updateTournament', message: 'A tournament is required.' });
		try {
			const tournament = await updateTournament(db, {
				tournamentId,
				name: text(form.get('name')),
				slug: text(form.get('slug'))
			});
			return { action: 'updateTournament', tournament };
		} catch (error) {
			return tournamentFailure('updateTournament', error, 'Tournament details are invalid.');
		}
	},
	deleteTournament: async (event) => {
		requireAdmin(event);
		try {
			return await deleteFromForm(await event.request.formData(), 'deleteTournament', false);
		} catch (error) {
			return tournamentFailure('deleteTournament', error, 'Tournament could not be deleted.');
		}
	},
	confirmDeleteTournament: async (event) => {
		requireAdmin(event);
		try {
			return await deleteFromForm(await event.request.formData(), 'confirmDeleteTournament', true);
		} catch (error) {
			return tournamentFailure(
				'confirmDeleteTournament',
				error,
				'Tournament could not be deleted.'
			);
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
			return tournamentFailure('addRosterPlayers', error, 'Roster players could not be added.');
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
			return tournamentFailure('removeRosterPlayer', error, 'Roster player could not be removed.');
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
			return tournamentFailure('moveRosterPlayer', error, 'Roster order could not be changed.');
		}
	}
};
