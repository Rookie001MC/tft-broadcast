import { page } from 'vitest/browser';
import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

vi.mock('$lib/context/pageMetaContext.js', () => ({
	getPageMetaContext: () => ({ title: undefined, description: undefined })
}));

import SettingsPage from './+page.svelte';

const now = new Date('2026-08-16T04:00:00.000Z');
const data = {
	user: {
		id: 'operator-1',
		name: 'Operator One',
		email: 'operator@example.com',
		emailVerified: true,
		createdAt: now,
		updatedAt: now
	},
	tftMatchSettings: { region: 'VN2' },
	tftPlatformRegionOptions: [
		{ value: 'EUN1', label: 'EU East (EUN1)' },
		{ value: 'VN2', label: 'Vietnam (VN2)' }
	]
};

describe('Settings page', () => {
	test('renders the server-derived TFT region form and preserves account controls', async () => {
		render(SettingsPage, /** @type {any} */ ({ data, form: null }));

		const select = page.getByLabelText('TFT platform region');
		await expect.element(select).toHaveValue('VN2');
		await expect.element(select.getByRole('option')).toHaveLength(2);
		await expect.element(page.getByRole('button', { name: 'Save region' })).toBeVisible();
		await expect.element(page.getByText('Operator One')).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

		const form = document.querySelector('form[action="?/saveTftRegion"]');
		expect(form).not.toBeNull();
	});

	test('shows only the matching action error', async () => {
		render(
			SettingsPage,
			/** @type {any} */ ({
				data,
				form: { action: 'saveTftRegion', message: 'Choose a supported TFT platform region.' }
			})
		);

		await expect.element(page.getByText('Choose a supported TFT platform region.')).toBeVisible();
	});
});
