import { renderPostGame } from '$lib/server/post-game/render.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
/** @type {import('./$types').RequestHandler} */
export function GET(event) {
	requireAdmin(event);
	return renderPostGame(true, event.url.searchParams.get('scene') === 'ranking');
}
