import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { changeState, getState, sceneState } from '$lib/server/post-game/store.js';
/** @param {import('./$types').RequestEvent} event */
export async function load(event) {
	requireAdmin(event);
	const s = await getState();
	return {
		gameId: s.draft?.gameId,
		scenes: Object.fromEntries(
			['post-match', 'ranking'].map((id) => {
				const scene = sceneState(s, id);
				return [id, { visible: scene.visible, liveGameId: scene.live?.gameId }];
			})
		),
		collectorToken: env.EOG_INGEST_TOKEN || ''
	};
}
export const actions = {
	import: async (/** @type {import('./$types').RequestEvent} */ event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const file = form.get('file');
			if (!(file instanceof File) || file.size > 2000000) throw Error('Chọn JSON EOG tối đa 2 MB.');
			await changeState('import', JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
			return { message: 'Đã import. Kiểm tra preview rồi bấm Phát lên OBS.' };
		} catch (e) {
			return fail(400, { message: e instanceof Error ? e.message : 'Import thất bại.' });
		}
	},
	publish: async (/** @type {import('./$types').RequestEvent} */ event) => {
		requireAdmin(event);
		try {
			await changeState('publish', undefined, String((await event.request.formData()).get('scene')));
			return { message: 'Đã phát lên OBS.' };
		} catch {
			return fail(400, { message: 'Hãy import EOG trước.' });
		}
	},
	hide: async (/** @type {import('./$types').RequestEvent} */ event) => {
		requireAdmin(event);
		try {
			await changeState('hide', undefined, String((await event.request.formData()).get('scene')));
			return { message: 'Đã ẩn bảng trên OBS.' };
		} catch {
			return fail(400, { message: 'Scene không hợp lệ.' });
		}
	}
};
