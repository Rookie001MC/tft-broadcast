import { describe, expect, test } from 'vitest';
import {
	getTftMatchApiAvailability,
	requireTftMatchApiConfig,
	TftMatchApiConfigError
} from './config.js';

describe('TFT match API configuration', () => {
	test('returns a browser-safe disabled reason when the private key is missing', () => {
		expect(getTftMatchApiAvailability({ RIOT_REGION: 'VN2' })).toEqual({
			enabled: false,
			region: null,
			reason: 'A Riot API key is required to fetch TFT matches.'
		});
	});

	test('normalizes the configured platform region and derives both routing groups', () => {
		expect(
			requireTftMatchApiConfig({ RIOT_API_KEY: ' private-key ', RIOT_REGION: 'vn2' })
		).toMatchObject({
			apiKey: 'private-key',
			region: 'VN2',
			accountRegionGroup: 'ASIA',
			matchRegionGroup: 'SEA'
		});
	});

	test('does not leak the private key through unsupported-region availability', () => {
		const availability = getTftMatchApiAvailability({
			RIOT_API_KEY: 'secret-not-for-browser',
			RIOT_REGION: 'not-a-region'
		});
		expect(availability).toMatchObject({ enabled: false, region: null });
		expect(JSON.stringify(availability)).not.toContain('secret-not-for-browser');
		expect(() =>
			requireTftMatchApiConfig({
				RIOT_API_KEY: 'secret-not-for-browser',
				RIOT_REGION: 'not-a-region'
			})
		).toThrow(TftMatchApiConfigError);
	});
});
