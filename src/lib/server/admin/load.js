import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { loadTournamentAdminData } from '$lib/server/tournaments/repository.js';

/** @param {{ locals: App.Locals, url: URL }} event */
export async function loadAdminData(event) {
	requireAdmin(/** @type {any} */ (event));
	return await loadTournamentAdminData(db, event.url.searchParams.get('tournament'));
}
