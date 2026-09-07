import { renderPostGame } from '$lib/server/post-game/render.js';
/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
	return renderPostGame(false, url.searchParams.get('scene') === 'ranking');
}
