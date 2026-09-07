import { json } from '@sveltejs/kit';
import { getState, sceneState } from '$lib/server/post-game/store.js';
/** @type {import('./$types').RequestHandler} */
export async function GET({ url, request }) {
	const s = await getState();
	// Older open displays poll without a scene query; use their page URL.
	let requestedScene = url.searchParams.get('scene');
	if (!requestedScene) {
		const referer = request.headers.get('referer');
		if (referer) {
			try {
				const page = new URL(referer);
				if (page.origin === url.origin && page.pathname === '/gfx/post-game') {
					requestedScene = page.searchParams.get('scene');
				}
			} catch {
				/* Ignore malformed Referer headers. */
			}
		}
	}
	const scene = sceneState(s, requestedScene === 'ranking' ? 'ranking' : 'post-match');
	return json(
		{ data: scene.live, visible: scene.visible, revision: s.revision },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
}
