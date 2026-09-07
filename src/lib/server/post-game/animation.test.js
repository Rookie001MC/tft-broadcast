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
		readFileSync(new URL('../../../../docs/lcu-tft-eog-stats-example.json', import.meta.url), 'utf8').replace(
			/^\uFEFF/,
			''
		)
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
	'scene ranking=%s starts hidden and ends without a running animation',
	async (ranking) => {
		const s = await scene(ranking);
		expect(s.calls.every((call) => call.alpha === 0)).toBe(true);
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
