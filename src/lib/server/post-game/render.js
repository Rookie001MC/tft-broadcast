import template from './overlay.txt?raw';
import catalog from './catalog.json';
import rankingDraw from './ranking.txt?raw';
/** @param {boolean} preview
 * @param {boolean} ranking
 */
export function renderPostGame(preview, ranking = false) {
	const endpoint = preview
		? '/admin/post-game/state'
		: `/gfx/post-game/state?scene=${ranking ? 'ranking' : 'post-match'}`;
	const html = ranking
		? template.replace(
				'function draw(){',
				`${rankingDraw}\nfunction draw(){\n drawRanking();return;`
			)
		: template;
	return new Response(
		html
			.replace(
				'/*__PAYLOAD__*/',
				JSON.stringify({
					data: { players: [] },
					assets: {},
					catalog,
					live: true,
					ranking
				}).replaceAll('<', '\\u003c')
			)
			.replace("fetch('/api/state')", `fetch('${endpoint}')`),
		{ headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
	);
}
