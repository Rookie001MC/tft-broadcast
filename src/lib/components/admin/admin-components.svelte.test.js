import { page } from 'vitest/browser';
import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WinnerBoardGraphic from '../WinnerBoardGraphic.svelte';
import CatalogManager from './CatalogManager.svelte';
import PlayerImportPanel from './PlayerImportPanel.svelte';
import WinnerBoardComposer from './WinnerBoardComposer.svelte';

vi.mock('$lib/context/pageMetaContext.js', () => ({
	getPageMetaContext: () => ({ title: undefined, description: undefined })
}));

import GraphicsPage from '../../../routes/(admin)/admin/graphics/+page.svelte';

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

const composerBoard = {
	...board,
	winner: { ...board.winner, imagePath: null },
	champions: board.champions.map((champion) => ({ ...champion, iconPath: null })),
	augments: []
};

const graphicsPageData = {
	tournaments: [
		{ id: 'tournament-1', name: 'Tournament One' },
		{ id: 'tournament-2', name: 'Tournament Two' }
	],
	selectedTournament: { id: 'tournament-1', name: 'Tournament One' },
	roster: [
		{
			id: 'player-1',
			displayName: 'EarlGreyTeemo',
			fullName: 'Earl Grey Teemo',
			riotId: 'EarlGreyTeemo#sip',
			imagePath: null
		}
	],
	activeCatalog: {
		snapshot: { id: 'snapshot-1' },
		champions: [{ id: 'champion-1', displayName: 'Irelia', iconPath: null }],
		augments: []
	},
	savedBoard: composerBoard,
	livePublicationId: 'publication-1'
};

function composerProps(overrides = {}) {
	return {
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
					iconPath: null
				}
			],
			augments: []
		},
		savedBoard: composerBoard,
		livePublicationId: null,
		...overrides
	};
}

/** @param {RegExp} name */
function requiredButton(name) {
	const button = [...document.querySelectorAll('button')].find((candidate) =>
		name.test(candidate.textContent ?? '')
	);
	expect(button, `expected a button named ${name}`).toBeTruthy();
	return /** @type {HTMLButtonElement} */ (button);
}

function requiredLiveSwitch() {
	const control = document.querySelector('[role="switch"], input[type="checkbox"][name="enabled"]');
	expect(control, 'the composer must expose one Live switch').toBeTruthy();
	return /** @type {HTMLInputElement | HTMLButtonElement} */ (control);
}

function requiredDialog() {
	const dialog = document.querySelector('dialog[open], [role="dialog"]');
	expect(dialog, 'the interaction must open a modal confirmation dialog').toBeTruthy();
	return /** @type {HTMLDialogElement | HTMLElement} */ (dialog);
}

/** @param {HTMLInputElement | HTMLButtonElement} control */
function liveIsOn(control) {
	return control instanceof HTMLInputElement
		? control.checked
		: control.getAttribute('aria-checked') === 'true';
}

