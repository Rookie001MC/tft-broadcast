import { describe, expect, test } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './index.js';

describe('manual winner graphics schema', () => {
	test('exports every application table', () => {
		const tableNames = /** @type {const} */ ([
			'catalogSnapshots',
			'catalogChampions',
			'catalogAugments',
			'players',
			'tournaments',
			'tournamentPlayers',
			'winnerBoardState',
			'winnerBoardStateChampions',
			'winnerBoardStateAugments',
			'winnerBoardPublications',
			'graphicState',
			'playerImportPreviews',
			'firstOperatorClaim',
			'tftMatchSettings'
		]);

		for (const name of tableNames) expect(schema[name]).toBeDefined();
	});

	test.each([
		['winnerBoardState', schema.winnerBoardState],
		['graphicState', schema.graphicState]
	])('%s uses its singleton id as the primary key', (_name, table) => {
		const id = getTableConfig(table).columns.find((column) => column.name === 'id');

		expect(id).toMatchObject({ primary: true, notNull: true });
	});

	test('defines the required singleton TFT region setting', () => {
		const config = getTableConfig(schema.tftMatchSettings);
		const id = config.columns.find((column) => column.name === 'id');
		const region = config.columns.find((column) => column.name === 'region');
		const updatedAt = config.columns.find((column) => column.name === 'updated_at');

		expect(id).toMatchObject({ primary: true, notNull: true });
		expect(region).toMatchObject({ notNull: true });
		expect(updatedAt).toMatchObject({ notNull: true, dataType: 'date' });
		expect(config.checks.map((constraint) => constraint.name)).toContain(
			'tft_match_settings_singleton_ck'
		);
	});
});
