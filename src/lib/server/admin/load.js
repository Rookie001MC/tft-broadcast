import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { reconcileCatalogCorrectionImages } from '$lib/server/catalog/catalog-corrections.js';
import { loadLatestPlayerImportPreview } from '$lib/server/import/staging.js';
import { loadTournamentAdminData } from '$lib/server/tournaments/repository.js';

/** @param {{ locals: App.Locals, url: URL }} event */
export async function loadAdminData(event) {
	requireAdmin(/** @type {any} */ (event));
	const mediaRoot = env.MEDIA_ROOT ?? 'media';
	const [adminData, importPreview] = await Promise.all([
		loadTournamentAdminData(db, event.url.searchParams.get('tournament')),
		loadLatestPlayerImportPreview({ db, mediaRoot }),
		reconcileCatalogCorrectionImages(db, mediaRoot).catch(() => undefined)
	]);
	return { ...adminData, importPreview };
}
