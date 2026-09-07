import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';

/** @param {any} data */
export function validateEog(data) {
	if (
		!data ||
		!Number.isSafeInteger(data.gameId) ||
		!Array.isArray(data.players) ||
		data.players.length !== 8
	)
		throw Error('JSON EOG cần gameId và đủ 8 người chơi.');
	const ranks = new Set();
	for (const p of data.players) {
		if (
			!p ||
			!Number.isInteger(p.ffaStanding) ||
			p.ffaStanding < 1 ||
			p.ffaStanding > 8 ||
			ranks.has(p.ffaStanding)
		)
			throw Error('Thứ hạng phải đủ từ 1 đến 8, không trùng.');
		ranks.add(p.ffaStanding);
		if (
			typeof (p.riotIdGameName || p.summonerName) !== 'string' ||
			!Array.isArray(p.boardPieces) ||
			p.boardPieces.length > 30
		)
			throw Error('Tên hoặc đội hình không hợp lệ.');
		for (const u of p.boardPieces) {
			if (
				!u ||
				typeof u.icon !== 'string' ||
				!Array.isArray(u.items) ||
				u.items.length > 10 ||
				!u.items.every((/** @type {any} */ i) => i && typeof i.icon === 'string')
			)
				throw Error('Tướng hoặc trang bị không hợp lệ.');
		}
	}
	return data;
}

const file = path.resolve(env.MEDIA_ROOT || 'media', 'post-game/state.json');
let queue = Promise.resolve();
export async function getState() {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch (e) {
		if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
		return { draft: null, live: null, visible: false, revision: 0 };
	}
}
/** @param {any} state @param {string} scene */
export function sceneState(state, scene) {
	return state.scenes?.[scene] ?? { live: state.live, visible: state.visible };
}
/** @param {'import'|'publish'|'hide'} action @param {any} [data] @param {string} [scene] */
export function changeState(action, data, scene = 'post-match') {
	if (!['post-match', 'ranking'].includes(scene)) throw Error('Unknown scene');
	const task = queue.then(async () => {
		const s = await getState();
		s.scenes ??= { 'post-match': sceneState(s, 'post-match'), ranking: sceneState(s, 'ranking') };
		if (action === 'import') s.draft = validateEog(data);
		if (action === 'publish') {
			if (!s.draft) throw Error('Hãy import EOG trước.');
			s.scenes[scene] = { live: s.draft, visible: true };
		}
		if (action === 'hide') s.scenes[scene].visible = false;
		s.revision += 1;
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file + '.tmp', JSON.stringify(s));
		await rename(file + '.tmp', file);
	});
	queue = task.catch(() => {});
	return task;
}
