import { actionFailure, requireTournamentId, text } from '$lib/server/admin/form-helpers.js';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { syncAndActivateCatalog } from '$lib/server/catalog/catalog-sync.js';
import { acquireCatalogSync } from '$lib/server/catalog/catalog-lock.js';
import { db } from '$lib/server/db';
import { env } from '$env/dynamic/private';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';

/** @type {import('./$types').PageServerLoad} */
export const load = loadAdminData;

/** @satisfies {import('./$types').Actions} */
export const actions = {
	syncCatalog: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const release = acquireCatalogSync(tournamentId);
			if (!release)
				return actionFailure('syncCatalog', new Error('A catalog sync is already running.'), 409);
			const patch = text(form.get('patch')) || 'latest';
			const locale = text(form.get('locale')) || 'vi_vn';
			try {
				const result = await syncAndActivateCatalog({
					db,
					tournamentId,
					patch,
					locale,
					mediaRoot: MEDIA_ROOT
				});
				return { action: 'syncCatalog', ...result };
			} finally {
				release();
			}
		} catch (error) {
			return actionFailure('syncCatalog', error, 422);
		}
	}
};
