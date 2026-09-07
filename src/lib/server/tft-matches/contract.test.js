import { readFile } from 'node:fs/promises';

import { describe, expect, test } from 'vitest';

import {
	CANONICAL_TFT_MATCH_CONTRACT_VERSION,
	TftMatchContractError,
	normalizeTftMatch,
	parseCanonicalTftMatchSnapshot,
	previewRowFromSnapshot
} from './contract.js';

/**
 * @typedef {{ character_id: string, tier: number, [key: string]: unknown }} FixtureUnit
 * @typedef {{
 *   puuid: string,
 *   placement: number,
 *   level: number,
 *   units: FixtureUnit[],
 *   riotIdGameName?: string,
 *   riotIdTagline?: string,
 *   win?: boolean,
 *   [key: string]: unknown
 * }} FixtureParticipant
 * @typedef {{
 *   metadata: { data_version: string, match_id: string, [key: string]: unknown },
 *   info: {
 *     participants: FixtureParticipant[],
 *     endOfGameResult?: string,
 *     game_datetime: number,
 *     game_length: number,
 *     game_version: string,
 *     queueId?: number,
 *     queue_id?: number,
 *     tft_game_type: string,
 *     tft_set_core_name: string,
 *     tft_set_number: number,
 *     [key: string]: unknown
 *   },
 *   [key: string]: unknown
 * }} FixturePayload
 */

const fixtureText = await readFile(
	new URL('../../../../examples/tft-match-v1.example.jsonc', import.meta.url),
	'utf8'
);
const fixture = /** @type {FixturePayload} */ (
	JSON.parse(
		fixtureText
			.split(/\r?\n/)
			.filter((line, index, lines) => {
				if (!line.startsWith('//')) return true;
				return lines.slice(0, index).some((prior) => !prior.startsWith('//'));
			})
			.join('\n')
	)
);

/** @template T @param {T | undefined} value @returns {T} */
function requireValue(value) {
	if (value === undefined) throw new Error('Fixture value is required');
	return value;
}

const placementFour = requireValue(
	fixture.info.participants.find((participant) => participant.placement === 4)
);
const requestedMatchId = fixture.metadata.match_id;
const fetchedAt = '2026-08-16T03:00:00.000Z';
const region = 'NA1';

function cloneFixture() {
	return structuredClone(fixture);
}

function makeCatalog(payload = fixture) {
	const externalIds = [
		...new Set(
			payload.info.participants.flatMap((participant) =>
				participant.units.map((unit) => unit.character_id)
			)
		)
	];

	return externalIds.map((externalId, index) => ({
		id: `champion-${index + 1}`,
		externalId,
		displayName: externalId.replace(/^TFT17_/, ''),
		iconPath: index % 2 === 0 ? `/catalog/${externalId}.png` : null,
		isExcluded: externalId === 'TFT17_IvernMinion' || externalId === 'TFT17_Summon'
	}));
}

function normalize(overrides = {}) {
	return normalizeTftMatch({
		payload: fixture,
		requestedMatchId,
		selectedPuuid: placementFour.puuid,
		region,
		catalogChampions: makeCatalog(),
		fetchedAt,
		...overrides
	});
}

