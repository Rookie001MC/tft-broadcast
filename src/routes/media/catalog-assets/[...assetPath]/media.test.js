import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readManagedCatalogAsset: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: 'test-media' } }));
vi.mock('$lib/server/catalog/catalog-media.js', () => ({
	readManagedCatalogAsset: mocks.readManagedCatalogAsset
}));

import { GET } from './+server.js';

describe('immutable catalog media route', () => {
	beforeEach(() => vi.clearAllMocks());

	test('serves a contained image with immutable defensive headers', async () => {
		mocks.readManagedCatalogAsset.mockResolvedValue({
			bytes: new Uint8Array([137, 80, 78, 71]),
			mime: 'image/png'
		});
		const response = await GET(
			/** @type {any} */ ({ params: { assetPath: 'snapshot/champions/ahri.png' } })
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(mocks.readManagedCatalogAsset).toHaveBeenCalledWith(
			'test-media',
			'snapshot/champions/ahri.png'
		);
	});

	test('maps missing and unsupported files to safe HTTP errors', async () => {
		mocks.readManagedCatalogAsset.mockRejectedValueOnce(new Error('ENOENT'));
		await expect(
			GET(/** @type {any} */ ({ params: { assetPath: 'missing.png' } }))
		).rejects.toEqual(expect.objectContaining({ status: 404 }));
		mocks.readManagedCatalogAsset.mockRejectedValueOnce(new Error('Unsupported catalog image'));
		await expect(GET(/** @type {any} */ ({ params: { assetPath: 'unsafe.svg' } }))).rejects.toEqual(
			expect.objectContaining({ status: 415 })
		);
	});
});
