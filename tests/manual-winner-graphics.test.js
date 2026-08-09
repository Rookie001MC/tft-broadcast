import { expect, test } from '@playwright/test';
import { createClient } from '@libsql/client';
import { strToU8, zipSync } from 'fflate';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

test.setTimeout(240_000);

/**
 * @template T
 * @param {(database: import('@libsql/client').Client) => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function withFixtureDatabase(operation) {
	const fixture = createClient({ url: 'file:test-e2e.db' });
	try {
		await fixture.execute('PRAGMA busy_timeout = 5000');
		return await operation(fixture);
	} finally {
		fixture.close();
	}
}

/** @param {import('@libsql/client').Client} database */
async function resetDatabase(database) {
	const tables = [
		'winner_board_state_augments',
		'winner_board_state_champions',
		'graphic_state',
		'winner_board_publications',
		'winner_board_state',
		'tournament_players',
		'tournaments',
		'catalog_augments',
		'catalog_champions',
		'catalog_corrections',
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
	await rm(path.resolve('media/e2e'), { recursive: true, force: true });
}

/** @param {import('@libsql/client').Client} database @param {string} tournamentId */
async function seedCatalog(database, tournamentId) {
	const now = Date.now();
	const championPath = '/media/catalog-assets/e2e-snapshot/champions/e2e-champion.png';
	const augmentPath = '/media/catalog-assets/e2e-snapshot/augments/e2e-augment.png';
	for (const mediaPath of [championPath, augmentPath]) {
		const filename = path.resolve('media/e2e', mediaPath.replace('/media/', ''));
		await mkdir(path.dirname(filename), { recursive: true });
		await writeFile(filename, PNG);
	}
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
					championPath,
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
					augmentPath,
					2,
					'{}'
				]
			},
			...[
				['e2e-augment-two', 'TFT16_TestAugmentTwo', 'Test Augment Two'],
				['e2e-augment-three', 'TFT16_TestAugmentThree', 'Test Augment Three'],
				['e2e-augment-four', 'TFT16_TestAugmentFour', 'Test Augment Four']
			].map(([id, externalId, displayName]) => ({
				sql: `INSERT INTO catalog_augments
					(id, catalog_snapshot_id, external_id, display_name, icon_path, tier, metadata_json)
					VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [id, 'e2e-snapshot', externalId, displayName, null, 2, '{}']
			})),
			{
				sql: 'UPDATE tournaments SET active_catalog_snapshot_id = ?, updated_at = ? WHERE id = ?',
				args: ['e2e-snapshot', now, tournamentId]
			}
		],
		'write'
	);
}

/** @param {import('@libsql/client').Client} database */
async function materializeCatalogCorrections(database) {
	const [manualAdd, championOverride] = await database.batch(
		[
			{
				sql: `INSERT INTO catalog_champions
					(id, catalog_snapshot_id, external_id, display_name, icon_path, tier, metadata_json,
						correction_id, is_excluded, provenance_json)
					SELECT ?, ?, manual_external_id, display_name_override, image_path_override, tier_override,
						?, id, 0, ?
					FROM catalog_corrections
					WHERE patch_label = ? AND resource_kind = ? AND operation = ? AND manual_external_id = ?`,
				args: [
					'e2e-manual-champion',
					'e2e-snapshot',
					'{}',
					'{"source":"manual"}',
					'16.15',
					'champion',
					'add',
					'TFT16_ManualChampion'
				]
			},
			{
				sql: `UPDATE catalog_champions
					SET display_name = (
							SELECT display_name_override FROM catalog_corrections
							WHERE patch_label = ? AND resource_kind = ? AND operation = ?
								AND target_external_id = ?
						),
						correction_id = (
							SELECT id FROM catalog_corrections
							WHERE patch_label = ? AND resource_kind = ? AND operation = ?
								AND target_external_id = ?
						),
						provenance_json = ?
					WHERE catalog_snapshot_id = ? AND external_id = ?
						AND EXISTS (
							SELECT 1 FROM catalog_corrections
							WHERE patch_label = ? AND resource_kind = ? AND operation = ?
								AND target_external_id = ?
						)`,
				args: [
					'16.15',
					'champion',
					'override',
					'TFT16_TestChampion',
					'16.15',
					'champion',
					'override',
					'TFT16_TestChampion',
					'{"source":"upstream","operation":"override"}',
					'e2e-snapshot',
					'TFT16_TestChampion',
					'16.15',
					'champion',
					'override',
					'TFT16_TestChampion'
				]
			}
		],
		'write'
	);
	if (manualAdd.rowsAffected !== 1 || championOverride.rowsAffected !== 1) {
		throw new Error('Expected the UI-created catalog corrections to materialize exactly once');
	}
}

test.beforeAll(() => withFixtureDatabase((database) => resetDatabase(database)));

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

	await admin.getByRole('button', { name: 'User profile' }).click();
	await admin.getByRole('button', { name: 'Sign out' }).click();
	await expect(admin).toHaveURL(/\/login$/);
	await admin.getByLabel('Email').fill('operator@example.com');
	await admin.getByLabel('Password').fill('correct-horse-battery-staple');
	await admin.getByRole('button', { name: 'Sign in' }).click();
	await expect(admin).toHaveURL(/\/admin$/);

	for (const [path, heading] of [
		['/admin', 'Dashboard'],
		['/admin/players', 'Players'],
		['/admin/tournaments', 'Tournaments'],
		['/admin/game-resources', 'Game Resources'],
		['/admin/graphics', 'Graphics'],
		['/admin/settings', 'Settings']
	]) {
		const response = await admin.goto(path);
		expect(response?.ok()).toBe(true);
		await expect(admin.getByRole('heading', { level: 1, name: heading }).last()).toBeVisible();
	}

	await admin.goto('/admin/tournaments');
	await admin.getByLabel('Tournament name').fill('HCMUSEC TFT Finals');
	await admin.getByRole('button', { name: 'Create', exact: true }).click();
	await expect(admin).toHaveURL(/\/admin\/tournaments\?tournament=/);
	const tournamentId = new URL(admin.url()).searchParams.get('tournament');
	expect(tournamentId).toBeTruthy();

	await admin.goto('about:blank');
	await withFixtureDatabase((database) =>
		seedCatalog(database, /** @type {string} */ (tournamentId))
	);
	await admin.goto('/admin/players');
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
	await expect(admin.getByText('Import committed', { exact: true })).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Confirm exact preview' })).toHaveCount(0);
	await admin.reload();
	await expect(admin.getByText('Import committed', { exact: true })).toBeVisible();
	await expect(admin.getByRole('button', { name: 'Confirm exact preview' })).toHaveCount(0);
	const playerOneCard = admin.locator('article').filter({
		has: admin.getByRole('heading', { level: 3, name: 'Player One', exact: true })
	});
	await playerOneCard.getByLabel('Replace image', { exact: true }).setInputFiles({
		name: 'player-one.png',
		mimeType: 'image/png',
		buffer: PNG
	});
	await playerOneCard.getByRole('button', { name: 'Upload' }).click();
	await expect(admin.getByText('Player image replaced.', { exact: true })).toBeVisible();
	await expect(playerOneCard.getByText('Managed image', { exact: true })).toBeVisible();
	await playerOneCard.getByRole('button', { name: 'Remove image' }).click();
	await expect(admin.getByText('Player image removed.', { exact: true })).toBeVisible();
	await expect(playerOneCard.getByText('No image', { exact: true })).toBeVisible();

	await admin.goto(`/admin/tournaments?tournament=${tournamentId}`);
	const tournamentCard = admin.locator('article').filter({
		has: admin.getByRole('heading', { level: 3, name: 'HCMUSEC TFT Finals', exact: true })
	});
	await tournamentCard
		.getByLabel('Tournament name', { exact: true })
		.fill('HCMUSEC TFT Championship');
	await tournamentCard.getByLabel('Slug', { exact: true }).fill('hcmusec-tft-championship');
	await tournamentCard.getByRole('button', { name: 'Save details' }).click();
	await expect(admin.getByText('Tournament details saved.', { exact: true })).toBeVisible();
	await expect(
		admin.getByRole('heading', { level: 3, name: 'HCMUSEC TFT Championship', exact: true })
	).toBeVisible();
	await admin.getByRole('checkbox', { name: /Player One/ }).check();
	await admin.getByRole('checkbox', { name: /Player Two/ }).check();
	await admin.getByRole('button', { name: 'Add selected players' }).click();
	await expect(admin.locator('#roster tbody tr').filter({ hasText: 'Player One' })).toBeVisible();
	await admin.getByRole('button', { name: 'Move down Player One' }).click();
	const rosterRows = admin.locator('#roster tbody tr');
	await expect(rosterRows.nth(0)).toContainText('Player Two');

	await admin.goto(`/admin/game-resources?tournament=${tournamentId}`);
	await expect(admin.getByText('Catalog ready')).toBeVisible();
	await expect(
		admin.locator('tbody tr').filter({ hasText: 'TFT16_TestChampion' }).getByText('Test Champion', {
			exact: true
		})
	).toBeVisible();
	await admin.getByRole('tab', { name: /Augments/ }).click();
	await admin.getByLabel('Search augments').fill('TFT16_TestAugment');
	const augmentCatalog = admin.getByRole('table', { name: 'Augment catalog resources' });
	await expect(augmentCatalog.getByText('Test Augment', { exact: true })).toBeVisible();
	await expect(augmentCatalog.getByText('Test Champion', { exact: true })).toHaveCount(0);

	await admin.goto(`/admin/graphics?tournament=${tournamentId}`);

	const broadcast = await context.newPage();
	await broadcast.goto('/gfx');
	await expect(broadcast.getByLabel('No published winner')).toBeVisible();
	const initialVersion = await request.get('/gfx/version');
	expect(await initialVersion.json()).toEqual({ version: 0 });
	expect(initialVersion.headers().etag).toBe('"gfx-0"');
	const unchangedInitialVersion = await request.get('/gfx/version', {
		headers: { 'If-None-Match': '"gfx-0"' }
	});
	expect(unchangedInitialVersion.status()).toBe(304);

	await admin.getByLabel('Graphic title').fill('Grand Final Winner');
	await admin.getByLabel('Select Test Champion').check();
	await admin.getByLabel('Search champions').fill('does-not-match');
	await expect(admin.getByLabel('Select Test Champion')).toHaveCount(0);
	await expect(admin.getByLabel('Selected champions')).toContainText('Test Champion');
	await expect(
		admin.getByTestId('winner-graphic-frame').getByText('Test Champion', { exact: true })
	).toBeVisible();
	await admin.getByLabel('Search champions').fill('');
	await admin.getByLabel('Test Champion star level').selectOption('3');
	await admin.getByRole('tab', { name: /Augments/ }).click();
	await admin.getByRole('checkbox', { name: 'Test Augment', exact: true }).check();
	await admin.getByRole('checkbox', { name: 'Test Augment Two', exact: true }).check();
	await admin.getByRole('checkbox', { name: 'Test Augment Three', exact: true }).check();
	await expect(
		admin.getByRole('checkbox', { name: 'Test Augment Four', exact: true })
	).toBeDisabled();
	await admin.getByRole('checkbox', { name: 'Test Augment Two', exact: true }).uncheck();
	await expect(
		admin.getByRole('checkbox', { name: 'Test Augment Four', exact: true })
	).toBeEnabled();
	await admin.getByRole('checkbox', { name: 'Test Augment Three', exact: true }).uncheck();
	await expect(admin.getByText('Grand Final Winner', { exact: true })).toBeVisible();
	await expect(admin.getByText('★★★', { exact: true })).toBeVisible();
	const liveSwitch = admin.getByRole('switch', { name: 'Live graphic' });
	await expect(liveSwitch).toBeDisabled();
	await expect(admin.getByText('Save changes before taking the board live.')).toBeVisible();
	await admin.getByRole('button', { name: 'Save board' }).click();
	await expect(admin.getByText('Saved', { exact: true })).toBeVisible();
	await expect(liveSwitch).toBeEnabled();

	await liveSwitch.click();
	await expect(liveSwitch).toHaveAttribute('aria-checked', 'true');
	await expect(admin.getByText('Live', { exact: true })).toBeVisible();
	await expect(broadcast.getByText('Player Two', { exact: true })).toBeVisible({ timeout: 4000 });
	await expect(broadcast.getByText('Grand Final Winner', { exact: true })).toBeVisible();
	const publishedImages = broadcast.locator('img[src^="/media/publications/"]');
	await expect(publishedImages).toHaveCount(2);
	const firstPublicationImages = await publishedImages.evaluateAll((images) =>
		images.flatMap((image) => {
			const source = image.getAttribute('src');
			return source ? [source] : [];
		})
	);
	const firstPublicationIds = [
		...new Set(
			firstPublicationImages.flatMap((imagePath) => {
				const match = imagePath.match(/^\/media\/publications\/([^/]+)\//);
				return match?.[1] ? [match[1]] : [];
			})
		)
	];
	expect(firstPublicationIds).toHaveLength(1);
	const firstPublicationId = /** @type {string} */ (firstPublicationIds[0]);
	const publishedVersion = await request.get('/gfx/version');
	expect(await publishedVersion.json()).toEqual({ version: 1 });
	expect(publishedVersion.headers().etag).toBe('"gfx-1"');

	await admin.goto('/admin/players');
	const playerTwoCard = admin.locator('article').filter({
		has: admin.getByRole('heading', { level: 3, name: 'Player Two', exact: true })
	});
	await playerTwoCard.getByLabel('Full name', { exact: true }).fill('Maintained Player Two');
	await playerTwoCard.getByLabel('Display name', { exact: true }).fill('Player Two Maintained');
	await playerTwoCard.getByLabel('Riot ID', { exact: true }).fill('MaintainedPlayer#NEW');
	await playerTwoCard.getByLabel('Riot game name', { exact: true }).fill('MaintainedPlayer');
	await playerTwoCard.getByLabel('Riot tagline', { exact: true }).fill('NEW');
	await playerTwoCard.getByRole('button', { name: 'Save identity' }).click();
	await expect(admin.getByText('Player details saved.', { exact: true })).toBeVisible();
	const maintainedPlayerCard = admin.locator('article').filter({
		has: admin.getByRole('heading', { level: 3, name: 'Player Two Maintained', exact: true })
	});
	await expect(maintainedPlayerCard.getByText('No image', { exact: true })).toBeVisible();

	await admin.goto(`/admin/game-resources?tournament=${tournamentId}`);
	await expect(admin.getByRole('combobox', { name: 'Resource kind' })).toHaveValue('champion');
	await admin.getByLabel('Manual external ID', { exact: true }).fill('TFT16_ManualChampion');
	await admin.getByLabel('Display name', { exact: true }).fill('Manual Champion');
	const manualAddResponse = admin.waitForResponse(
		(response) =>
			response.url().includes('?/createCorrection') && response.request().method() === 'POST'
	);
	await admin.getByRole('button', { name: 'Add resource' }).click();
	expect((await manualAddResponse).ok()).toBe(true);
	await expect(admin.getByText('Catalog correction saved.', { exact: true })).toBeVisible();

	const championRow = admin.locator('tbody tr').filter({ hasText: 'TFT16_TestChampion' });
	await championRow
		.getByLabel('Override Test Champion name', { exact: true })
		.fill('Corrected Champion');
	const overrideResponse = admin.waitForResponse(
		(response) =>
			response.url().includes('?/createCorrection') && response.request().method() === 'POST'
	);
	await championRow.getByRole('button', { name: 'Create override' }).click();
	expect((await overrideResponse).ok()).toBe(true);
	await expect(admin.getByText('Catalog correction saved.', { exact: true })).toBeVisible();

	await admin.goto('about:blank');
	await withFixtureDatabase((database) => materializeCatalogCorrections(database));
	await admin.goto(`/admin/game-resources?tournament=${tournamentId}`);
	const manualChampionRow = admin.locator('tbody tr').filter({ hasText: 'TFT16_ManualChampion' });
	await expect(manualChampionRow.getByText('Manual Champion', { exact: true })).toBeVisible();
	await expect(manualChampionRow.getByText('No image supplied', { exact: true })).toBeVisible();
	const maintainedChampionRow = admin.locator('tbody tr').filter({
		hasText: 'TFT16_TestChampion'
	});
	await expect(
		maintainedChampionRow.getByText('Corrected Champion', { exact: true })
	).toBeVisible();

	await expect(broadcast.getByText('Player Two', { exact: true })).toBeVisible();
	await expect(broadcast.getByText('Player Two Maintained', { exact: true })).not.toBeVisible();
	await expect(broadcast.getByText('Test Champion', { exact: true })).toBeVisible();
	await expect(broadcast.getByText('Corrected Champion', { exact: true })).not.toBeVisible();

	const freshBroadcast = await context.newPage();
	await freshBroadcast.goto('/gfx');
	await expect(freshBroadcast.getByText('Player Two', { exact: true })).toBeVisible();
	await expect(freshBroadcast.getByText('Test Champion', { exact: true })).toBeVisible();
	await expect(freshBroadcast.getByText('Test Augment', { exact: true })).toBeVisible();
	await expect(
		freshBroadcast.getByText('Player Two Maintained', { exact: true })
	).not.toBeVisible();
	await expect(freshBroadcast.getByText('Corrected Champion', { exact: true })).not.toBeVisible();
	await expect(freshBroadcast.locator('img[src^="/media/publications/"]')).toHaveCount(2);

	await admin.goto(`/admin/graphics?tournament=${tournamentId}`);
	await expect(admin.getByRole('switch', { name: 'Live graphic' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await admin.getByLabel('Graphic title').fill('Championship Winner');
	await admin.getByRole('button', { name: 'Save board' }).click();
	await expect(broadcast.getByText('Championship Winner', { exact: true })).toBeVisible({
		timeout: 4000
	});
	await expect(broadcast.getByText('Player Two Maintained', { exact: true })).toBeVisible();
	await expect(broadcast.getByText('Corrected Champion', { exact: true })).toBeVisible();
	await expect(broadcast.getByText('Test Champion', { exact: true })).not.toBeVisible();
	await expect(freshBroadcast.getByText('Corrected Champion', { exact: true })).toBeVisible();
	await expect(freshBroadcast.getByText('Test Champion', { exact: true })).not.toBeVisible();
	const republishedImages = broadcast.locator('img[src^="/media/publications/"]');
	await expect(republishedImages).toHaveCount(2);
	const secondPublicationImages = await republishedImages.evaluateAll((images) =>
		images.flatMap((image) => {
			const source = image.getAttribute('src');
			return source ? [source] : [];
		})
	);
	expect(secondPublicationImages).not.toEqual(firstPublicationImages);
	const republishedVersion = await request.get('/gfx/version');
	expect(await republishedVersion.json()).toEqual({ version: 2 });
	expect(republishedVersion.headers().etag).toBe('"gfx-2"');
	const originalPublicationPayload = await withFixtureDatabase(async (database) => {
		const result = await database.execute({
			sql: 'SELECT render_payload_json FROM winner_board_publications WHERE id = ?',
			args: [firstPublicationId]
		});
		return JSON.parse(String(result.rows[0]?.render_payload_json));
	});
	expect(originalPublicationPayload).toMatchObject({
		champions: [expect.objectContaining({ displayName: 'Test Champion' })]
	});
	expect(originalPublicationPayload).not.toMatchObject({
		champions: [expect.objectContaining({ displayName: 'Corrected Champion' })]
	});
	for (const imagePath of firstPublicationImages) {
		const immutableAsset = await request.get(imagePath);
		expect(immutableAsset.status()).toBe(200);
		expect(await immutableAsset.body()).toEqual(PNG);
	}

	await admin.goto(`/admin/game-resources?tournament=${tournamentId}`);
	const selectedChampionRow = admin.locator('tbody tr').filter({ hasText: 'TFT16_TestChampion' });
	await selectedChampionRow.getByRole('button', { name: 'Hide' }).click();
	const resetDialog = admin.getByRole('dialog', {
		name: 'Reset saved board before hiding this resource?'
	});
	await expect(resetDialog).toBeVisible();
	await resetDialog.getByRole('button', { name: 'Confirm reset and hide' }).click();
	await expect(admin.getByText('Catalog correction saved.', { exact: true })).toBeVisible();
	await expect(selectedChampionRow.getByText('Hidden', { exact: true })).toBeVisible();
	await selectedChampionRow.getByRole('button', { name: 'Restore' }).click();
	await expect(admin.getByText('Catalog correction saved.', { exact: true })).toBeVisible();
	await expect(selectedChampionRow.getByRole('button', { name: 'Hide' })).toBeVisible();

	await expect(broadcast.getByLabel('No published winner')).toBeVisible({ timeout: 4000 });
	await expect(freshBroadcast.getByLabel('No published winner')).toBeVisible({ timeout: 4000 });
	for (const imagePath of firstPublicationImages) {
		const immutableAsset = await request.get(imagePath);
		expect(immutableAsset.status()).toBe(200);
		expect(await immutableAsset.body()).toEqual(PNG);
	}
	const resetVersion = await request.get('/gfx/version');
	expect(await resetVersion.json()).toEqual({ version: 3 });
});
