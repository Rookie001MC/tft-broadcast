import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import { actionFailure, text } from '$lib/server/admin/form-helpers.js';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema/players.js';
import { commitStagedPlayerImport, stagePlayerImport } from '$lib/server/import/staging.js';
import {
	createPlayer,
	deletePlayer,
	removePlayerImage,
	replacePlayerImage,
	updatePlayer
} from '$lib/server/players/repository.js';

const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const MAX_PLAYER_IMAGE_BYTES = 10 * 1024 * 1024;
const PLAYER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';

/** @param {unknown} error */
function isConflict(error) {
	return (
		error instanceof Error && /unique|constraint|already exists|duplicate/i.test(error.message)
	);
}

/** @param {string} action @param {unknown} error @param {string} message */
function playerFailure(action, error, message) {
	return fail(isConflict(error) ? 409 : 422, {
		action,
		message: isConflict(error) ? 'A player with that Riot ID already exists.' : message
	});
}

/** @param {FormData} form @param {string} action @param {boolean} confirmReset */
async function deleteFromForm(form, action, confirmReset) {
	const playerId = text(form.get('playerId'));
	if (!playerId) return fail(400, { action, message: 'A player is required.' });
	const result = await deletePlayer(db, { playerId, confirmReset, mediaRoot: MEDIA_ROOT });
	return { action, playerId, result };
}

/** @type {import('./$types').PageServerLoad} */
export const load = loadAdminData;

/** @satisfies {import('./$types').Actions} */
export const actions = {
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
			return playerFailure('createPlayer', error, 'Player details are invalid.');
		}
	},
	updatePlayer: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		const playerId = text(form.get('playerId'));
		if (!playerId) return fail(400, { action: 'updatePlayer', message: 'A player is required.' });
		try {
			const player = await updatePlayer(db, {
				playerId,
				fullName: text(form.get('fullName')),
				displayName: text(form.get('displayName')),
				riotId: text(form.get('riotId')) || null,
				riotGameName: text(form.get('riotGameName')) || null,
				riotTagline: text(form.get('riotTagline')) || null
			});
			return { action: 'updatePlayer', player };
		} catch (error) {
			return playerFailure('updatePlayer', error, 'Player details are invalid.');
		}
	},
	replacePlayerImage: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		const playerId = text(form.get('playerId'));
		const image = form.get('image');
		if (!playerId)
			return fail(400, { action: 'replacePlayerImage', message: 'A player is required.' });
		if (!(image instanceof File) || image.size === 0)
			return fail(400, {
				action: 'replacePlayerImage',
				message: 'A player image is required.'
			});
		if (image.size > MAX_PLAYER_IMAGE_BYTES || !PLAYER_IMAGE_TYPES.has(image.type))
			return fail(400, {
				action: 'replacePlayerImage',
				message: 'Player image must be a PNG, JPEG, or WebP up to 10 MB.'
			});
		try {
			const player = await replacePlayerImage(db, {
				playerId,
				mediaRoot: MEDIA_ROOT,
				bytes: new Uint8Array(await image.arrayBuffer()),
				mime: image.type
			});
			return { action: 'replacePlayerImage', player };
		} catch (error) {
			return playerFailure('replacePlayerImage', error, 'Player image could not be replaced.');
		}
	},
	removePlayerImage: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		const playerId = text(form.get('playerId'));
		if (!playerId)
			return fail(400, { action: 'removePlayerImage', message: 'A player is required.' });
		try {
			const player = await removePlayerImage(db, { playerId, mediaRoot: MEDIA_ROOT });
			return { action: 'removePlayerImage', player };
		} catch (error) {
			return playerFailure('removePlayerImage', error, 'Player image could not be removed.');
		}
	},
	deletePlayer: async (event) => {
		requireAdmin(event);
		try {
			return await deleteFromForm(await event.request.formData(), 'deletePlayer', false);
		} catch (error) {
			return playerFailure('deletePlayer', error, 'Player could not be deleted.');
		}
	},
	confirmDeletePlayer: async (event) => {
		requireAdmin(event);
		try {
			return await deleteFromForm(await event.request.formData(), 'confirmDeletePlayer', true);
		} catch (error) {
			return playerFailure('confirmDeletePlayer', error, 'Player could not be deleted.');
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
		} catch {
			return actionFailure(
				'previewBundle',
				new Error('The import bundle could not be previewed.'),
				422
			);
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
		} catch {
			return fail(409, {
				action: 'commitBundle',
				message: 'This import preview is no longer available. Create a new preview.'
			});
		}
	}
};