describe('normalizeTftMatch', () => {
	test('normalizes the real response to the strict champion-only contract', () => {
		const snapshot = normalize();

		expect(snapshot.contractVersion).toBe(CANONICAL_TFT_MATCH_CONTRACT_VERSION);
		expect(snapshot).not.toHaveProperty('augments');
		expect(snapshot.source).toEqual({
			provider: 'riot',
			region,
			matchId: requestedMatchId,
			dataVersion: fixture.metadata.data_version,
			fetchedAt
		});
		expect(snapshot.match.queueId).toBe(fixture.info.queueId);
		expect(snapshot.participants).toHaveLength(8);
		expect(snapshot.participants.map((participant) => participant.placement)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8
		]);
	});

	test('accepts unknown raw fields and responses without augments', () => {
		const payload = cloneFixture();
		payload.unknownTopLevel = { retainedNowhere: true };
		payload.info.unknownInfoField = true;
		payload.info.participants[0].unknownParticipantField = true;
		payload.info.participants[0].units[0].unknownUnitField = true;
		for (const participant of payload.info.participants) delete participant.augments;

		expect(() => normalize({ payload })).not.toThrow();
	});

	test.each(['queueId', 'queue_id'])('accepts %s as the queue field', (queueField) => {
		const payload = cloneFixture();
		const expected = payload.info[queueField];
		delete payload.info[queueField === 'queueId' ? 'queue_id' : 'queueId'];

		expect(normalize({ payload }).match.queueId).toBe(expected);
	});

	test('accepts an absent completion marker and rejects a non-complete match', () => {
		const payload = cloneFixture();
		delete payload.info.endOfGameResult;
		expect(() => normalize({ payload })).not.toThrow();

		payload.info.endOfGameResult = 'Abort_Unexpected';
		expect(() => normalize({ payload })).toThrow(TftMatchContractError);
	});

	test.each([
		{},
		{ riotIdGameName: '' },
		{ riotIdGameName: 'Only name' },
		{ riotIdTagline: 'ONLYTAG' }
	])('normalizes a missing, blank, or partial Riot ID pair to null', (riotIdFields) => {
		const payload = cloneFixture();
		const participant = payload.info.participants[0];
		delete participant.riotIdGameName;
		delete participant.riotIdTagline;
		Object.assign(participant, riotIdFields);

		const normalized = normalize({ payload });
		expect(
			normalized.participants.find((row) => row.puuid === participant.puuid)?.riotId
		).toBeNull();
	});

	test('uses placement and preserves ordered duplicate and excluded unit instances', () => {
		const payload = cloneFixture();
		payload.info.participants.forEach((participant) => {
			participant.win = participant.placement !== 4;
		});
		const participant = requireValue(payload.info.participants.find((row) => row.placement === 4));
		participant.units.splice(1, 0, structuredClone(participant.units[0]));
		participant.units.push({ character_id: 'TFT17_IvernMinion', tier: 1 });

		const snapshot = normalize({ payload, catalogChampions: makeCatalog(payload) });
		const selected = requireValue(snapshot.participants.find((row) => row.placement === 4));

		expect(selected.puuid).toBe(placementFour.puuid);
		expect(selected.champions.map((champion) => champion.displayOrder)).toEqual(
			selected.champions.map((_, index) => index)
		);
		expect(selected.champions.slice(0, 2).map((champion) => champion.externalId)).toEqual([
			participant.units[0].character_id,
			participant.units[0].character_id
		]);
		expect(selected.champions.at(-1)).toMatchObject({
			externalId: 'TFT17_IvernMinion',
			starLevel: 1
		});
	});

	test('rejects a response for a different match ID', () => {
		expect(() => normalize({ requestedMatchId: 'NA1_different' })).toThrow(TftMatchContractError);
	});

	/** @type {Array<[string, (payload: FixturePayload) => unknown]>} */
	const invalidPayloads = [
		[
			'duplicate PUUID',
			(payload) => (payload.info.participants[1].puuid = payload.info.participants[0].puuid)
		],
		['empty PUUID', (payload) => (payload.info.participants[0].puuid = '')],
		['incomplete placements', (payload) => (payload.info.participants[0].placement = 3)],
		['invalid tier', (payload) => (payload.info.participants[0].units[0].tier = 4)],
		['empty unit ID', (payload) => (payload.info.participants[0].units[0].character_id = '')],
		['bad data version', (payload) => (payload.metadata.data_version = '')],
		['bad timestamp', (payload) => (payload.info.game_datetime = -1)],
		['bad duration', (payload) => (payload.info.game_length = 0)],
		['bad game version', (payload) => (payload.info.game_version = '')],
		[
			'bad queue',
			(payload) => {
				payload.info.queueId = -1;
				payload.info.queue_id = -1;
			}
		],
		['bad set number', (payload) => (payload.info.tft_set_number = 0)],
		['bad participant level', (payload) => (payload.info.participants[0].level = 0)]
	];

	test.each(invalidPayloads)('rejects %s', (_name, mutate) => {
		const payload = cloneFixture();
		mutate(payload);
		expect(() => normalize({ payload })).toThrow(TftMatchContractError);
	});

	test('rejects a selected PUUID absent from the match', () => {
		expect(() => normalize({ selectedPuuid: 'missing-player' })).toThrow(TftMatchContractError);
	});

	test('reports all unresolved champion IDs in sorted order without dumping the response', () => {
		const catalogChampions = makeCatalog().filter(
			(row) => row.externalId !== 'TFT17_Teemo' && row.externalId !== 'TFT17_Aatrox'
		);

		try {
			normalize({ catalogChampions });
			throw new Error('Expected normalization to fail');
		} catch (error) {
			expect(error).toBeInstanceOf(TftMatchContractError);
			if (!(error instanceof TftMatchContractError)) throw error;
			expect(error.unresolvedExternalIds).toEqual(['TFT17_Aatrox', 'TFT17_Teemo']);
			expect(error.operatorMessage).toContain('TFT17_Aatrox, TFT17_Teemo');
			expect(error.operatorMessage).not.toContain(placementFour.puuid);
		}
	});
});

describe('canonical snapshot boundaries', () => {
	test('rejects unknown keys and invalid mutations before persistence', () => {
		const canonical = normalize();
		expect(parseCanonicalTftMatchSnapshot(canonical)).toEqual(canonical);

		const mutated = structuredClone(canonical);
		mutated.participants[0].champions[0].starLevel = 4;
		expect(() => parseCanonicalTftMatchSnapshot(mutated)).toThrow(TftMatchContractError);

		const withUnknownKey = { ...canonical, augments: [] };
		expect(() => parseCanonicalTftMatchSnapshot(withUnknownKey)).toThrow(TftMatchContractError);
	});

	test('projects only the selected participant and safe match metadata', () => {
		const canonical = normalize();
		const row = previewRowFromSnapshot(canonical, placementFour.puuid);

		expect(row).toMatchObject({
			available: true,
			matchId: requestedMatchId,
			placement: 4,
			champions: requireValue(
				canonical.participants.find((participant) => participant.placement === 4)
			).champions
		});
		expect(row).not.toHaveProperty('puuid');
		expect(row).not.toHaveProperty('participants');
		expect(row).not.toHaveProperty('augments');
	});
});
