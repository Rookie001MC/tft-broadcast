import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { changeState, getState, sceneState } from '$lib/server/post-game/store.js';
import { db } from '$lib/server/db';
import { catalogAugments, catalogSnapshots } from '$lib/server/db/schema/catalog.js';
import { and, eq } from 'drizzle-orm';

async function augmentOptions() {
	return db
		.select({
			id: catalogAugments.id,
			name: catalogAugments.displayName,
			icon: catalogAugments.iconPath,
			patch: catalogSnapshots.patchLabel
		})
		.from(catalogAugments)
		.innerJoin(catalogSnapshots, eq(catalogAugments.catalogSnapshotId, catalogSnapshots.id))
		.where(and(eq(catalogSnapshots.isAvailable, true), eq(catalogAugments.isExcluded, false)))
		.orderBy(catalogAugments.displayName);
}
/** @param {import('./$types').RequestEvent} event */
export async function load(event) {
	requireAdmin(event);
	const s = await getState();
	return {
		gameId: s.draft?.gameId,
		augmentOptions: await augmentOptions(),
		selectedAugments:
			[...(s.draft?.players || [])]
				.sort((a, b) => a.ffaStanding - b.ffaStanding)[0]
				?.augments?.map((/** @type {any} */ a) => a?.id || '') || [],
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
	augments: async (/** @type {import('./$types').RequestEvent} */ event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const options = await augmentOptions();
			const count = Number(form.get('augmentCount'));
			if (count !== 3 && count !== 4) throw Error('Chọn 3 hoặc 4 lõi.');
			const augments = Array.from({ length: count }, (_, i) => {
				const id = String(form.get(`augment${i}`) || '');
				if (!id) return null;
				const option = options.find((a) => a.id === id);
				if (!option?.icon) throw Error('Lõi không có ảnh hoặc không còn trong snapshot.');
				return { id: option.id, name: option.name, icon: option.icon };
			});
			await changeState('augments', { gameId: Number(form.get('gameId')), augments });
			return { message: 'Đã lưu lõi vào preview. Phát Ranking để cập nhật OBS.' };
		} catch (e) {
			return fail(400, { message: e instanceof Error ? e.message : 'Không lưu được lõi.' });
		}
	},
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
			await changeState(
				'publish',
				undefined,
				String((await event.request.formData()).get('scene'))
			);
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
