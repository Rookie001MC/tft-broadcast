import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import { actionFailure, text } from '$lib/server/admin/form-helpers.js';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema/players.js';
import { commitStagedPlayerImport, stagePlayerImport } from '$lib/server/import/staging.js';
import { createPlayer } from '$lib/server/players/repository.js';

const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';

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
	}
};