describe('winner graphic components', () => {
	test('renders the fixed canvas from controlled player and local catalog URLs', async () => {
		const requestedSources = new WeakMap();
		const originalSetAttribute = Element.prototype.setAttribute;
		const setAttribute = vi
			.spyOn(Element.prototype, 'setAttribute')
			.mockImplementation(function (name, value) {
				if (this instanceof HTMLImageElement && name === 'src' && value.startsWith('/media/')) {
					requestedSources.set(this, value);
					return originalSetAttribute.call(
						this,
						name,
						'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
					);
				}

				return originalSetAttribute.call(this, name, value);
			});

		try {
			render(WinnerBoardGraphic, { board });

			await expect.element(page.getByText('EarlGreyTeemo', { exact: true })).toBeInTheDocument();
			await expect.element(page.getByText('Irelia', { exact: true })).toBeInTheDocument();
			await expect.element(page.getByText('★★★', { exact: true })).toBeInTheDocument();
			const images = [...document.querySelectorAll('img')];
			expect(images.map((image) => requestedSources.get(image))).toEqual([
				'/media/player-images/player-1',
				'/media/catalog-assets/snapshot-1/champions/irelia.png'
			]);
			const frame = document.querySelector('[data-testid="winner-graphic-frame"]');
			expect(getComputedStyle(/** @type {Element} */ (frame)).width).toBe('1920px');
			expect(getComputedStyle(/** @type {Element} */ (frame)).height).toBe('1080px');
		} finally {
			setAttribute.mockRestore();
		}
	});

	test('renders a transparent semantic empty state without winner content', async () => {
		render(WinnerBoardGraphic, { board: null });

		await expect.element(page.getByLabelText('No published winner')).toBeInTheDocument();
		await expect.element(page.getByText('Tournament result')).not.toBeInTheDocument();
	});

	test('saves one board without draft selection or a client board ID', async () => {
		render(WinnerBoardComposer, composerProps());

		await expect.element(page.getByLabelText('Graphic title')).toHaveValue('Grand Final Winner');
		await expect.element(page.getByRole('button', { name: 'Save board' })).toBeEnabled();
		await expect.element(page.getByText('Edit saved draft')).not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { name: 'Live controls' }))
			.not.toBeInTheDocument();
		expect(document.querySelector('input[name="boardId"]')).toBeNull();
	});

	test('keeps Save, Live, Reset, and the broadcast link in one composer', async () => {
		render(WinnerBoardComposer, composerProps());

		expect(requiredLiveSwitch().disabled).toBe(false);
		expect(requiredButton(/^\s*Save board\s*$/i).disabled).toBe(false);
		expect(requiredButton(/reset/i).disabled).toBe(false);
		expect(
			[...document.querySelectorAll('a')].some(
				(link) => link.getAttribute('href') === '/gfx' && /open/i.test(link.textContent ?? '')
			)
		).toBe(true);
		expect(document.querySelector('input[name="boardId"]')).toBeNull();
	});

	test('disables Live-on when local fields are dirty until Save succeeds', async () => {
		render(WinnerBoardComposer, composerProps());
		await page.getByLabelText('Graphic title').fill('Unsaved local title');

		expect(requiredLiveSwitch().disabled).toBe(true);
		expect(document.body.textContent).toMatch(/save.*before.*live/i);
		expect(requiredButton(/^\s*Save board\s*$/i).disabled).toBe(false);
	});

	test('uses a successful hidden Save as the canonical baseline without publishing', async () => {
		const rendered = render(WinnerBoardComposer, composerProps({ livePublicationId: null }));
		await page.getByLabelText('Graphic title').fill('Canonical hidden title');
		expect(requiredLiveSwitch().disabled).toBe(true);
		const saved = {
			...composerBoard,
			title: 'Canonical hidden title',
			updatedAt: new Date('2026-08-08T00:01:00.000Z')
		};

		await rendered.rerender(
			composerProps({
				livePublicationId: null,
				form: { action: 'saveBoard', board: saved }
			})
		);

		await expect
			.element(page.getByLabelText('Graphic title'))
			.toHaveValue('Canonical hidden title');
		expect(requiredLiveSwitch().disabled).toBe(false);
		expect(liveIsOn(requiredLiveSwitch())).toBe(false);
		expect(document.body.textContent).toMatch(/\bHidden\b/);
	});

	test('uses a successful live Save as the new baseline and advances the immutable publication', async () => {
		const rendered = render(
			WinnerBoardComposer,
			composerProps({ livePublicationId: 'publication-1' })
		);
		await page.getByLabelText('Graphic title').fill('Canonical live title');
		expect(requiredLiveSwitch().disabled).toBe(true);
		const saved = {
			...composerBoard,
			title: 'Canonical live title',
			updatedAt: new Date('2026-08-08T00:02:00.000Z')
		};

		await rendered.rerender(
			composerProps({
				livePublicationId: 'publication-2',
				form: {
					action: 'saveBoard',
					board: saved,
					previousPublicationId: 'publication-1',
					livePublicationId: 'publication-2'
				}
			})
		);

		await expect.element(page.getByLabelText('Graphic title')).toHaveValue('Canonical live title');
		expect(requiredLiveSwitch().disabled).toBe(false);
		expect(liveIsOn(requiredLiveSwitch())).toBe(true);
		expect(document.body.textContent).toMatch(/\bLive\b/);
	});

	test.each([
		[null, 'Hidden'],
		['publication-1', 'Live']
	])(
		'shows %s publication state while Save retains its deliberate action',
		async (livePublicationId, label) => {
			render(WinnerBoardComposer, composerProps({ livePublicationId }));

			expect(document.body.textContent).toMatch(new RegExp(`\\b${label}\\b`));
			expect(requiredButton(/^\s*Save board\s*$/i).disabled).toBe(false);
		}
	);

	test('labels Reset confirmation and Escape restores the original invoking element', async () => {
		render(WinnerBoardComposer, composerProps({ livePublicationId: 'publication-1' }));
		const resetButton = requiredButton(/reset/i);
		resetButton.focus();
		resetButton.click();
		const dialog = requiredDialog();
		const titleId = dialog.getAttribute('aria-labelledby');
		const descriptionId = dialog.getAttribute('aria-describedby');
		expect(titleId).toBeTruthy();
		expect(descriptionId).toBeTruthy();
		expect(document.getElementById(/** @type {string} */ (titleId))?.textContent).toMatch(/reset/i);
		expect(document.getElementById(/** @type {string} */ (descriptionId))?.textContent).toMatch(
			/hide.*live/i
		);
		expect(document.body.textContent).toMatch(/hide.*live/i);
		await page.getByRole('dialog').press('Escape');
		expect(document.activeElement).toBe(resetButton);
	});

	test('traps keyboard focus inside the reset confirmation dialog', async () => {
		render(WinnerBoardComposer, composerProps());
		requiredButton(/reset/i).click();
		expect(document.querySelector('dialog')).toBeTruthy();
		const cancel = page.getByRole('button', { name: 'Cancel' });
		const confirm = page.getByRole('button', { name: 'Confirm reset' });
		await confirm.press('Tab');
		await expect.element(cancel).toHaveFocus();
	});

	test('prevents duplicate Reset submissions while confirmation is in flight', () => {
		render(WinnerBoardComposer, composerProps());
		requiredButton(/reset/i).click();
		const dialog = requiredDialog();
		const form = dialog.querySelector('form');
		expect(form).toBeTruthy();
		let submissions = 0;
		form?.addEventListener('submit', (event) => {
			event.preventDefault();
			submissions += 1;
		});
		const confirm = requiredButton(/^\s*Confirm reset\s*$/i);

		confirm.click();
		confirm.click();

		expect(submissions).toBe(1);
		expect(confirm.disabled).toBe(true);
	});

	test.each(['tournament-1', 'tournament-2'])(
		'preserves selected %s through every native winner-board action',
		async (tournamentId) => {
			const selectedBoard = { ...composerBoard, tournamentId };
			render(
				WinnerBoardComposer,
				composerProps({
					tournament: { id: tournamentId },
					savedBoard: selectedBoard,
					livePublicationId: 'publication-1'
				})
			);

			for (const actionName of ['saveBoard', 'setLive', 'resetBoard']) {
				const form = [...document.querySelectorAll('form')].find((candidate) => {
					const target = new URL(candidate.action);
					return target.searchParams.has(`/${actionName}`);
				});
				expect(form, `${actionName} form`).toBeTruthy();
				const target = new URL(/** @type {HTMLFormElement} */ (form).action);
				expect(target.searchParams.get('tournament')).toBe(tournamentId);
				expect(target.searchParams.has(`/${actionName}`)).toBe(true);
			}
		}
	);
});

