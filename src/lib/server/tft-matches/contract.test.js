import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import {
	CANONICAL_TFT_MATCH_CONTRACT_VERSION,
	normalizeTftMatch,
	parseCanonicalTftMatchSnapshot,
	previewRowFromSnapshot,
	TftMatchContractError
} from './contract.js';

const fixtureText = await readFile(
	new URL('../../../../examples/tft-match-v1.example.jsonc', import.meta.url),
	'utf8'
);
const fixture = JSON.parse(fixtureText.replace(/^\/\/.*\r?\n/gm, ''));
const catalogChampions = [
	...new Set(
		fixture.info.participants.flatMap((player) => player.units.map((unit) => unit.character_id))
	)
].map((externalId, index) => ({
	id: `catalog-${index + 1}`,
	externalId,
	displayName: externalId.replace('TFT17_', ''),
	iconPath: `/icons/${externalId}.png`,
	isExcluded: false
}));
const catalogExternalIds = new Set(catalogChampions.map((champion) => champion.externalId));
const selectedPuuid = fixture.info.participants.find((player) => player.placement === 4).puuid;

function cloneFixture() {
	return structuredClone(fixture);
}

function normalize(payload = cloneFixture(), overrides = {}) {
	return normalizeTftMatch({
		payload,
		requestedMatchId: fixture.metadata.match_id,
		selectedPuuid,
		region: 'SG2',
		catalogChampions,
		fetchedAt: new Date('2026-08-13T00:00:00.000Z'),
		...overrides
	});
}

function expectContractError(run, unresolvedExternalIds = []) {
	expect(run).toThrow(TftMatchContractError);
	try {
		run();
	} catch (error) {
		expect(error.operatorMessage).toEqual(expect.any(String));
		expect(error.unresolvedExternalIds).toEqual(unresolvedExternalIds);
		expect(error.message).not.toContain('"metadata"');
	}
}

