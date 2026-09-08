import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

test('publishes and hides each scene independently and preserves its live data', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'post-game-scenes-'));
	vi.doMock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: root } }));
	try {
		const { changeState, getState, sceneState } = await import('./store.js');
		const data = {
			gameId: 1,
			players: Array.from({ length: 8 }, (_, i) => ({
				ffaStanding: i + 1,
				summonerName: `Player${i}`,
				boardPieces: []
			}))
		};
		await changeState('import', data);
		await changeState('publish', undefined, 'ranking');
		let state = await getState();
		expect(sceneState(state, 'ranking').visible).toBe(true);
		expect(sceneState(state, 'post-match').visible).toBe(false);
		await changeState('import', { ...data, gameId: 2 });
		await changeState('publish', undefined, 'post-match');
		state = await getState();
		expect(sceneState(state, 'ranking').live.gameId).toBe(1);
		expect(sceneState(state, 'post-match').live.gameId).toBe(2);
		const augments = [0, 1, 2, 3].map((id) => ({
			id: String(id),
			icon: `/media/catalog-assets/test/${id}.png`
		}));
		await changeState('augments', { gameId: 2, augments });
		state = await getState();
		expect(state.draft.players[0].augments).toHaveLength(4);
		expect(sceneState(state, 'ranking').live.players[0].augments).toBeUndefined();
		await changeState('publish', undefined, 'ranking');
		state = await getState();
		expect(sceneState(state, 'ranking').live.players[0].augments).toHaveLength(4);
		expect(sceneState(state, 'post-match').live.players[0].augments).toBeUndefined();
		await changeState('hide', undefined, 'ranking');
		state = await getState();
		expect(sceneState(state, 'ranking').visible).toBe(false);
		expect(sceneState(state, 'post-match').visible).toBe(true);
	} finally {
		vi.doUnmock('$env/dynamic/private');
		await rm(root, { recursive: true, force: true });
	}
});
