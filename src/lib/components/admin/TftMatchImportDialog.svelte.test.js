import { page } from 'vitest/browser';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import TftMatchImportDialog from './TftMatchImportDialog.svelte';

const tournament = { id: 'tournament-1', name: 'Finals' };
const roster = [
	{
		id: 'player-1',
		displayName: 'First Player',
		riotId: 'First#VN2',
		riotGameName: 'First',
		riotTagline: 'VN2'
	},
	{
		id: 'player-2',
		displayName: 'Missing Riot ID',
		riotId: null,
		riotGameName: null,
		riotTagline: null
	}
];
const enabled = { enabled: true, region: 'VN2', reason: null };

function props(overrides = {}) {
	return {
		tournament,
		roster,
		apiAvailability: enabled,
		hasActiveCatalog: true,
		onuseboard: vi.fn(),
		...overrides
	};
}

/** @param {Array<any>} matches */
function response(matches) {
	return new Response(
		JSON.stringify({
			token: 'preview-token',
			selectedPlayer: { id: 'player-1', displayName: 'First Player', riotId: 'First#VN2' },
			matches
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

const validMatch = {
	available: true,
	matchId: 'VN2_match-1',
	completedAt: '2026-08-16T01:00:00.000Z',
	placement: 3,
	gameType: 'Ranked',
	setNumber: 15,
	setCoreName: 'K.O. Coliseum',
	champions: [
		{
			catalogChampionId: 'champion-1',
			externalId: 'TFT15_Ahri',
			displayName: 'Ahri',
			iconPath: null,
			starLevel: 2,
			displayOrder: 0
		},
		{
			catalogChampionId: 'champion-1',
			externalId: 'TFT15_Ahri',
			displayName: 'Ahri',
			iconPath: null,
			starLevel: 3,
			displayOrder: 1
		}
	]
};

afterEach(() => vi.restoreAllMocks());

describe('TFT match import dialog', () => {
	test.each([
		[
			'API configuration',
			{
				apiAvailability: {
					enabled: false,
					region: null,
					reason: 'Select a supported TFT platform region in Settings.'
				}
			},
			'Select a supported TFT platform region in Settings.'
		],
		['tournament', { tournament: null }, 'Select a tournament first.'],
		['catalog', { hasActiveCatalog: false }, 'This tournament needs an active catalog.'],
		['roster', { roster: [] }, 'Add players to this tournament roster.']
	])('disables entry for missing %s and exposes the reason', async (_label, override, reason) => {
		render(TftMatchImportDialog, props(override));
		const button = page.getByRole('button', { name: 'Fetch API Data' });
		await expect.element(button).toHaveAttribute('aria-disabled', 'true');
		/** @type {HTMLButtonElement | null} */ (
			document.querySelector('button[aria-disabled="true"]')
		)?.focus();
		await expect.element(page.getByRole('tooltip')).toHaveTextContent(reason);
	});

	test('opens a modal roster in order and keeps incomplete Riot IDs unavailable', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		render(TftMatchImportDialog, props());
		const trigger = page.getByRole('button', { name: 'Fetch API Data' });
		await trigger.click();

		await expect
			.element(page.getByRole('heading', { name: 'Which player do you want to fetch data from?' }))
			.toBeVisible();
		const dialog = document.querySelector('dialog');
		expect(dialog?.open).toBe(true);
		expect(dialog?.className).toContain('h-dvh');
		const playerButtons = [...document.querySelectorAll('[data-roster-player]')];
		expect(playerButtons).toHaveLength(2);
		expect(playerButtons[0].textContent).toContain('First Player');
		expect(playerButtons[1].getAttribute('aria-disabled')).toBe('true');
		/** @type {HTMLButtonElement} */ (playerButtons[1]).focus();
		await expect
			.element(page.getByRole('tooltip'))
			.toHaveTextContent('A complete Riot ID is required.');
		/** @type {HTMLButtonElement} */ (playerButtons[1]).click();
		expect(fetchSpy).not.toHaveBeenCalled();

		await page.getByRole('button', { name: 'Close' }).click();
		expect(document.activeElement).toBe(document.querySelector('button'));
	});

	test('wraps modal focus and restores the trigger after Escape', async () => {
		render(TftMatchImportDialog, props());
		const trigger = /** @type {HTMLButtonElement} */ (document.querySelector('button'));
		trigger.click();
		const dialog = /** @type {HTMLDialogElement} */ (document.querySelector('dialog'));
		const buttons = [...dialog.querySelectorAll('button')];
		const first = buttons[0];
		const last = buttons.at(-1);
		last?.focus();
		last?.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(first);
		first.focus();
		first.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
		);
		expect(document.activeElement).toBe(last);
		dialog.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
		expect(dialog.open).toBe(false);
		expect(document.activeElement).toBe(trigger);
	});

	test('announces loading, limits history to ten rows, and keeps unavailable rows inert', async () => {
		/** @type {(value: Response) => void} */
		let resolveFetch = () => {
			throw new Error('Fetch resolver was not initialized.');
		};
		vi.spyOn(globalThis, 'fetch').mockReturnValue(
			new Promise((resolve) => {
				resolveFetch = resolve;
			})
		);
		render(TftMatchImportDialog, props());
		await page.getByRole('button', { name: 'Fetch API Data' }).click();
		await page.getByRole('button', { name: 'First Player' }).click();
		await expect.element(page.getByRole('status')).toHaveTextContent('Please wait…');
		await expect
			.element(page.getByRole('progressbar', { name: 'Fetching TFT match history' }))
			.toBeVisible();

		const rows = [
			validMatch,
			{ available: false, matchId: 'VN2_bad', reason: 'An unmapped unit was returned.' },
			...Array.from({ length: 10 }, (_, index) => ({
				...validMatch,
				matchId: `VN2_match-${index + 2}`
			}))
		];
		resolveFetch(response(rows));
		await expect.element(page.getByRole('button', { name: /VN2_match-1/ })).toBeVisible();
		expect(document.querySelectorAll('[data-match-row]')).toHaveLength(10);
		const unavailable = page.getByRole('button', { name: /VN2_bad/ });
		await expect.element(unavailable).toHaveAttribute('aria-disabled', 'true');
		/** @type {HTMLButtonElement | null} */ (
			document.querySelector('button[aria-describedby*="match-VN2_bad"]')
		)?.focus();
		await expect
			.element(page.getByRole('tooltip'))
			.toHaveTextContent('An unmapped unit was returned.');
	});

	test('keeps player context on request failure and supports retry', async () => {
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ message: 'Safe Riot failure.' }), {
					status: 503,
					headers: { 'Content-Type': 'application/json' }
				})
			)
			.mockResolvedValueOnce(response([]));
		render(TftMatchImportDialog, props());
		await page.getByRole('button', { name: 'Fetch API Data' }).click();
		await page.getByRole('button', { name: 'First Player' }).click();
		await expect.element(page.getByRole('alert')).toHaveTextContent('Safe Riot failure.');
		await expect.element(page.getByText('First Player', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect.element(page.getByText('No recent matches found.')).toBeVisible();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	test('verifies duplicate units and hands the selected board to the composer without refetching', async () => {
		const onuseboard = vi.fn();
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([validMatch]));
		render(TftMatchImportDialog, props({ onuseboard }));
		await page.getByRole('button', { name: 'Fetch API Data' }).click();
		await page.getByRole('button', { name: 'First Player' }).click();
		await page.getByRole('button', { name: /VN2_match-1/ }).click();

		await expect
			.element(
				page.getByRole('heading', { name: 'Please double-check this is the correct board.' })
			)
			.toBeVisible();
		await expect
			.element(page.getByRole('list', { name: 'Champion board' }).getByRole('listitem'))
			.toHaveLength(2);
		await expect.element(page.getByText('★★', { exact: true })).toBeVisible();
		await expect.element(page.getByText('★★★', { exact: true })).toBeVisible();
		await expect.element(page.getByText(/augment/i)).not.toBeInTheDocument();
		await page.getByRole('button', { name: 'Back' }).click();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		await page.getByRole('button', { name: /VN2_match-1/ }).click();
		await page.getByRole('button', { name: 'Use this board' }).click();

		expect(onuseboard).toHaveBeenCalledWith({
			previewToken: 'preview-token',
			matchId: 'VN2_match-1',
			winnerPlayerId: 'player-1',
			champions: validMatch.champions
		});
		expect(document.querySelector('dialog')?.open).toBe(false);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
