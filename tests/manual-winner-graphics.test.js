import { expect, test } from '@playwright/test';
import { createClient } from '@libsql/client';
import { strToU8, zipSync } from 'fflate';

const database = createClient({ url: 'file:test-e2e.db' });

test.setTimeout(90_000);

async function resetDatabase() {
	const tables = [
		'winner_board_augments',
		'winner_board_champions',
		'graphic_state',
		'winner_boards',
		'tournament_players',
		'tournaments',
		'catalog_augments',
		'catalog_champions',
		'catalog_snapshots',
		'player_import_previews',
		'players',
		'session',
		'account',
		'verification',
		'first_operator_claim',
		'user'
	];
	for (const table of tables) await database.execute(`DELETE FROM ${table}`);
}

/** @param {string} tournamentId */
async function seedCatalog(tournamentId) {
	const now = Date.now();
	await database.batch(
		[
			{
				sql: `INSERT INTO catalog_snapshots
					(id, source, source_url, locale, patch_label, set_label, synced_at, is_available, metadata_json)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'e2e-snapshot',
					'communitydragon',
					'https://raw.communitydragon.org/16.15/cdragon/tft/en_us.json',
					'en_us',
					'16.15',
					'Set 16',
					now,
					1,
					'{"warning":null}'
				]
			},
			{
				sql: `INSERT INTO catalog_champions
					(id, catalog_snapshot_id, external_id, display_name, icon_path, tier, metadata_json)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'e2e-champion',
					'e2e-snapshot',
					'TFT16_TestChampion',
					'Test Champion',
					'https://raw.communitydragon.org/16.15/plugins/rcp-be-lol-game-data/global/default/assets/test-champion.png',
					4,
					'{}'
				]
			},
			{
				sql: `INSERT INTO catalog_augments
					(id, catalog_snapshot_id, external_id, display_name, icon_path, tier, metadata_json)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [
					'e2e-augment',
					'e2e-snapshot',
					'TFT16_TestAugment',
					'Test Augment',
					'https://raw.communitydragon.org/16.15/plugins/rcp-be-lol-game-data/global/default/assets/test-augment.png',
					2,
					'{}'
				]
			},
			{
				sql: 'UPDATE tournaments SET active_catalog_snapshot_id = ?, updated_at = ? WHERE id = ?',
				args: ['e2e-snapshot', now, tournamentId]
			}
		],
		'write'
	);
}

test.beforeAll(async () => {
	await resetDatabase();
});

test.afterAll(async () => {
	database.close();
});

test('operator workflow publishes and hides an already-open broadcast source', async ({
	page,
	context,
	request
}) => {
	const anonymous = await request.get('/admin', { maxRedirects: 0 });
	expect(anonymous.status()).toBe(303);
	expect(anonymous.headers().location).toBe('/login?next=%2Fadmin');

	const admin = page;
	await admin.goto('/setup');
	await admin.getByLabel('Operator name').fill('Production Operator');
	await admin.getByLabel('Email').fill('operator@example.com');
	await admin.getByLabel('Password').fill('correct-horse-battery-staple');
	await admin.getByRole('button', { name: 'Create operator account' }).click();
	await expect(admin).toHaveURL(/\/admin$/);

	await admin.getByRole('button', { name: 'Sign out' }).click();
	await expect(admin).toHaveURL(/\/login$/);
	await admin.getByLabel('Email').fill('operator@example.com');
	await admin.getByLabel('Password').fill('correct-horse-battery-staple');
	await admin.getByRole('button', { name: 'Sign in' }).click();
	await expect(admin).toHaveURL(/\/admin$/);

	await admin.getByLabel('New tournament').fill('HCMUSEC TFT Finals');
	await admin.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(admin).toHaveURL(/\/admin\?tournament=/);
	const tournamentId = new URL(admin.url()).searchParams.get('tournament');
	expect(tournamentId).toBeTruthy();

	const bundle = zipSync({
		'players.csv': strToU8(
			'full_name,display_name,riot_id\r\nPlayer One,Player One,PlayerOne#TAG\r\nPlayer Two,Player Two,PlayerTwo#TAG\r\n'
		)
	});
	await admin.getByLabel(/Player bundle/).setInputFiles({
		name: 'players.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(bundle)
	});
	await admin.getByRole('button', { name: 'Preview bundle' }).click();
	await expect(admin.getByText('Ready to commit')).toBeVisible();
	await expect(admin.locator('#imports tbody tr').filter({ hasText: 'Player One' })).toBeVisible();
	await admin.getByRole('button', { name: 'Confirm exact preview' }).click();

	await admin.getByRole('checkbox', { name: /Player One/ }).check();
	await admin.getByRole('checkbox', { name: /Player Two/ }).check();
	await admin.getByRole('button', { name: 'Add selected players' }).click();
	await expect(admin.locator('#roster tbody tr').filter({ hasText: 'Player One' })).toBeVisible();
	await admin.getByRole('button', { name: 'Move down Player One' }).click();
	const rosterRows = admin.locator('#roster tbody tr');
	await expect(rosterRows.nth(0)).toContainText('Player Two');

	await seedCatalog(/** @type {string} */ (tournamentId));
	await admin.reload();
	await expect(admin.getByText('Catalog ready')).toBeVisible();

	const broadcast = await context.newPage();
	await broadcast.goto('/gfx');
	await expect(broadcast.getByLabel('No published winner')).toBeVisible();
	const initialVersion = await request.get('/gfx/version');
	expect(await initialVersion.json()).toEqual({ version: 0 });

	await admin.getByLabel('Graphic title').fill('Grand Final Winner');
	await admin.getByLabel('Select Test Champion').check();
	await admin.getByLabel('Test Champion star level').selectOption('3');
	await admin.getByRole('checkbox', { name: 'Test Augment' }).check();
	await expect(admin.getByText('Grand Final Winner', { exact: true })).toBeVisible();
	await expect(admin.getByText('★★★', { exact: true })).toBeVisible();
	await admin.getByRole('button', { name: 'Save new draft' }).click();
	await expect(admin.getByRole('button', { name: 'Update draft' })).toBeVisible();

	await admin.getByRole('button', { name: 'Publish selected draft' }).click();
	await expect(admin.getByText('Live: Player Two')).toBeVisible();
	await expect(broadcast.getByText('Player Two', { exact: true })).toBeVisible({ timeout: 4000 });
	await expect(broadcast.getByText('Grand Final Winner', { exact: true })).toBeVisible();
	const publishedVersion = await request.get('/gfx/version');
	expect(await publishedVersion.json()).toEqual({ version: 1 });

	await admin.getByRole('button', { name: 'Hide live graphic' }).click();
	await expect(admin.getByText('Transparent', { exact: true })).toBeVisible();
	await expect(broadcast.getByLabel('No published winner')).toBeVisible({ timeout: 4000 });
	await expect(broadcast.getByText('Player Two', { exact: true })).not.toBeVisible();
});
