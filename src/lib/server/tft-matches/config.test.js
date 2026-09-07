import { Constants } from 'twisted';
import { afterEach, describe, expect, test, vi } from 'vitest';

const twistedMocks = vi.hoisted(() => ({
	matchRoute: vi.fn(),
	accountRoute: vi.fn()
}));

vi.mock('twisted', async (importOriginal) => {
	const actual = /** @type {typeof import('twisted')} */ (await importOriginal());
	twistedMocks.matchRoute.mockImplementation(actual.Constants.regionToRegionGroup);
	twistedMocks.accountRoute.mockImplementation(actual.Constants.regionToRegionGroupForAccountAPI);
	return {
		...actual,
		Constants: {
			...actual.Constants,
			regionToRegionGroup: twistedMocks.matchRoute,
			regionToRegionGroupForAccountAPI: twistedMocks.accountRoute
		}
	};
});

import {
	TftMatchConfigurationError,
	getTftMatchApiAvailability,
	requireTftMatchApiConfig
} from './config.js';

describe('TFT match API configuration', () => {
	afterEach(() => vi.clearAllMocks());

	test('disables only API imports when the private key is missing', () => {
		const availability = getTftMatchApiAvailability({ environment: {}, region: 'VN2' });

		expect(availability).toEqual({
			enabled: false,
			region: 'VN2',
			reason: 'A Riot API key is required to fetch TFT matches.'
		});
		expect(JSON.stringify(availability)).not.toContain('RIOT_API_KEY');
	});

	test.each([null, '', 'vn2', 'SEA', 'unsupported'])(
		'requires an exact persisted region: %s',
		(region) => {
			const availability = getTftMatchApiAvailability({
				environment: { RIOT_API_KEY: 'private-key' },
				region
			});

			expect(availability).toEqual({
				enabled: false,
				region: null,
				reason: 'Select a supported TFT platform region in Settings.'
			});
		}
	);

	test('trims the key and derives both Twisted routing groups', () => {
		const config = requireTftMatchApiConfig({
			environment: { RIOT_API_KEY: '  private-key  ' },
			region: 'VN2'
		});

		expect(config).toEqual({
			apiKey: 'private-key',
			region: 'VN2',
			accountRegionGroup: Constants.regionToRegionGroupForAccountAPI(Constants.Regions.VIETNAM),
			matchRegionGroup: Constants.regionToRegionGroup(Constants.Regions.VIETNAM)
		});
		expect(
			getTftMatchApiAvailability({
				environment: { RIOT_API_KEY: 'private-key' },
				region: 'VN2'
			})
		).toEqual({ enabled: true, region: 'VN2', reason: null });
	});

	test('makes a platform unavailable when a Twisted routing helper rejects it', () => {
		twistedMocks.matchRoute.mockImplementationOnce(() => {
			throw new Error('routing table drift');
		});

		expect(
			getTftMatchApiAvailability({
				environment: { RIOT_API_KEY: 'private-key' },
				region: 'VN2'
			})
		).toEqual({
			enabled: false,
			region: 'VN2',
			reason: 'The selected TFT platform region is unavailable.'
		});
	});

	test('never exposes the key through typed configuration errors or availability JSON', () => {
		const key = 'super-secret-test-key';
		expect(() =>
			requireTftMatchApiConfig({ environment: { RIOT_API_KEY: key }, region: 'bad' })
		).toThrow(TftMatchConfigurationError);
		expect(
			JSON.stringify(
				getTftMatchApiAvailability({ environment: { RIOT_API_KEY: key }, region: 'bad' })
			)
		).not.toContain(key);
	});
});
