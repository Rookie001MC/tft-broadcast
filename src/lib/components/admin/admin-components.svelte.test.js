import { page } from 'vitest/browser';
import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WinnerBoardGraphic from '../WinnerBoardGraphic.svelte';
import CatalogManager from './CatalogManager.svelte';
import LiveControls from './LiveControls.svelte';
import WinnerBoardComposer from './WinnerBoardComposer.svelte';

/** @type {import('$lib/winner-board.js').WinnerBoardStateView} */
const board = {
	id: 'board-1',
	title: 'Grand Final Winner',
	tournamentId: 'tournament-1',
	updatedAt: new Date(),
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

	test('saves one board without draft selection or a client board ID', async () => {
		render(WinnerBoardComposer, {
			tournament: { id: 'tournament-1' },
			roster: [
				{
					id: 'player-1',
					displayName: 'EarlGreyTeemo',
					fullName: 'Earl Grey Teemo',
					riotId: 'EarlGreyTeemo#sip',
					imagePath: 'player-images/managed.png'
				}
			],
			activeCatalog: {
				snapshot: { id: 'snapshot-1' },
				champions: [
					{
						id: 'champion-1',
						displayName: 'Irelia',
						iconPath: '/media/catalog-assets/snapshot-1/champions/irelia.png'
					}
				],
				augments: []
			},
			savedBoard: board
		});

		await expect.element(page.getByLabelText('Graphic title')).toHaveValue('Grand Final Winner');
		await expect.element(page.getByRole('button', { name: 'Save board' })).toBeEnabled();
		await expect.element(page.getByText('Edit saved draft')).not.toBeInTheDocument();
		expect(document.querySelector('input[name="boardId"]')).toBeNull();
	});

	test('takes the saved singleton live without a client-selected target', async () => {
		render(LiveControls, {
			tournamentId: 'tournament-1',
			savedBoard: board,
			livePublicationId: null
		});

		await expect.element(page.getByRole('button', { name: 'Take saved board live' })).toBeEnabled();
		await expect.element(page.getByRole('button', { name: 'Hide live graphic' })).toBeDisabled();
		expect(document.querySelector('input[name="boardId"]')).toBeNull();
		expect(
			document
				.querySelector('form[action="?tournament=tournament-1&/setLive"] input[name="enabled"]')
				?.getAttribute('value')
		).toBe('true');
		expect(
			document.querySelector('form[action="?tournament=tournament-1&/resetBoard"] input')
		).toBeNull();
	});

	test.each(['tournament-1', 'tournament-2'])(
		'preserves selected %s through every native winner-board action',
		async (tournamentId) => {
			const selectedBoard = { ...board, tournamentId };
			render(WinnerBoardComposer, {
				tournament: { id: tournamentId },
				roster: [
					{
						id: 'player-1',
						displayName: 'EarlGreyTeemo',
						fullName: 'Earl Grey Teemo',
						riotId: 'EarlGreyTeemo#sip',
						imagePath: 'player-images/managed.png'
					}
				],
				activeCatalog: {
					snapshot: { id: 'snapshot-1' },
					champions: [
						{
							id: 'champion-1',
							displayName: 'Irelia',
							iconPath: '/media/catalog-assets/snapshot-1/champions/irelia.png'
						}
					],
					augments: []
				},
				savedBoard: selectedBoard
			});
			render(LiveControls, {
				tournamentId,
				savedBoard: selectedBoard,
				livePublicationId: 'publication-1'
			});

			for (const [buttonName, actionName] of [
				['Save board', 'saveBoard'],
				['Take saved board live', 'setLive'],
				['Hide live graphic', 'setLive'],
				['Reset saved board', 'resetBoard']
			]) {
				const button = [...document.querySelectorAll('button')].find((candidate) =>
					candidate.textContent?.includes(buttonName)
				);
				expect(button, `${buttonName} button`).toBeTruthy();
				const target = new URL(/** @type {HTMLButtonElement} */ (button).form?.action ?? '');
				expect(target.searchParams.get('tournament')).toBe(tournamentId);
				expect(target.searchParams.has(`/${actionName}`)).toBe(true);
			}
		}
	);
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

	test('shows indeterminate progress then an actionable error without hiding the active snapshot', async () => {
		const encoder = new TextEncoder();
		let fail = () => {};
		const body = new ReadableStream({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						`${JSON.stringify({
							type: 'progress',
							phase: 'extracting',
							message: 'Extracting the Data Dragon package',
							percent: null
						})}\n`
					)
				);
				fail = () => {
					controller.enqueue(
						encoder.encode(
							`${JSON.stringify({
								type: 'error',
								message:
									'Data Dragon failed during extracting: the package exceeded the configured size limit. The prior snapshot remains active.'
							})}\n`
						)
					);
					controller.close();
				};
			}
		});
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
		try {
			render(CatalogManager, {
				tournament: { id: 'tournament-1', name: 'Unitour' },
				activeCatalog: {
					snapshot: {
						source: 'communitydragon',
						patchLabel: '16.14',
						setLabel: 'Set 16',
						locale: 'en_us',
						syncedAt: new Date(),
						metadataJson: '{}'
					},
					champions: [
						{
							id: 'champion-1',
							externalId: 'TFT16_Ahri',
							displayName: 'Ahri',
							iconPath: null,
							tier: 4
						}
					],
					augments: []
				}
			});
			await page.getByRole('button', { name: 'Sync catalog' }).click();
			await expect
				.element(page.getByText('Extracting the Data Dragon package'))
				.toBeInTheDocument();
			await expect.element(page.getByRole('button', { name: 'Downloading…' })).toBeDisabled();
			fail();
			await expect
				.element(
					page.getByRole('alert').filter({ hasText: 'package exceeded the configured size limit' })
				)
				.toBeInTheDocument();
			await expect.element(page.getByRole('button', { name: 'Sync catalog' })).toBeEnabled();
			await expect.element(page.getByText('Ahri', { exact: true })).toBeInTheDocument();
		} finally {
			fetchMock.mockRestore();
		}
	});
});
