import { page } from 'vitest/browser';
import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WinnerBoardGraphic from '../WinnerBoardGraphic.svelte';
import CatalogManager from './CatalogManager.svelte';
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
			iconPath: '/media/catalog-assets/snapshot-1/champions/irelia.png',
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
	test('renders the fixed canvas from controlled player and local catalog URLs', async () => {
		render(WinnerBoardGraphic, { board });

		await expect.element(page.getByText('EarlGreyTeemo', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('Irelia', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('★★★', { exact: true })).toBeInTheDocument();
		const images = [...document.querySelectorAll('img')];
		expect(images.map((image) => image.getAttribute('src'))).toEqual([
			'/media/player-images/player-1',
			'/media/catalog-assets/snapshot-1/champions/irelia.png'
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

describe('catalog manager progress', () => {
	test('shows streamed determinate progress and disables the form until completion', async () => {
		const encoder = new TextEncoder();
		let finish = () => {};
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						`${JSON.stringify({
							type: 'progress',
							phase: 'downloading',
							message: 'Downloading catalog images',
							completed: 1,
							total: 2,
							percent: 50
						})}\n`
					)
				);
				finish = () => {
					controller.enqueue(
						encoder.encode(
							`${JSON.stringify({
								type: 'complete',
								activated: true,
								snapshotId: 'snapshot-1',
								source: 'communitydragon',
								warning: null
							})}\n`
						)
					);
					controller.close();
				};
			}
		});
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(body, {
				headers: { 'Content-Type': 'application/x-ndjson' }
			})
		);
		try {
			render(CatalogManager, {
				tournament: { id: 'tournament-1', name: 'Unitour' },
				activeCatalog: { snapshot: null, champions: [], augments: [] }
			});
			await page.getByRole('button', { name: 'Sync catalog' }).click();
			await expect.element(page.getByText('Downloading catalog images')).toBeInTheDocument();
			await expect.element(page.getByText('50%')).toBeInTheDocument();
			await expect.element(page.getByRole('button', { name: 'Downloading…' })).toBeDisabled();
			finish();
			await expect.element(page.getByRole('button', { name: 'Sync catalog' })).toBeEnabled();
			expect(fetchMock).toHaveBeenCalledWith(
				'/admin/game-resources/sync',
				expect.objectContaining({ method: 'POST' })
			);
		} finally {
			fetchMock.mockRestore();
		}
	});
});
