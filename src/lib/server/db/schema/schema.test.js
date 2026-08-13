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
			'tftMatchSnapshots',
			'tftMatchSnapshotParticipants',
			'winnerBoardPublications',
			'graphicState',
			'playerImportPreviews',
			'firstOperatorClaim'
		]);

		for (const name of tableNames) expect(schema[name]).toBeDefined();
	});

	test('defines immutable TFT snapshots, ordered participant boards, and nullable winner provenance', () => {
		const snapshots = getTableConfig(schema.tftMatchSnapshots);
		const participants = getTableConfig(schema.tftMatchSnapshotParticipants);
		const winnerState = getTableConfig(schema.winnerBoardState);

		expect(snapshots.columns.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				'id',
				'tournament_id',
				'riot_match_id',
				'region',
				'queue_id',
				'contract_version',
				'completed_at',
				'fetched_at',
				'saved_at'
			])
		);
		expect(participants.columns.map((column) => column.name)).toEqual(
			expect.arrayContaining(['snapshot_id', 'puuid', 'placement', 'board_json'])
		);
		expect(snapshots.indexes.map((index) => index.config.name)).toEqual(
			expect.arrayContaining([
				'tft_match_snapshots_match_idx',
				'tft_match_snapshots_tournament_idx'
			])
		);

		const source = winnerState.columns.find(
			(column) => column.name === 'source_tft_match_snapshot_id'
		);
		if (!source) throw new Error('Winner source snapshot column was not found');
		expect(source).toMatchObject({ notNull: false });
		const sourceReference = winnerState.foreignKeys.find((foreignKey) => {
			const reference = foreignKey.reference();
			return reference.columns.includes(source);
		});
		expect(sourceReference?.reference()).toMatchObject({
			foreignColumns: [schema.tftMatchSnapshots.id]
		});
		expect(sourceReference?.onDelete).toBe('set null');
	});

	test.each([
		['winnerBoardState', schema.winnerBoardState],
		['graphicState', schema.graphicState]
	])('%s uses its singleton id as the primary key', (_name, table) => {
		const id = getTableConfig(table).columns.find((column) => column.name === 'id');

		expect(id).toMatchObject({ primary: true, notNull: true });
	});
});
