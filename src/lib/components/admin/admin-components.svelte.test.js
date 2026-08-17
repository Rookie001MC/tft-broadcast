import { page } from 'vitest/browser';
import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import WinnerBoardGraphic from '../WinnerBoardGraphic.svelte';
import CatalogManager from './CatalogManager.svelte';
import PlayerImportPanel from './PlayerImportPanel.svelte';
import WinnerBoardComposer from './WinnerBoardComposer.svelte';

vi.mock('$lib/context/pageMetaContext.js', () => ({
	getPageMetaContext: () => ({ title: undefined, description: undefined })
}));

import GraphicsPage from '../../../routes/(admin)/admin/graphics/+page.svelte';
import PlayersPage from '../../../routes/(admin)/admin/players/+page.svelte';
import TournamentsPage from '../../../routes/(admin)/admin/tournaments/+page.svelte';

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
			riotGameName: 'EarlGreyTeemo',
			riotTagline: 'sip',
			imagePath: null
		}
	],
	activeCatalog: {
		snapshot: { id: 'snapshot-1' },
		champions: [{ id: 'champion-1', displayName: 'Irelia', iconPath: null }],
		augments: []
	},
	savedBoard: composerBoard,
	livePublicationId: 'publication-1',
	tftMatchApi: { enabled: true, region: 'VN2', reason: null }
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
				riotGameName: 'EarlGreyTeemo',
				riotTagline: 'sip',
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
		tftMatchApi: { enabled: true, region: 'VN2', reason: null },
		...overrides
	};
}

function searchableComposerProps() {
	return composerProps({
		activeCatalog: {
			snapshot: { id: 'snapshot-1' },
			champions: [
				{
					id: 'champion-1',
					externalId: 'TFT16_Champion_Irelia',
					displayName: 'Irelia',
					iconPath: null
				},
				{
					id: 'champion-2',
					externalId: 'TFT16_Champion_Ahri',
					displayName: 'Ahri',
					iconPath: null
				},
				{
					id: 'champion-3',
					externalId: 'TFT16_Champion_Leona',
					displayName: 'Leona',
					iconPath: null
				},
				{
					id: 'champion-4',
					externalId: 'TFT16_Champion_Viego',
					displayName: 'Viego',
					iconPath: null
				},
				{
					id: 'champion-helper',
					externalId: 'TFT16_IvernMinion',
					displayName: 'Ivern Minion',
					iconPath: null,
					isExcluded: true
				}
			],
			augments: [
				{
					id: 'augment-1',
					externalId: 'TFT16_Augment_JeweledLotus',
					displayName: 'Jeweled Lotus',
					iconPath: null
				},
				{
					id: 'augment-2',
					externalId: 'TFT16_Augment_CyberneticUplink',
					displayName: 'Cybernetic Uplink',
					iconPath: null
				},
				{
					id: 'augment-3',
					externalId: 'TFT16_Augment_PrismaticPipeline',
					displayName: 'Prismatic Pipeline',
					iconPath: null
				},
				{
					id: 'augment-4',
					externalId: 'TFT16_Augment_PandorasItems',
					displayName: "Pandora's Items",
					iconPath: null
				}
			]
		}
	});
}

