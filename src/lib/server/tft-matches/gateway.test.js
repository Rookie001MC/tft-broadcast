import { afterEach, describe, expect, test, vi } from 'vitest';
import { createRuntimeTftMatchGateway, createTftMatchGateway } from './gateway.js';

const config = {
	apiKey: 'private-key',
	region: 'VN2',
	accountRegionGroup: 'ASIA',
	matchRegionGroup: 'SEA'
};

describe('TFT match gateway', () => {
	afterEach(
		() => delete (/** @type {any} */ (globalThis)[Symbol.for('tft-match-v1.gateway-factory')])
	);

	test('looks up one account, fetches ten newest IDs, and loads details sequentially', async () => {
		/** @type {any[]} */
		const calls = [];
		let inFlightDetails = 0;
		let maxInFlightDetails = 0;
		const gateway = createTftMatchGateway({
			accountRegionGroup: config.accountRegionGroup,
			matchRegionGroup: config.matchRegionGroup,
			riotApi: {
				Account: {
					getByRiotId: vi.fn(async (...args) => {
						calls.push(['account', ...args]);
						return { response: { puuid: 'selected-puuid' } };
					})
				}
			},
			tftApi: {
				Match: {
					list: vi.fn(async (...args) => {
						calls.push(['list', ...args]);
						return { response: Array.from({ length: 12 }, (_, index) => `VN2_${index + 1}`) };
					}),
					get: vi.fn(async (...args) => {
						calls.push(['get', ...args]);
						inFlightDetails += 1;
						maxInFlightDetails = Math.max(maxInFlightDetails, inFlightDetails);
						await Promise.resolve();
						inFlightDetails -= 1;
						return { response: { metadata: { match_id: args[0] } } };
					})
				}
			}
		});

		const result = await gateway.fetchRecentMatches({ gameName: 'Player', tagline: 'TAG' });

		expect(calls.slice(0, 2)).toEqual([
			['account', 'Player', 'TAG', 'ASIA'],
			['list', 'selected-puuid', 'SEA', { count: 10 }]
		]);
		expect(calls.filter(([kind]) => kind === 'get').map(([, id]) => id)).toEqual(
			Array.from({ length: 10 }, (_, index) => `VN2_${index + 1}`)
		);
		expect(maxInFlightDetails).toBe(1);
		expect(result.puuid).toBe('selected-puuid');
		expect(result.matches).toHaveLength(10);
	});

	test('keeps a failed detail as a safe unavailable result and continues later IDs', async () => {
		const gateway = createTftMatchGateway({
			accountRegionGroup: 'ASIA',
			matchRegionGroup: 'SEA',
			riotApi: { Account: { getByRiotId: vi.fn(async () => ({ response: { puuid: 'p' } })) } },
			tftApi: {
				Match: {
					list: vi.fn(async () => ({ response: ['VN2_one', 'VN2_two'] })),
					get: vi.fn(async (matchId) => {
						if (matchId === 'VN2_one') throw new Error('https://private.example/key=private-key');
						return { response: { metadata: { match_id: matchId } } };
					})
				}
			}
		});

		const result = await gateway.fetchRecentMatches({ gameName: 'Player', tagline: 'TAG' });
		expect(result.matches).toEqual([
			expect.objectContaining({ matchId: 'VN2_one', payload: null, error: expect.any(String) }),
			expect.objectContaining({ matchId: 'VN2_two', payload: expect.any(Object), error: null })
		]);
		expect(result.matches[0].error).not.toContain('private-key');
	});

	test('uses the injected factory before constructing runtime Twisted clients and never passes its key', () => {
		const factory = vi.fn((input) => ({ injected: true, input }));
		/** @type {any} */ (globalThis)[Symbol.for('tft-match-v1.gateway-factory')] = factory;

		const gateway = createRuntimeTftMatchGateway(config);

		expect(gateway).toMatchObject({ injected: true });
		expect(factory).toHaveBeenCalledWith({
			region: 'VN2',
			accountRegionGroup: 'ASIA',
			matchRegionGroup: 'SEA'
		});
	});
});
