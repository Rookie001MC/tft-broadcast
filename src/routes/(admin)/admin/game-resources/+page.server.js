import { env } from '$env/dynamic/private';
import { actionFailure, requireTournamentId, text } from '$lib/server/admin/form-helpers.js';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { catalogArchiveLimits } from '$lib/server/catalog/catalog-config.js';
import { acquireCatalogSync } from '$lib/server/catalog/catalog-lock.js';
import {
	catalogOperatorMessage,
	syncAndActivateCatalog
} from '$lib/server/catalog/catalog-sync.js';
import { db } from '$lib/server/db';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';

/** @type {import('./$types').PageServerLoad} */
export const load = loadAdminData;

/** @satisfies {import('./$types').Actions} */
export const actions = {
	syncCatalog: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const archiveLimits = catalogArchiveLimits(env);
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
					mediaRoot: MEDIA_ROOT,
					archiveLimits
				});
				return { action: 'syncCatalog', ...result };
			} finally {
				release();
			}
		} catch (error) {
			return actionFailure('syncCatalog', new Error(catalogOperatorMessage(error)), 422);
		}
	}
};
