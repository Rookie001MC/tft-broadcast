import { page } from 'vitest/browser';
import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WinnerBoardGraphic from '../WinnerBoardGraphic.svelte';
import LiveControls from './LiveControls.svelte';

/** @type {import('$lib/winner-board.js').WinnerBoardView} */
const board = {
	id: 'board-1',
	title: 'Grand Final Winner',
	tournamentId: 'tournament-1',
	status: 'draft',
	updatedAt: new Date(),
	publishedAt: null,
	winner: {
		id: 'player-1',
		displayName: 'EarlGreyTeemo',
		riotId: 'EarlGreyTeemo#sip',
		imagePath: 'player-images/managed.png'
	},
	champions: [
		{
			id: 'champion-1',
			displayName: 'Irelia',
			iconPath: 'https://assets.example/irelia.png',
			starLevel: 3,
			displayOrder: 0
		}
	],
	augments: [
		{
			id: 'augment-1',
			displayName: 'Jeweled Lotus',
			iconPath: 'http://unsafe.example/augment.png',
			displayOrder: 0
		}
	]
};

describe('winner graphic components', () => {
	test('renders the fixed canvas from only controlled player and HTTPS catalog URLs', async () => {
		render(WinnerBoardGraphic, { board });

		await expect.element(page.getByText('EarlGreyTeemo', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('Irelia', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('★★★', { exact: true })).toBeInTheDocument();
		const images = [...document.querySelectorAll('img')];
		expect(images.map((image) => image.getAttribute('src'))).toEqual([
			'/media/player-images/player-1',
			'https://assets.example/irelia.png'
		]);
		const frame = document.querySelector('[data-testid="winner-graphic-frame"]');
		expect(getComputedStyle(/** @type {Element} */ (frame)).width).toBe('1920px');
		expect(getComputedStyle(/** @type {Element} */ (frame)).height).toBe('1080px');
	});

	test('renders a transparent semantic empty state without winner content', async () => {
		render(WinnerBoardGraphic, { board: null });

		await expect.element(page.getByLabelText('No published winner')).toBeInTheDocument();
		await expect.element(page.getByText('Tournament result')).not.toBeInTheDocument();
	});

	test('publishes the selected draft through an opaque hidden field', async () => {
		render(LiveControls, { selectedBoardId: 'board-1', liveBoard: null });

		await expect
			.element(page.getByRole('button', { name: 'Publish selected draft' }))
			.toBeEnabled();
		await expect.element(page.getByRole('button', { name: 'Hide live graphic' })).toBeDisabled();
		expect(document.querySelector('input[name="boardId"]')?.getAttribute('value')).toBe('board-1');
		expect(document.querySelector('input[name="boardId"]')?.getAttribute('type')).toBe('hidden');
	});
});
