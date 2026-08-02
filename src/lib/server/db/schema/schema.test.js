import { describe, expect, test } from 'vitest';
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
			'winnerBoards',
			'winnerBoardChampions',
			'winnerBoardAugments',
			'graphicState',
			'playerImportPreviews',
			'firstOperatorClaim'
		]);

		for (const name of tableNames) expect(schema[name]).toBeDefined();
	});
});
