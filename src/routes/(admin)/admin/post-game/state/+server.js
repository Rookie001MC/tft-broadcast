import { json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { getState } from '$lib/server/post-game/store.js';
/** @type {import('./$types').RequestHandler} */
export async function GET(event) {
	requireAdmin(event);
	const s = await getState();
	return json(
		{ data: s.draft, visible: true, revision: s.revision },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
}