describe('graphics page workflow', () => {
	test('renders one integrated composer without a separate Live controls panel', async () => {
		render(GraphicsPage, { data: graphicsPageData });

		await expect
			.element(page.getByRole('heading', { name: 'Winner board composer' }))
			.toBeInTheDocument();
		expect(
			[...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].some(
				(heading) => heading.textContent?.trim() === 'Live controls'
			)
		).toBe(false);
		expect(requiredLiveSwitch()).toBeTruthy();
	});

	test('cancelling a tournament change preserves the selected tournament and local board', async () => {
		render(GraphicsPage, { data: graphicsPageData });
		const tournament = page.getByLabelText('Tournament scope');

		await tournament.selectOptions('tournament-2');
		const dialog = requiredDialog();
		expect(dialog.textContent).toMatch(/reset/i);
		await page.getByRole('button', { name: /cancel/i }).click();

		await expect.element(tournament).toHaveValue('tournament-1');
		await expect.element(page.getByLabelText('Graphic title')).toHaveValue('Grand Final Winner');
	});

	test('confirming a tournament change requests an atomic reset for the next tournament', async () => {
		render(GraphicsPage, { data: graphicsPageData });
		await page.getByLabelText('Tournament scope').selectOptions('tournament-2');
		const dialog = requiredDialog();
		const form = dialog.querySelector('form');
		expect(form).toBeTruthy();
		expect(
			new URL(/** @type {HTMLFormElement} */ (form).action).searchParams.has('/resetBoard')
		).toBe(true);
		expect(
			/** @type {HTMLInputElement | null} */ (form?.querySelector('input[name="nextTournamentId"]'))
				?.value
		).toBe('tournament-2');
	});
});

describe('persisted import status', () => {
	const preview = {
		canCommit: true,
		rows: [
			{
				rowNumber: 2,
				displayName: 'Player A',
				fullName: 'Player A',
				riotId: 'PlayerA#TAG',
				action: 'create',
				image: null
			}
		],
		errors: [],
		unmatchedImages: []
	};
	const committed = {
		token: 'committed-token',
		status: 'committed',
		preview,
		expiresAt: new Date(Date.now() + 60_000),
		committedAt: new Date('2026-08-08T00:00:00.000Z'),
		summary: { created: 1, updated: 0, skipped: 0 }
	};

	test('does not restore confirmation from a commit form response during rerender', async () => {
		render(PlayerImportPanel, {
			form: { action: 'commitBundle', ...committed },
			importPreview: committed
		});

		expect(document.body.textContent).toMatch(/committed/i);
		expect(
			[...document.querySelectorAll('button')].some((button) =>
				/confirm exact preview/i.test(button.textContent ?? '')
			)
		).toBe(false);
	});

	test('keeps confirmation unavailable after a committed preview is loaded again', async () => {
		render(PlayerImportPanel, { importPreview: committed });

		expect(document.body.textContent).toMatch(/1 created/i);
		expect(
			[...document.querySelectorAll('button')].some((button) =>
				/confirm exact preview/i.test(button.textContent ?? '')
			)
		).toBe(false);
	});

	test.each([
		[{ ...committed, status: 'expired' }, /expired/i],
		[{ ...committed, status: 'unavailable' }, /unavailable/i]
	])('requires a new preview for terminal %s state', async (importPreview, message) => {
		render(PlayerImportPanel, { importPreview });

		expect(document.body.textContent).toMatch(message);
		expect(
			[...document.querySelectorAll('button')].some((button) =>
				/confirm exact preview/i.test(button.textContent ?? '')
			)
		).toBe(false);
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
