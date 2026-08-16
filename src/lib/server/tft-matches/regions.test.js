import { Constants } from 'twisted';
import { describe, expect, test } from 'vitest';

import {
	TftMatchRegionError,
	getTftPlatformRegionOptions,
	parseTftPlatformRegion
} from './regions.js';

describe('TFT platform regions', () => {
	test('derives every browser option from Twisted in enum order', () => {
		const options = getTftPlatformRegionOptions();

		expect(options.map((option) => option.value)).toEqual(Object.values(Constants.Regions));
		expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
		expect(options).toContainEqual({ value: 'VN2', label: 'Vietnam (VN2)' });
		expect(options).toContainEqual({ value: 'EUN1', label: 'EU East (EUN1)' });
	});

	test('accepts only exact Twisted platform-region codes', () => {
		for (const region of Object.values(Constants.Regions)) {
			expect(parseTftPlatformRegion(region)).toBe(region);
		}

		for (const invalid of ['', 'vn2', 'SEA', 'AMERICAS', 'unknown']) {
			expect(() => parseTftPlatformRegion(invalid)).toThrow(TftMatchRegionError);
		}
	});
});
