import { afterEach, describe, expect, test, vi } from 'vitest';

const twistedMocks = vi.hoisted(() => ({
	RiotApi: vi.fn(),
	TftApi: vi.fn()
}));

vi.mock('twisted', async (importOriginal) => ({
	...(await importOriginal()),
	RiotApi: twistedMocks.RiotApi,
	TftApi: twistedMocks.TftApi
}));

import {
	TftMatchGatewayError,
	createRuntimeTftMatchGateway,
	createTftMatchGateway
} from './gateway.js';

const accountRegionGroup = 'ASIA';
const matchRegionGroup = 'SEA';

/**
 * @param {{ accountError?: unknown, listError?: unknown, failedMatchId?: string, detailError?: unknown }} [overrides]
 */
function createDoubles(overrides = {}) {
	/** @type {any[][]} */
	const calls = [];
	const riotApi = {
		Account: {
			getByRiotId: vi.fn(async (...args) => {
				calls.push(['account', ...args]);
				if (overrides.accountError) throw overrides.accountError;
				return { response: { puuid: 'resolved-puuid' } };
			})
		}
	};
	const matchIds = Array.from({ length: 12 }, (_, index) => `VN2_MATCH_${index + 1}`);
	let inFlight = 0;
	let maxInFlight = 0;
	const tftApi = {
		Match: {
			list: vi.fn(async (...args) => {
				calls.push(['list', ...args]);
				if (overrides.listError) throw overrides.listError;
				return { response: matchIds };
			}),
			get: vi.fn(async (...args) => {
				calls.push(['get', ...args]);
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight -= 1;
				if (args[0] === overrides.failedMatchId) throw overrides.detailError;
				return { response: { metadata: { match_id: args[0] } } };
			}),
			listWithDetails: vi.fn()
		}
	};
	return { calls, riotApi, tftApi, matchIds, getMaxInFlight: () => maxInFlight };
}

describe('Twisted TFT match gateway', () => {
	afterEach(() => {
		const registry = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (globalThis));
		delete registry[Symbol.for('tft-match-v1.gateway-factory')];
		vi.clearAllMocks();
	});

	test('resolves one account, requests ten IDs, and fetches details sequentially', async () => {
		const doubles = createDoubles();
		const gateway = createTftMatchGateway({
			riotApi: doubles.riotApi,
			tftApi: doubles.tftApi,
			accountRegionGroup,
			matchRegionGroup
		});

		const history = await gateway.fetchRecentMatches({ gameName: 'Player Name', tagline: 'VN2' });

		expect(doubles.calls.slice(0, 4)).toEqual([
			['account', 'Player Name', 'VN2', accountRegionGroup],
			['list', 'resolved-puuid', matchRegionGroup, { count: 10 }],
			['get', doubles.matchIds[0], matchRegionGroup],
			['get', doubles.matchIds[1], matchRegionGroup]
		]);
		expect(history.puuid).toBe('resolved-puuid');
		expect(history.matches).toHaveLength(10);
		expect(doubles.tftApi.Match.get).toHaveBeenCalledTimes(10);
		expect(doubles.getMaxInFlight()).toBe(1);
		expect(doubles.tftApi.Match.listWithDetails).not.toHaveBeenCalled();
		expect(doubles.tftApi.Match.list.mock.calls[0][2]).toEqual({ count: 10 });
		expect(doubles.tftApi.Match.list.mock.calls[0][2]).not.toHaveProperty('startTime');
		expect(doubles.tftApi.Match.list.mock.calls[0][2]).not.toHaveProperty('endTime');
	});

	test('keeps fetching after one detail fails and returns a safe unavailable row', async () => {
		const doubles = createDoubles({
			failedMatchId: 'VN2_MATCH_2',
			detailError: { status: 503, body: 'private upstream body' }
		});
		const gateway = createTftMatchGateway({
			riotApi: doubles.riotApi,
			tftApi: doubles.tftApi,
			accountRegionGroup,
			matchRegionGroup
		});

		const history = await gateway.fetchRecentMatches({ gameName: 'Player', tagline: 'VN2' });

		expect(history.matches[1]).toEqual({
			matchId: 'VN2_MATCH_2',
			payload: null,
			error: 'Riot is temporarily unavailable. Please try again.'
		});
		expect(history.matches.at(-1)?.matchId).toBe('VN2_MATCH_10');
	});

	test.each([
		[401, 'auth', 'The Riot API key is unavailable or invalid.'],
		[403, 'auth', 'The Riot API key is unavailable or invalid.'],
		[404, 'not_found', "No Riot account was found for this player's Riot ID."],
		[429, 'rate_limit', 'Riot is temporarily limiting requests. Please try again shortly.'],
		[500, 'service', 'Riot is temporarily unavailable. Please try again.'],
		[503, 'service', 'Riot is temporarily unavailable. Please try again.']
	])(
		'translates account status %i to a safe %s error',
		async (status, category, operatorMessage) => {
			const secret = 'fake-key-in-error';
			const doubles = createDoubles({
				accountError: {
					status,
					message: `${secret} https://riot.example/private`,
					body: 'raw response body',
					stack: 'private stack'
				}
			});
			const gateway = createTftMatchGateway({
				riotApi: doubles.riotApi,
				tftApi: doubles.tftApi,
				accountRegionGroup,
				matchRegionGroup
			});

			try {
				await gateway.fetchRecentMatches({ gameName: 'Player', tagline: 'VN2' });
				throw new Error('Expected the gateway to reject');
			} catch (error) {
				expect(error).toBeInstanceOf(TftMatchGatewayError);
				if (!(error instanceof TftMatchGatewayError)) throw error;
				expect(error).toMatchObject({ category, status, operatorMessage });
				expect(error.operatorMessage).not.toContain(secret);
				expect(error.operatorMessage).not.toContain('riot.example');
				expect(error.operatorMessage).not.toContain('response body');
				expect(error.operatorMessage).not.toContain('stack');
			}
		}
	);

	test.each([
		[Object.assign(new Error('timed out'), { name: 'AbortError' }), 'timeout'],
		[new Error('socket failed at https://riot.example with fake-key'), 'transport']
	])('translates %s without exposing transport details', async (accountError, category) => {
		const doubles = createDoubles({ accountError });
		const gateway = createTftMatchGateway({
			riotApi: doubles.riotApi,
			tftApi: doubles.tftApi,
			accountRegionGroup,
			matchRegionGroup
		});

		await expect(
			gateway.fetchRecentMatches({ gameName: 'Player', tagline: 'VN2' })
		).rejects.toMatchObject({
			category,
			operatorMessage: 'Riot is temporarily unavailable. Please try again.'
		});
	});

	test('uses the same-process injected factory before constructing Twisted clients', () => {
		const injectedGateway = { fetchRecentMatches: vi.fn() };
		const factory = vi.fn(() => injectedGateway);
		const registry = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (globalThis));
		registry[Symbol.for('tft-match-v1.gateway-factory')] = factory;

		const result = createRuntimeTftMatchGateway({
			apiKey: 'private-key',
			region: 'VN2',
			accountRegionGroup,
			matchRegionGroup
		});

		expect(result).toBe(injectedGateway);
		expect(factory).toHaveBeenCalledWith({ region: 'VN2', accountRegionGroup, matchRegionGroup });
		expect(JSON.stringify(factory.mock.calls)).not.toContain('private-key');
		expect(twistedMocks.RiotApi).not.toHaveBeenCalled();
		expect(twistedMocks.TftApi).not.toHaveBeenCalled();
	});
});
