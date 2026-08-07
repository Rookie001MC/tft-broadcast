import { describe, expect, test } from 'vitest';
import {
	catalogArchiveLimits,
	DEFAULT_MAX_ARCHIVE_BYTES,
	DEFAULT_MAX_EXTRACTED_BYTES
} from './catalog-config.js';

describe('catalog archive limits', () => {
	test('defaults to four compressed GiB and sixteen extracted GiB', () => {
		expect(catalogArchiveLimits()).toEqual({
			maxArchiveBytes: DEFAULT_MAX_ARCHIVE_BYTES,
			maxExtractedBytes: DEFAULT_MAX_EXTRACTED_BYTES
		});
		expect(DEFAULT_MAX_ARCHIVE_BYTES).toBe(4 * 1024 ** 3);
		expect(DEFAULT_MAX_EXTRACTED_BYTES).toBe(16 * 1024 ** 3);
	});

	test('accepts positive deployment overrides', () => {
		expect(
			catalogArchiveLimits({
				CATALOG_MAX_ARCHIVE_GIB: '5.5',
				CATALOG_MAX_EXTRACTED_GIB: '20'
			})
		).toEqual({
			maxArchiveBytes: 5.5 * 1024 ** 3,
			maxExtractedBytes: 20 * 1024 ** 3
		});
	});

	test.each([
		['CATALOG_MAX_ARCHIVE_GIB', '0'],
		['CATALOG_MAX_ARCHIVE_GIB', '-1'],
		['CATALOG_MAX_EXTRACTED_GIB', 'not-a-number']
	])('rejects invalid %s values', (name, value) => {
		expect(() => catalogArchiveLimits({ [name]: value })).toThrow(
			`${name} must be a positive number`
		);
	});
});
