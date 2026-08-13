import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import { clearTftMatchPreviewCacheForTests } from './cache.js';
import {
	discoverTftMatchHistory,
	resolveTftMatchPreviewForSave,
	TftMatchPreviewConflictError
} from './discovery.js';

const fixtureText = await readFile(
	new URL('../../../../examples/tft-match-v1.example.jsonc', import.meta.url),
	'utf8'
);
const fixture = /** @type {any} */ (JSON.parse(fixtureText.replace(/^\/\/.*\r?\n/gm, '')));
const selected = fixture.info.participants.find(
	/** @param {any} participant */ (participant) => participant.placement === 4
);
const config = { region: 'VN2', apiKey: 'private-key' };
const catalogChampions = [
	...new Set(
		fixture.info.participants.flatMap(
			/** @param {any} participant */ (participant) =>
				participant.units.map(/** @param {any} unit */ (unit) => unit.character_id)
		)
	)
].map((externalId, index) => ({
	id: `catalog-${index + 1}`,
	externalId,
	displayName: externalId,
	iconPath: `/icons/${externalId}.png`,
	isExcluded: false
}));

function context() {
	return {
		tournamentId: 'tournament-1',
		player: {
			id: 'player-1',
			displayName: 'Selected player',
			riotGameName: 'Database Name',
			riotTagline: 'DBTAG'
		},
		activeCatalog: { id: 'catalog-snapshot-1', champions: catalogChampions }
	};
}

describe('TFT match discovery', () => {
	test('uses only roster-owned identity, caches canonical snapshots, and returns selected-player rows only', async () => {
		clearTftMatchPreviewCacheForTests();
		const gateway = {
			fetchRecentMatches: vi.fn(async () => ({
				puuid: selected.puuid,
				matches: [{ matchId: fixture.metadata.match_id, payload: fixture, error: null }]
			}))
		};
		const result = await discoverTftMatchHistory({
			database: {},
			tournamentId: 'tournament-1',
			playerId: 'player-1',
			config,
			gateway,
			loadContext: async () => context(),
			now: new Date('2026-08-14T00:00:00.000Z')
		});

		expect(gateway.fetchRecentMatches).toHaveBeenCalledWith({
			gameName: 'Database Name',
			tagline: 'DBTAG'
		});
		expect(result).toMatchObject({ token: expect.any(String), selectedPlayer: { id: 'player-1' } });
		expect(result.matches).toEqual([
			expect.objectContaining({
				matchId: fixture.metadata.match_id,
				placement: 4,
				omittedUnitCount: 0
			})
		]);
		expect(JSON.stringify(result)).not.toContain('private-key');
		expect(JSON.stringify(result)).not.toContain(selected.puuid);
		expect(JSON.stringify(result.matches[0])).not.toContain('participants');
	});

	test('rejects an expired preview during Save with a safe refetch message', async () => {
		clearTftMatchPreviewCacheForTests();
		const gateway = {
			fetchRecentMatches: async () => ({
				puuid: selected.puuid,
				matches: [{ matchId: fixture.metadata.match_id, payload: fixture, error: null }]
			})
		};
		const startedAt = new Date('2026-08-14T00:00:00.000Z');
		const result = await discoverTftMatchHistory({
			database: {},
			tournamentId: 'tournament-1',
			playerId: 'player-1',
			config,
			gateway,
			loadContext: async () => context(),
			now: startedAt
		});

		await expect(
			resolveTftMatchPreviewForSave({
				database: {},
				token: result.token,
				matchId: fixture.metadata.match_id,
				tournamentId: 'tournament-1',
				config,
				loadContext: async () => context(),
				now: new Date(startedAt.getTime() + 15 * 60_000)
			})
		).rejects.toEqual(
			expect.objectContaining({
				constructor: TftMatchPreviewConflictError,
				status: 409,
				operatorMessage: 'This API preview is no longer available. Fetch it again.'
			})
		);
	});

	test('does not allow a player outside the supplied tournament to invoke the gateway', async () => {
		const gateway = { fetchRecentMatches: vi.fn() };
		await expect(
			discoverTftMatchHistory({
				database: {},
				tournamentId: 'tournament-1',
				playerId: 'outsider',
				config,
				gateway,
				loadContext: async () => null
			})
		).rejects.toEqual(expect.objectContaining({ status: 404 }));
		expect(gateway.fetchRecentMatches).not.toHaveBeenCalled();
	});
});