describe('normalizeTftMatch', () => {
	test('normalizes the comment-prefixed Riot fixture into a frozen version-one snapshot', () => {
		const snapshot = normalize();

		expect(snapshot).toMatchObject({
			contractVersion: CANONICAL_TFT_MATCH_CONTRACT_VERSION,
			matchId: fixture.metadata.match_id,
			region: 'SG2',
			queueId: 1100,
			completedAt: new Date(fixture.info.game_datetime).toISOString(),
			fetchedAt: '2026-08-13T00:00:00.000Z'
		});
		expect(snapshot.participants.map((participant) => participant.placement)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8
		]);
		expect(Object.isFrozen(snapshot)).toBe(true);
	});

	test('uses placement rather than win and maps every selected unit with contiguous order and tiers', () => {
		const payload = cloneFixture();
		const selected = payload.info.participants.find(
			(participant) => participant.puuid === selectedPuuid
		);
		selected.win = true;
		const snapshot = normalize(payload);
		const board = snapshot.participants.find(
			(participant) => participant.puuid === selectedPuuid
		).champions;

		expect(
			snapshot.participants.find((participant) => participant.puuid === selectedPuuid).placement
		).toBe(4);
		expect(board.map((champion) => champion.displayOrder)).toEqual(board.map((_, index) => index));
		expect(board.map((champion) => champion.starLevel)).toEqual(
			selected.units
				.filter((unit) => catalogExternalIds.has(unit.character_id))
				.map((unit) => unit.tier)
		);
		expect(board.map((champion) => champion.externalId)).toEqual(
			selected.units
				.filter((unit) => catalogExternalIds.has(unit.character_id))
				.map((unit) => unit.character_id)
		);
	});

	test('keeps duplicate mapped units as independent ordered slots', () => {
		const payload = cloneFixture();
		const board = payload.info.participants.find(
			(participant) => participant.puuid === selectedPuuid
		).units;
		const duplicate = { ...board[0] };
		board.splice(1, 0, duplicate);

		const champions = normalize(payload).participants.find(
			(participant) => participant.puuid === selectedPuuid
		).champions;
		expect(champions.slice(0, 2)).toEqual([
			expect.objectContaining({
				catalogChampionId: catalogChampions.find(
					(champion) => champion.externalId === duplicate.character_id
				).id,
				starLevel: duplicate.tier,
				displayOrder: 0
			}),
			expect.objectContaining({
				catalogChampionId: catalogChampions.find(
					(champion) => champion.externalId === duplicate.character_id
				).id,
				starLevel: duplicate.tier,
				displayOrder: 1
			})
		]);
	});

	test('omits a unit absent from the eligible catalog and counts it', () => {
		const payload = cloneFixture();
		const board = payload.info.participants.find(
			(participant) => participant.puuid === selectedPuuid
		).units;
		board.splice(1, 0, { character_id: 'TFT17_Unknown', tier: 2 });

		const participant = normalize(payload).participants.find(
			({ puuid }) => puuid === selectedPuuid
		);
		expect(participant.omittedUnitCount).toBe(1);
		expect(participant.champions.map((champion) => champion.displayOrder)).toEqual(
			participant.champions.map((_, index) => index)
		);
	});

	test('accepts raw unknown fields, absent augments, either queue spelling, absent completion marker, and partial Riot IDs', () => {
		const payload = cloneFixture();
		delete payload.info.queueId;
		delete payload.info.endOfGameResult;
		delete payload.info.participants[0].augments;
		delete payload.info.participants[0].riotIdGameName;
		delete payload.info.participants[0].riotIdTagline;
		payload.unrecognized = { future: true };

		expect(normalize(payload).queueId).toBe(1100);
	});

	test('creates a safe selected-player preview without payload, other players, or augments', () => {
		const preview = previewRowFromSnapshot(normalize(), selectedPuuid);

		expect(preview).toMatchObject({
			matchId: fixture.metadata.match_id,
			region: 'SG2',
			selectedPuuid
		});
		expect(preview).toHaveProperty('champions');
		expect(preview).toHaveProperty('omittedUnitCount');
		expect(preview).not.toHaveProperty('participants');
		expect(preview).not.toHaveProperty('payload');
		expect(preview).not.toHaveProperty('augments');
	});

	test('rejects a mismatched match ID', () => {
		expectContractError(() => normalize(cloneFixture(), { requestedMatchId: 'SG2_other' }));
	});

	test('rejects empty or duplicate participant PUUIDs', () => {
		for (const value of ['', fixture.info.participants[1].puuid]) {
			const payload = cloneFixture();
			payload.info.participants[0].puuid = value;
			expectContractError(() => normalize(payload));
		}
	});

	test('requires metadata participants to exactly match the eight info participant PUUIDs', () => {
		for (const metadataParticipants of [
			fixture.metadata.participants.slice(1),
			[...fixture.metadata.participants, 'extra-puuid'],
			['replaced-puuid', ...fixture.metadata.participants.slice(1)]
		]) {
			const payload = cloneFixture();
			payload.metadata.participants = metadataParticipants;
			expectContractError(() => normalize(payload));
		}
	});

	test('rejects incomplete placements, duplicate champions, invalid tiers, and missing selected PUUID', () => {
		const incomplete = cloneFixture();
		incomplete.info.participants[0].placement = 8;
		expectContractError(() => normalize(incomplete));
		const invalidTier = cloneFixture();
		invalidTier.info.participants.find(
			(participant) => participant.puuid === selectedPuuid
		).units[0].tier = 4;
		expectContractError(() => normalize(invalidTier));
		expectContractError(() => normalize(cloneFixture(), { selectedPuuid: 'missing' }));
	});

	test('rejects malformed Riot metadata and info values', () => {
		const malformedMetadata = cloneFixture();
		malformedMetadata.metadata.match_id = 42;
		expectContractError(() => normalize(malformedMetadata));
		const malformedInfo = cloneFixture();
		malformedInfo.info.game_datetime = 'tomorrow';
		expectContractError(() => normalize(malformedInfo));
	});

	test('rejects empty character IDs', () => {
		const emptyId = cloneFixture();
		emptyId.info.participants.find(
			(participant) => participant.puuid === selectedPuuid
		).units[0].character_id = '';
		expectContractError(() => normalize(emptyId));
	});

	test('uses catalog membership rather than isExcluded to determine eligible units', () => {
		const champion = catalogChampions[0];
		const snapshot = normalize(cloneFixture(), {
			catalogChampions: catalogChampions.map((row) =>
				row.externalId === champion.externalId ? { ...row, isExcluded: true } : row
			)
		});
		expect(
			snapshot.participants.some((participant) =>
				participant.champions.some((slot) => slot.externalId === champion.externalId)
			)
		).toBe(true);
	});

	test('rejects mutated canonical snapshots', () => {
		const version = structuredClone(normalize());
		version.contractVersion = 2;
		expect(() => parseCanonicalTftMatchSnapshot(version)).toThrow(TftMatchContractError);

		const snapshot = structuredClone(normalize());
		const participant = snapshot.participants.find(({ puuid }) => puuid === selectedPuuid);
		participant.omittedUnitCount = -1;
		expect(() => parseCanonicalTftMatchSnapshot(snapshot)).toThrow(TftMatchContractError);
	});
});
