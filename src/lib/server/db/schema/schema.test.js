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
			'tftMatchSettings',
			'tftMatchSnapshots'
		]);

		for (const name of tableNames) expect(schema[name]).toBeDefined();
	});

	test('defines immutable TFT match snapshot columns and indexes', () => {
		const config = getTableConfig(schema.tftMatchSnapshots);
		const requiredColumns = [
			'id',
			'riot_match_id',
			'region',
			'tournament_id',
			'selected_player_id',
			'active_catalog_snapshot_id',
			'contract_version',
			'payload_json',
			'fetched_at',
			'saved_at'
		];

		expect(config.columns.find((column) => column.name === 'id')).toMatchObject({
			primary: true,
			notNull: true
		});
		for (const name of requiredColumns) {
			expect(config.columns.find((column) => column.name === name)).toMatchObject({
				notNull: true
			});
		}
		for (const name of ['fetched_at', 'saved_at']) {
			expect(config.columns.find((column) => column.name === name)).toMatchObject({
				dataType: 'date'
			});
		}
		expect(config.indexes.map((index) => index.config.name)).toEqual(
			expect.arrayContaining([
				'tft_match_snapshots_match_idx',
				'tft_match_snapshots_tournament_idx'
			])
		);
	});

	test('links editable Winner state to an optional snapshot with set-null deletion', () => {
		const config = getTableConfig(schema.winnerBoardState);
		const sourceColumn = config.columns.find(
			(column) => column.name === 'source_tft_match_snapshot_id'
		);
		const foreignKey = config.foreignKeys.find((key) =>
			key.reference().columns.some((column) => column.name === 'source_tft_match_snapshot_id')
		);

		expect(sourceColumn).toMatchObject({ notNull: false });
		expect(foreignKey?.reference().foreignColumns[0].name).toBe('id');
		expect(foreignKey?.onDelete).toBe('set null');
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