function catalogProps() {
	return {
		tournament: { id: 'tournament-1', name: 'Unitour' },
		activeCatalog: {
			snapshot: {
				source: 'communitydragon',
				patchLabel: '16.14',
				setLabel: 'Set 16',
				canonicalSetKey: 'TFT16',
				locale: 'en_us',
				syncedAt: new Date(),
				metadataJson: '{}'
			},
			champions: [
				{
					id: 'champion-irelia',
					externalId: 'TFT16_Champion_Irelia',
					displayName: 'Irelia',
					iconPath: null,
					tier: 4,
					correctionId: null,
					isExcluded: false,
					provenanceJson: '{"source":"upstream"}'
				},
				{
					id: 'champion-hidden',
					externalId: 'TFT16_Champion_Hidden',
					displayName: 'Hidden Champion',
					iconPath: null,
					tier: 2,
					correctionId: 'champion-hidden-correction',
					isExcluded: true,
					provenanceJson: '{"source":"upstream","operation":"exclude"}'
				}
			],
			augments: [
				{
					id: 'augment-lotus',
					externalId: 'TFT16_Augment_JeweledLotus',
					displayName: 'Jeweled Lotus',
					iconPath: null,
					tier: null,
					correctionId: null,
					isExcluded: false,
					provenanceJson: '{"source":"upstream"}'
				},
				{
					id: 'augment-hidden',
					externalId: 'TFT16_Augment_Hidden',
					displayName: 'Hidden Augment',
					iconPath: null,
					tier: null,
					correctionId: 'augment-hidden-correction',
					isExcluded: true,
					provenanceJson: '{"source":"upstream","operation":"exclude"}'
				}
			]
		}
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
		const setAttribute = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(
			/** @this {Element} */ function (name, value) {
				if (this instanceof HTMLImageElement && name === 'src' && value.startsWith('/media/')) {
					requestedSources.set(this, value);
					return originalSetAttribute.call(
						this,
						name,
						'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
					);
				}

				return originalSetAttribute.call(this, name, value);
			}
		);

		try {
			render(WinnerBoardGraphic, { board });

			await expect.element(page.getByText('EarlGreyTeemo', { exact: true })).toBeInTheDocument();
			await expect.element(page.getByText('Irelia', { exact: true })).toBeInTheDocument();
			await expect.element(page.getByText('â˜…â˜…â˜…', { exact: true })).toBeInTheDocument();
			const images = [...document.querySelectorAll('img')];
			expect(images.flatMap((image) => requestedSources.get(image) ?? [])).toEqual([
				'/media/player-images/player-1',
				'/media/catalog-assets/snapshot-1/champions/irelia.png'
			]);
			const frame = document.querySelector('[data-testid="winner-graphic-frame"]');
			expect(getComputedStyle(/** @type {Element} */ (frame)).width).toBe('1920px');
			expect(getComputedStyle(/** @type {Element} */ (frame)).height).toBe('1080px');
			const photoFrame = document.querySelector('.winner-photo');
			const playerImage = photoFrame?.querySelector('img');
			expect(getComputedStyle(/** @type {Element} */ (photoFrame)).overflow).toBe('hidden');
			expect(getComputedStyle(/** @type {Element} */ (playerImage)).objectFit).toBe('cover');
		} finally {
			setAttribute.mockRestore();
		}
	});

	test('renders UUID-scoped publication media without allowing arbitrary media paths', () => {
		const requestedSources = new WeakMap();
		const originalSetAttribute = Element.prototype.setAttribute;
		const setAttribute = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(
			/** @this {Element} */ function (name, value) {
				if (this instanceof HTMLImageElement && name === 'src' && value.startsWith('/media/')) {
					requestedSources.set(this, value);
					return originalSetAttribute.call(
						this,
						name,
						'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
					);
				}

				return originalSetAttribute.call(this, name, value);
			}
		);

		try {
			const publicationRoot =
				'/media/publications/11111111-1111-4111-8111-111111111111';
			render(WinnerBoardGraphic, {
				board: {
					...board,
					winner: { ...board.winner, imagePath: `${publicationRoot}/winner.png` },
					champions: [
						{
							...board.champions[0],
							iconPath: `${publicationRoot}/champion.png`
						}
					],
					augments: [
						{
							...board.augments[0],
							iconPath: '/media/private/operator-secret.png'
						}
					]
				}
			});

			const images = [...document.querySelectorAll('img')];
			expect(images.flatMap((image) => requestedSources.get(image) ?? [])).toEqual([
				`${publicationRoot}/winner.png`,
				`${publicationRoot}/champion.png`
			]);
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

	test('imports an API board into the existing save form without replacing title or augments', async () => {
		const apiBoard = {
			available: true,
			matchId: 'VN2_match-import',
			completedAt: '2026-08-16T01:00:00.000Z',
			placement: 2,
			gameType: 'Ranked',
			setNumber: 15,
			setCoreName: 'K.O. Coliseum',
			champions: [
				{
					catalogChampionId: 'champion-1',
					externalId: 'TFT15_Irelia',
					displayName: 'Irelia',
					iconPath: null,
					starLevel: 1,
					displayOrder: 0
				},
				{
					catalogChampionId: 'champion-1',
					externalId: 'TFT15_Irelia',
					displayName: 'Irelia',
					iconPath: null,
					starLevel: 3,
					displayOrder: 1
				}
			]
		};
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					token: 'preview-token',
					selectedPlayer: {
						id: 'player-2',
						displayName: 'Second Player',
						riotId: 'Second#VN2'
					},
					matches: [apiBoard]
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
		);
		const existingAugment = {
			id: 'augment-1',
			displayName: 'Jeweled Lotus',
			iconPath: null,
			displayOrder: 0
		};
		const importedProps = composerProps({
			roster: [
				...composerProps().roster,
				{
					id: 'player-2',
					displayName: 'Second Player',
					fullName: 'Second Player',
					riotId: 'Second#VN2',
					riotGameName: 'Second',
					riotTagline: 'VN2',
					imagePath: null
				}
			],
			activeCatalog: {
				...composerProps().activeCatalog,
				augments: [existingAugment]
			},
			savedBoard: { ...composerBoard, augments: [existingAugment] }
		});
		const rendered = render(WinnerBoardComposer, importedProps);

		const fetchControl = page.getByRole('button', { name: 'Fetch API Data' });
		const controlRow = document.querySelector('[data-winner-control-row]');
		expect(controlRow?.contains(requiredButton(/^Fetch API Data$/))).toBe(true);
		await fetchControl.click();
		await page.getByRole('button', { name: /Second Player/ }).click();
		await page.getByRole('button', { name: /VN2_match-import/ }).click();
		await page.getByRole('button', { name: 'Use this board' }).click();

		await expect.element(page.getByLabelText('Graphic title')).toHaveValue('Grand Final Winner');
		expect(
			/** @type {HTMLSelectElement} */ (document.querySelector('select[name="winnerPlayerId"]'))
				.value
		).toBe('player-2');
		expect(
			[...document.querySelectorAll('input[name="championIds"]')].map(
				(input) => /** @type {HTMLInputElement} */ (input).value
			)
		).toEqual(['champion-1', 'champion-1']);
		expect(
			[...document.querySelectorAll('input[name="championStarLevels"]')].map(
				(input) => /** @type {HTMLInputElement} */ (input).value
			)
		).toEqual(['1', '3']);
		expect(
			/** @type {HTMLInputElement} */ (document.querySelector('input[name="augmentIds"]')).value
		).toBe('augment-1');
		expect(document.querySelectorAll('input[name="tftPreviewToken"]')).toHaveLength(1);
		expect(document.querySelectorAll('input[name="tftMatchId"]')).toHaveLength(1);
		await expect.element(page.getByText('API board loaded. Review it, then Save.')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Save board' })).toBeEnabled();
		await expect.element(page.getByRole('switch', { name: 'Live graphic' })).toBeDisabled();
		expect(document.activeElement).toBe(document.querySelector('[data-composer-review]'));

		await rendered.rerender({
			...importedProps,
			form: {
				action: 'saveBoard',
				message: 'This TFT match preview expired. Fetch the match again.'
			}
		});
		await expect
			.element(page.getByText('This TFT match preview expired. Fetch the match again.'))
			.toBeVisible();
		expect(document.querySelectorAll('input[name="tftPreviewToken"]')).toHaveLength(1);
		await rendered.rerender({
			...importedProps,
			form: { action: 'saveBoard', message: 'Winner board details are invalid.' }
		});
		expect(document.querySelectorAll('input[name="tftPreviewToken"]')).toHaveLength(1);

		const savedApiBoard = {
			...composerBoard,
			updatedAt: new Date('2026-08-16T02:00:00.000Z'),
			winner: {
				id: 'player-2',
				displayName: 'Second Player',
				riotId: 'Second#VN2',
				imagePath: null
			},
			champions: apiBoard.champions.map((champion) => ({
				id: champion.catalogChampionId,
				displayName: champion.displayName,
				iconPath: null,
				starLevel: champion.starLevel,
				displayOrder: champion.displayOrder
			})),
			augments: [existingAugment]
		};
		await rendered.rerender({
			...importedProps,
			savedBoard: savedApiBoard,
			form: { action: 'saveBoard', board: savedApiBoard }
		});
		expect(document.querySelectorAll('input[name="tftPreviewToken"]')).toHaveLength(0);
		await expect
			.element(page.getByText('API board loaded. Review it, then Save.'))
			.not.toBeInTheDocument();
		await page.getByLabelText('Graphic title').fill('Manual follow-up');
		expect(document.querySelectorAll('input[name="tftPreviewToken"]')).toHaveLength(0);
	});

	test('switches candidate tabs by keyboard and retains independent, type-scoped searches', async () => {
		render(WinnerBoardComposer, searchableComposerProps());

		await expect
			.element(page.getByRole('tablist', { name: 'Graphic asset candidates' }))
			.toBeVisible();
		await page.getByLabelText('Search champions').fill('ahri');
		await expect.element(page.getByText('Ahri', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Jeweled Lotus', { exact: true })).not.toBeInTheDocument();

		const championTab = document.querySelector('[role="tab"][data-value="champions"]');
		expect(championTab).toBeTruthy();
		/** @type {HTMLElement | null} */ (championTab)?.focus();
		championTab?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
		);

		await expect
			.element(page.getByRole('tab', { name: 'Augments (0)' }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.element(page.getByLabelText('Search augments')).toHaveValue('');
		await page.getByLabelText('Search augments').fill('lotus');
		await expect.element(page.getByText('Jeweled Lotus', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Ahri', { exact: true })).not.toBeInTheDocument();

		await page.getByRole('tab', { name: 'Champions (1)' }).click();
		await expect.element(page.getByLabelText('Search champions')).toHaveValue('ahri');
		await expect.element(page.getByText('Ahri', { exact: true })).toBeVisible();
	});

	test('keeps selected units and preview content when filtering available champions', async () => {
		render(WinnerBoardComposer, searchableComposerProps());

		await page.getByRole('button', { name: 'Add Ahri' }).click();
		await page.getByLabelText('Search champions').fill('irelia');
		await expect.element(page.getByRole('button', { name: 'Add Ahri' })).not.toBeInTheDocument();
		await expect
			.element(page.getByRole('region', { name: 'Selected units' }))
			.toHaveTextContent(/Irelia.*Ahri/);
		expect(
			[...document.querySelectorAll('input[name="championIds"]')].map(
				(input) => /** @type {HTMLInputElement} */ (input).value
			)
		).toEqual(['champion-1', 'champion-2']);
		expect(document.querySelector('[data-testid="winner-graphic-frame"]')?.textContent).toContain(
			'Ahri'
		);
	});

	test('separates available and selected assets within each resource tab', async () => {
		render(WinnerBoardComposer, searchableComposerProps());

		await expect.element(page.getByRole('region', { name: 'Available champions' })).toBeVisible();
		await expect
			.element(page.getByRole('region', { name: 'Selected units' }))
			.toHaveTextContent('Irelia');
		await expect.element(page.getByLabelText('Irelia unit 1 star level')).toHaveValue('3');
		await expect.element(page.getByRole('button', { name: 'Add Irelia' })).toBeEnabled();
		await page.getByRole('button', { name: 'Add Viego' }).click();
		await expect.element(page.getByRole('button', { name: 'Remove Viego unit 2' })).toBeVisible();

		await page.getByRole('tab', { name: 'Augments (0)' }).click();
		await expect.element(page.getByRole('region', { name: 'Available augments' })).toBeVisible();
		await expect
			.element(page.getByRole('region', { name: 'Selected augments' }))
			.toHaveTextContent('None selected');
		await page.getByRole('button', { name: "Add Pandora's Items" }).click();
		await expect
			.element(page.getByRole('button', { name: "Remove Pandora's Items" }))
			.toBeVisible();
		await expect.element(page.getByRole('button', { name: "Add Pandora's Items" })).toBeDisabled();
		expect(
			[...document.querySelectorAll('input[name="championIds"]')].map(
				(input) => /** @type {HTMLInputElement} */ (input).value
			)
		).toEqual(['champion-1', 'champion-4']);
		expect(
			[...document.querySelectorAll('input[name="augmentIds"]')].map(
				(input) => /** @type {HTMLInputElement} */ (input).value
			)
		).toEqual(['augment-4']);
	});

	test('adds duplicate unit instances with independent stars and removes only one copy', async () => {
		render(WinnerBoardComposer, searchableComposerProps());

		await page.getByRole('button', { name: 'Add Ahri' }).click();
		await page.getByRole('button', { name: 'Add Ahri' }).click();
		const stars = page.getByLabelText(/Ahri unit \d+ star level/);
		await stars.nth(0).selectOptions('1');
		await stars.nth(1).selectOptions('3');

		expect(
			[...document.querySelectorAll('input[name="championIds"]')].map(
				(input) => /** @type {HTMLInputElement} */ (input).value
			)
		).toEqual(['champion-1', 'champion-2', 'champion-2']);
		expect(
			[...document.querySelectorAll('input[name="championStarLevels"]')].map(
				(input) => /** @type {HTMLInputElement} */ (input).value
			)
		).toEqual(['3', '1', '3']);

		await page.getByRole('button', { name: 'Remove Ahri unit 2' }).click();
		expect(
			document.querySelectorAll('[aria-label^="Ahri unit "][aria-label$=" star level"]')
		).toHaveLength(1);
		await expect.element(page.getByLabelText(/Ahri unit \d+ star level/)).toHaveValue('3');
	});

	test('keeps excluded helper units available for manual selection', async () => {
		render(WinnerBoardComposer, searchableComposerProps());

		await expect.element(page.getByRole('button', { name: 'Add Ivern Minion' })).toBeEnabled();
		await page.getByRole('button', { name: 'Add Ivern Minion' }).click();
		await expect
			.element(page.getByRole('region', { name: 'Selected units' }))
			.toHaveTextContent('Ivern Minion');
	});

	test('allows unlimited champions and keeps selected augments removable at the three-choice limit', async () => {
		render(WinnerBoardComposer, searchableComposerProps());

		for (const champion of ['Ahri', 'Leona', 'Viego', 'Viego']) {
			await page.getByRole('button', { name: `Add ${champion}` }).click();
		}
		await expect.element(page.getByRole('button', { name: 'Add Viego' })).toBeEnabled();

		await page.getByRole('tab', { name: 'Augments (0)' }).click();
		for (const augment of ['Jeweled Lotus', 'Cybernetic Uplink', 'Prismatic Pipeline']) {
			await page.getByRole('button', { name: `Add ${augment}` }).click();
		}

		const fourthAugment = /** @type {HTMLButtonElement} */ (
			document.querySelector('button[aria-label="Add Pandora\'s Items"]')
		);
		expect(fourthAugment.disabled).toBe(true);
		const descriptionId = fourthAugment.getAttribute('aria-describedby');
		expect(descriptionId).toBeTruthy();
		expect(document.getElementById(/** @type {string} */ (descriptionId))?.textContent).toMatch(
			/maximum of three augments/i
		);
		await page.getByRole('button', { name: 'Remove Jeweled Lotus' }).click();
		await expect.element(fourthAugment).toBeEnabled();
	});

	test('disables Live-on when local fields are dirty until Save succeeds', async () => {
		render(WinnerBoardComposer, composerProps());
		await page.getByLabelText('Graphic title').fill('Unsaved local title');

		expect(requiredLiveSwitch().disabled).toBe(true);
		expect(document.body.textContent).toMatch(/save.*before.*live/i);
		expect(requiredButton(/^\s*Save board\s*$/i).disabled).toBe(false);
	});

	test('keeps Live-off available when an already-live board has invalid unsaved edits', async () => {
		render(WinnerBoardComposer, composerProps({ livePublicationId: 'publication-1' }));
		await page.getByLabelText('Graphic title').fill('');

		expect(requiredLiveSwitch().disabled).toBe(false);
		expect(liveIsOn(requiredLiveSwitch())).toBe(true);
		expect(
			/** @type {HTMLInputElement | null} */ (
				document.querySelector('form[action*="/setLive"] input[name="enabled"]')
			)?.value
		).toBe('false');
	});

	test('blocks Live-on when saved catalog IDs cannot produce the exact preview', () => {
		render(
			WinnerBoardComposer,
			composerProps({
				activeCatalog: { snapshot: { id: 'snapshot-2' }, champions: [], augments: [] }
			})
		);

		expect(requiredLiveSwitch().disabled).toBe(true);
		expect(document.body.textContent).toMatch(/complete.*required.*before.*live/i);
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
		expect(requiredLiveSwitch().disabled).toBe(false);
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
		dialog.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(resetButton);
	});

	test('traps keyboard focus inside the reset confirmation dialog', async () => {
		render(WinnerBoardComposer, composerProps());
		requiredButton(/reset/i).click();
		expect(document.querySelector('dialog')).toBeTruthy();
		const cancel = page.getByRole('button', { name: 'Cancel' });
		const confirm = requiredButton(/^\s*Confirm reset\s*$/i);
		confirm.focus();
		confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
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
		render(GraphicsPage, /** @type {any} */ ({ data: graphicsPageData }));

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
		render(GraphicsPage, /** @type {any} */ ({ data: graphicsPageData }));
		const tournament = page.getByLabelText('Tournament scope');

		await tournament.selectOptions('tournament-2');
		const dialog = requiredDialog();
		expect(dialog.textContent).toMatch(/reset/i);
		await page.getByRole('button', { name: /cancel/i }).click();

		await expect.element(tournament).toHaveValue('tournament-1');
		await expect.element(page.getByLabelText('Graphic title')).toHaveValue('Grand Final Winner');
	});

	test('confirming a tournament change requests an atomic reset for the next tournament', async () => {
		render(GraphicsPage, /** @type {any} */ ({ data: graphicsPageData }));
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

	test('offers a native reset-and-select POST fallback while saved state exists', () => {
		render(GraphicsPage, /** @type {any} */ ({ data: graphicsPageData }));
		const selector = /** @type {HTMLSelectElement} */ (
			document.querySelector('select[name="nextTournamentId"]')
		);
		const form = selector?.closest('form');

		expect(selector).toBeTruthy();
		expect(form?.method).toBe('post');
		expect(
			new URL(/** @type {HTMLFormElement} */ (form).action).searchParams.has(
				'/resetAndSelectTournament'
			)
		).toBe(true);
	});

	test.each(['The target tournament is no longer available.', 'Winner board could not be reset.'])(
		'renders the safe native reset-and-select action failure: %s',
		async (message) => {
			render(
				GraphicsPage,
				/** @type {any} */ ({
					data: graphicsPageData,
					form: {
						action: 'resetAndSelectTournament',
						message
					}
				})
			);

			await expect.element(page.getByRole('alert')).toHaveTextContent(message);
		}
	);
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

	test('uses the persisted preview when an enhanced preview result has no expiry authority', () => {
		const persisted = {
			token: 'persisted-token',
			status: 'previewed',
			preview,
			expiresAt: new Date(Date.now() + 60_000)
		};
		render(PlayerImportPanel, {
			form: {
				action: 'previewBundle',
				token: 'action-token',
				preview: {
					...preview,
					rows: [{ ...preview.rows[0], displayName: 'Unauthoritative action row' }]
				}
			},
			importPreview: persisted
		});

		expect(document.body.textContent).toContain('Player A');
		expect(document.body.textContent).not.toContain('Unauthoritative action row');
		expect(
			/** @type {HTMLInputElement} */ (document.querySelector('input[name="token"]')).value
		).toBe('persisted-token');
	});

	test('transitions an active preview to expired at its persisted deadline', async () => {
		vi.useFakeTimers();
		try {
			render(PlayerImportPanel, {
				importPreview: {
					token: 'expiring-token',
					status: 'previewed',
					preview,
					expiresAt: new Date(Date.now() + 1_000)
				}
			});
			expect(requiredButton(/confirm exact preview/i).disabled).toBe(false);

			await vi.advanceTimersByTimeAsync(1_001);
			await tick();

			expect(document.body.textContent).toMatch(/preview expired/i);
			expect(
				[...document.querySelectorAll('button')].some((button) =>
					/confirm exact preview/i.test(button.textContent ?? '')
				)
			).toBe(false);
		} finally {
			vi.useRealTimers();
		}
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

describe('catalog resource tabs', () => {
	test('mounts only the active resource table with accessible tab state and counts', async () => {
		render(CatalogManager, catalogProps());

		await expect
			.element(page.getByRole('tablist', { name: 'Catalog resource type' }))
			.toBeVisible();
		await expect
			.element(page.getByRole('tab', { name: 'Champions (1/2)' }))
			.toHaveAttribute('aria-selected', 'true');
		expect(document.querySelectorAll('table')).toHaveLength(1);
		await expect.element(page.getByText('Irelia', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Jeweled Lotus', { exact: true })).not.toBeInTheDocument();
	});

	test('switches the mounted panel with ArrowRight', async () => {
		render(CatalogManager, catalogProps());
		const championTab = document.querySelector('[role="tab"][data-value="champions"]');
		expect(championTab).toBeTruthy();
		/** @type {HTMLElement | null} */ (championTab)?.focus();
		championTab?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
		);

		await expect
			.element(page.getByRole('tab', { name: 'Augments (1/2)' }))
			.toHaveAttribute('aria-selected', 'true');
		expect(document.querySelectorAll('table')).toHaveLength(1);
		await expect.element(page.getByText('Jeweled Lotus', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Irelia', { exact: true })).not.toBeInTheDocument();
	});

	test('retains separate queries and keeps search scoped to the active resource type', async () => {
		render(CatalogManager, catalogProps());
		await page.getByLabelText('Search champions').fill('lotus');
		await expect.element(page.getByRole('tab', { name: 'Champions (0/2)' })).toBeVisible();
		await expect.element(page.getByText('Jeweled Lotus', { exact: true })).not.toBeInTheDocument();

		await page.getByRole('tab', { name: 'Augments (1/2)' }).click();
		await expect.element(page.getByLabelText('Search augments')).toHaveValue('');
		await page.getByLabelText('Search augments').fill('lotus');
		await expect.element(page.getByText('Jeweled Lotus', { exact: true })).toBeVisible();

		await page.getByRole('tab', { name: 'Champions (0/2)' }).click();
		await expect.element(page.getByLabelText('Search champions')).toHaveValue('lotus');
		await expect.element(page.getByText('Jeweled Lotus', { exact: true })).not.toBeInTheDocument();
	});

	test('reveals excluded resources only for the active type', async () => {
		render(CatalogManager, catalogProps());
		await expect
			.element(page.getByText('Hidden Champion', { exact: true }))
			.not.toBeInTheDocument();
		/** @type {HTMLInputElement | null} */ (
			document
				.querySelector('#champion-catalog-search')
				?.closest('[role="tabpanel"]')
				?.querySelector('input[type="checkbox"]')
		)?.click();
		await expect.element(page.getByText('Hidden Champion', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('tab', { name: 'Champions (2/2)' })).toBeVisible();

		await page.getByRole('tab', { name: 'Augments (1/2)' }).click();
		await expect.element(page.getByText('Hidden Augment', { exact: true })).not.toBeInTheDocument();
		await page.getByLabelText('Show hidden augments').click();
		await expect.element(page.getByText('Hidden Augment', { exact: true })).toBeVisible();
	});
});

describe('operator maintenance surfaces', () => {
	test('edits every player identity field and confirms destructive deletion', async () => {
		render(
			PlayersPage,
			/** @type {any} */ ({
				data: /** @type {any} */ ({
					players: [
						{
							id: 'player-1',
							fullName: 'Earl Grey Teemo',
							displayName: 'EarlGreyTeemo',
							riotId: 'EarlGreyTeemo#sip',
							riotGameName: 'EarlGreyTeemo',
							riotTagline: 'sip',
							imagePath: 'player-images/player-1.png',
							updatedAt: new Date()
						}
					],
					importPreview: null
				})
			})
		);

		for (const name of ['fullName', 'displayName', 'riotId', 'riotGameName', 'riotTagline']) {
			expect(document.querySelector(`form[action*="/updatePlayer"] [name="${name}"]`)).toBeTruthy();
		}
		expect(
			document.querySelector('form[action*="/replacePlayerImage"] input[type="file"]')
		).toBeTruthy();
		expect(document.querySelector('form[action*="/removePlayerImage"]')).toBeTruthy();
		await page.getByRole('button', { name: /delete earlgreyteemo/i }).click();
		expect(requiredDialog().textContent).toMatch(/delete.*permanently/i);
	});

	test('edits tournament name and slug and confirms destructive deletion', async () => {
		const tournament = {
			id: 'tournament-1',
			name: 'Unitour',
			slug: 'unitour',
			activeCatalogSnapshotId: null,
			updatedAt: new Date()
		};
		render(
			TournamentsPage,
			/** @type {any} */ ({
				data: /** @type {any} */ ({
					tournaments: [tournament],
					selectedTournament: tournament,
					players: [],
					roster: []
				})
			})
		);

		expect(document.querySelector('form[action*="/updateTournament"] [name="name"]')).toBeTruthy();
		expect(document.querySelector('form[action*="/updateTournament"] [name="slug"]')).toBeTruthy();
		await page.getByRole('button', { name: /delete unitour/i }).click();
		expect(requiredDialog().textContent).toMatch(/delete.*permanently/i);
	});

	test('shows player reset-required confirmation without claiming deletion completed', () => {
		render(
			PlayersPage,
			/** @type {any} */ ({
				data: {
					players: [
						{
							id: 'player-1',
							fullName: 'Earl Grey Teemo',
							displayName: 'EarlGreyTeemo',
							riotId: 'EarlGreyTeemo#sip',
							riotGameName: 'EarlGreyTeemo',
							riotTagline: 'sip',
							imagePath: null,
							updatedAt: new Date()
						},
						{
							id: 'player-2',
							fullName: 'Earl Grey Teemo',
							displayName: 'EarlGreyTeemo',
							riotId: 'EarlGreyTeemo#two',
							riotGameName: 'EarlGreyTeemo',
							riotTagline: 'two',
							imagePath: null,
							updatedAt: new Date()
						}
					],
					importPreview: null
				},
				form: {
					action: 'deletePlayer',
					playerId: 'player-2',
					result: { kind: 'reset_required', label: 'EarlGreyTeemo' }
				}
			})
		);

		const dialog = requiredDialog();
		expect(dialog.textContent).toMatch(/reset.*delete/i);
		expect(
			/** @type {HTMLInputElement | null} */ (dialog.querySelector('input[name="playerId"]'))?.value
		).toBe('player-2');
		expect(document.body.textContent).not.toContain('Player deleted.');
	});

	test('shows player deletion success only for an actual deleted result', async () => {
		render(
			PlayersPage,
			/** @type {any} */ ({
				data: { players: [], importPreview: null },
				form: { action: 'confirmDeletePlayer', result: { deleted: true, reset: true } }
			})
		);

		await expect.element(page.getByText('Player deleted.', { exact: true })).toBeInTheDocument();
	});

	test('shows tournament reset-required confirmation without claiming deletion completed', () => {
		const tournament = {
			id: 'tournament-1',
			name: 'Unitour',
			slug: 'unitour',
			activeCatalogSnapshotId: null,
			updatedAt: new Date()
		};
		const duplicateTournament = {
			...tournament,
			id: 'tournament-2',
			slug: 'unitour-duplicate'
		};
		render(
			TournamentsPage,
			/** @type {any} */ ({
				data: {
					tournaments: [tournament, duplicateTournament],
					selectedTournament: tournament,
					players: [],
					roster: []
				},
				form: {
					action: 'deleteTournament',
					tournamentId: 'tournament-2',
					result: { kind: 'reset_required', label: 'Unitour' }
				}
			})
		);

		const dialog = requiredDialog();
		expect(dialog.textContent).toMatch(/reset.*delete/i);
		expect(
			/** @type {HTMLInputElement | null} */ (dialog.querySelector('input[name="tournamentId"]'))
				?.value
		).toBe('tournament-2');
		expect(document.body.textContent).not.toContain('Tournament deleted.');
	});

	test('shows tournament deletion success only for an actual deleted result', async () => {
		render(
			TournamentsPage,
			/** @type {any} */ ({
				data: { tournaments: [], selectedTournament: null, players: [], roster: [] },
				form: {
					action: 'confirmDeleteTournament',
					result: { deleted: true, reset: true }
				}
			})
		);

		await expect
			.element(page.getByText('Tournament deleted.', { exact: true }))
			.toBeInTheDocument();
	});

	test('shows catalog provenance, correction controls, placeholders, and reset confirmation', async () => {
		render(CatalogManager, {
			tournament: { id: 'tournament-1', name: 'Unitour' },
			activeCatalog: {
				snapshot: {
					source: 'communitydragon',
					patchLabel: '16.14',
					setLabel: 'Set 16',
					canonicalSetKey: 'TFT16',
					locale: 'en_us',
					syncedAt: new Date(),
					metadataJson: '{}'
				},
				champions: [
					{
						id: 'champion-1',
						externalId: 'manual-champion',
						displayName: 'Manual Champion',
						iconPath: null,
						tier: 3,
						correctionId: 'correction-1',
						isExcluded: false,
						provenanceJson: '{"source":"manual"}'
					},
					{
						id: 'champion-2',
						externalId: 'hidden-champion',
						displayName: 'Hidden Champion',
						iconPath: null,
						tier: 2,
						correctionId: 'correction-2',
						isExcluded: true,
						provenanceJson: '{"source":"upstream","operation":"exclude"}'
					}
				],
				augments: []
			},
			form: {
				action: 'excludeResource',
				resourceKind: 'champion',
				resourceId: 'champion-1',
				result: { kind: 'reset_required', label: 'Manual Champion' }
			}
		});

		expect(
			document.querySelector('form[action*="/createCorrection"] input[type="file"]')
		).toBeTruthy();
		/** @type {HTMLInputElement} */ (document.querySelector('input[type="checkbox"]')).click();
		await tick();
		expect(document.querySelector('form[action*="/updateCorrection"]')).toBeTruthy();
		expect(document.querySelector('form[action*="/excludeResource"]')).toBeTruthy();
		expect(document.querySelector('form[action*="/restoreResource"]')).toBeTruthy();
		expect(document.body.textContent).toMatch(/manual provenance/i);
		expect(document.body.textContent).toMatch(/no image supplied/i);
		expect(requiredDialog().textContent).toMatch(/reset.*saved board/i);
	});

	test('keeps duplicate catalog labels bound to the exact resource ID and kind', () => {
		render(CatalogManager, {
			tournament: { id: 'tournament-1', name: 'Unitour' },
			activeCatalog: {
				snapshot: {
					patchLabel: '16.14',
					canonicalSetKey: 'TFT16',
					locale: 'en_us',
					syncedAt: new Date(),
					metadataJson: '{}'
				},
				champions: [
					{
						id: 'champion-duplicate',
						externalId: 'champion-duplicate',
						displayName: 'Shared Label',
						iconPath: null,
						tier: 2,
						correctionId: null,
						isExcluded: false,
						provenanceJson: '{"source":"upstream"}'
					}
				],
				augments: [
					{
						id: 'augment-exact',
						externalId: 'augment-exact',
						displayName: 'Shared Label',
						iconPath: null,
						tier: null,
						correctionId: null,
						isExcluded: false,
						provenanceJson: '{"source":"upstream"}'
					}
				]
			},
			form: {
				action: 'excludeResource',
				resourceId: 'augment-exact',
				resourceKind: 'augment',
				result: { kind: 'reset_required', label: 'Shared Label' }
			}
		});

		const dialog = requiredDialog();
		expect(
			/** @type {HTMLInputElement | null} */ (dialog.querySelector('input[name="resourceId"]'))
				?.value
		).toBe('augment-exact');
		expect(
			/** @type {HTMLInputElement | null} */ (dialog.querySelector('input[name="resourceKind"]'))
				?.value
		).toBe('augment');
	});

	test('offers create-override forms for ordinary upstream champions and augments', async () => {
		render(CatalogManager, {
			tournament: { id: 'tournament-1', name: 'Unitour' },
			activeCatalog: {
				snapshot: {
					source: 'communitydragon',
					patchLabel: '16.14',
					setLabel: 'Set 16',
					canonicalSetKey: 'TFT16',
					locale: 'en_us',
					syncedAt: new Date(),
					metadataJson: '{}'
				},
				champions: [
					{
						id: 'champion-upstream',
						externalId: 'TFT16_UpstreamChampion',
						displayName: 'Upstream Champion',
						iconPath: '/media/upstream.png',
						tier: 4,
						correctionId: null,
						isExcluded: false,
						provenanceJson: '{"source":"upstream"}'
					}
				],
				augments: [
					{
						id: 'augment-upstream',
						externalId: 'TFT16_UpstreamAugment',
						displayName: 'Upstream Augment',
						iconPath: '/media/upstream-augment.png',
						tier: null,
						correctionId: null,
						isExcluded: false,
						provenanceJson: '{"source":"upstream"}'
					}
				]
			}
		});

		for (const [label, kind, externalId] of [
			['Upstream Champion', 'champion', 'TFT16_UpstreamChampion'],
			['Upstream Augment', 'augment', 'TFT16_UpstreamAugment']
		]) {
			if (kind === 'augment') await page.getByRole('tab', { name: 'Augments (1/1)' }).click();
			const row = [...document.querySelectorAll('tr')].find((candidate) =>
				candidate.textContent?.includes(label)
			);
			const form = row?.querySelector('form[action*="/createCorrection"]');
			expect(form, `${label} override form`).toBeTruthy();
			expect(form?.querySelector('input[name="operation"]')?.getAttribute('value')).toBe(
				'override'
			);
			expect(form?.querySelector('input[name="resourceKind"]')?.getAttribute('value')).toBe(kind);
			expect(form?.querySelector('input[name="targetExternalId"]')?.getAttribute('value')).toBe(
				externalId
			);
		}
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
			await page.getByRole('tab', { name: 'Augments (0/0)' }).click();
			await expect.element(page.getByText('Downloading catalog images')).toBeVisible();
			await expect.element(page.getByRole('button', { name: 'Downloadingâ€¦' })).toBeDisabled();
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
			await expect.element(page.getByRole('button', { name: 'Downloadingâ€¦' })).toBeDisabled();
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