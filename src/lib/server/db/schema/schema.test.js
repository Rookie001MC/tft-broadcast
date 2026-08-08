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
			'firstOperatorClaim'
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
});
