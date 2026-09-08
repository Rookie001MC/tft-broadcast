import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, test } from 'vitest';
import { renderPostGame } from './render.js';

/** @param {boolean} ranking */
async function scene(ranking) {
	const html = await renderPostGame(false, ranking).text();
	/** @type {{ value: string, alpha: number }[]} */
	const calls = [];
	/** @type {number[]} */
	const stack = [];
	const ctx = new Proxy(
		{
			globalAlpha: 1,
			save() {
				stack.push(this.globalAlpha);
			},
			restore() {
				this.globalAlpha = stack.pop() ?? 1;
			},
			/** @param {unknown} value */
			fillText(value) {
				calls.push({ value: String(value), alpha: this.globalAlpha });
			},
			measureText() {
				return { width: 1 };
			},
			createLinearGradient() {
				return { addColorStop() {} };
			}
		},
		{
			get(target, key) {
				return Reflect.get(target, key) ?? (() => {});
			}
		}
	);
	const element = { style: {}, classList: { add() {} }, getContext: () => ctx };
	/** @type {((time: number) => void) | null} */
	let next = null;
	const sandbox = vm.createContext({
		document: { querySelector: () => element, body: element },
		window: {},
		location: { search: '' },
		URLSearchParams,
		performance: { now: () => 0 },
		/** @param {(time: number) => void} callback */
		requestAnimationFrame: (callback) => {
			next = callback;
			return 1;
		},
		cancelAnimationFrame: () => {
			next = null;
		}
	});
	const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
	vm.runInContext(script.slice(0, script.lastIndexOf('if(initial.live){')), sandbox);
	sandbox.fixture = JSON.parse(
		readFileSync(
			new URL('../../../../docs/lcu-tft-eog-stats-example.json', import.meta.url),
			'utf8'
		).replace(/^\uFEFF/, '')
	);
	vm.runInContext('data=fixture;playAnimation()', sandbox);
	return {
		sandbox,
		calls,
		stack,
		/** @param {number} time */
		tick(time) {
			calls.length = 0;
			if (!next) throw new Error('No animation frame scheduled');
			next(time);
		}
	};
}

test.each([false, true])(
	'scene ranking=%s reveals animated elements and ends without a running animation',
	async (ranking) => {
		const s = await scene(ranking);
		if (ranking) expect(s.calls.every((call) => call.alpha === 0)).toBe(true);
		else expect(s.calls.every((call) => call.alpha === 0)).toBe(true);
		s.tick(400);
		expect(s.calls.some((call) => call.alpha > 0)).toBe(true);
		expect(s.calls.some((call) => call.alpha === 0)).toBe(true);
		expect(s.stack).toHaveLength(0);
		s.tick(10000);
		expect(s.calls.every((call) => call.alpha === 1)).toBe(true);
		expect(s.sandbox.window.overlayState.animating).toBe(false);
		expect(s.stack).toHaveLength(0);
	}
);

test('only Ranking has a winner accent that shakes after entry and settles red', async () => {
	const ranking = await scene(true);
	const accent = (/** @type {string} */ time) =>
		vm.runInContext(`rankingWinnerAccent(${time})`, ranking.sandbox);
	expect(accent('560').red).toBe(0);
	expect(accent('560').shake).toBe(0);
	expect(accent('620').red).toBeGreaterThan(0);
	expect(Math.abs(accent('620').shake)).toBeGreaterThan(0);
	expect(accent('980').red).toBe(1);
	expect(accent('980').shake).toBe(0);
	expect(accent('Infinity').shake).toBe(0);
	const postMatch = await scene(false);
	expect(vm.runInContext('typeof rankingWinnerAccent', postMatch.sandbox)).toBe('undefined');
});

test('Post Match shows the number first, then the title, then the player name', async () => {
	const s = await scene(false);
	const winner = [...s.sandbox.fixture.players].sort((a, b) => a.ffaStanding - b.ffaStanding)[0];
	const name = winner.riotIdGameName || winner.summonerName;
	s.tick(750);
	expect(s.calls.some((call) => call.value === 'THỨ NHẤT' && call.alpha > 0)).toBe(true);
	expect(s.calls.some((call) => call.value === name && call.alpha > 0)).toBe(false);
	s.tick(1300);
	expect(s.calls.some((call) => call.value === '1' && call.alpha > 0)).toBe(true);
	expect(s.calls.some((call) => call.value === 'THỨ NHẤT' && call.alpha > 0)).toBe(false);
	s.tick(1600);
	expect(s.calls.some((call) => call.value === name && call.alpha === 1)).toBe(true);
	expect(s.stack).toHaveLength(0);
});

test('Post Match positions four through eight retain their default staggered reveal', async () => {
	const s = await scene(false);
	const names = s.sandbox.fixture.players
		.filter((/** @type {any} */ player) => player.ffaStanding >= 4)
		.map((/** @type {any} */ player) => player.riotIdGameName || player.summonerName);
	for (const time of [0, 400, 1000, 3000]) {
		s.tick(time);
		for (const name of names) {
			expect(s.calls.find((call) => call.value === name)?.alpha).toBe(time === 3000 ? 1 : 0);
		}
	}
});
