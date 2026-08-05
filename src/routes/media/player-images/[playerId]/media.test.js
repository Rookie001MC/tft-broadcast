import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	select: vi.fn(),
	readManagedPlayerImage: vi.fn(),
	fileTypeFromBuffer: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: 'test-media' } }));
vi.mock('$lib/server/db', () => ({ db: { select: mocks.select } }));
vi.mock('$lib/server/media/player-images.js', () => ({
	readManagedPlayerImage: mocks.readManagedPlayerImage
}));
vi.mock('file-type', () => ({ fileTypeFromBuffer: mocks.fileTypeFromBuffer }));

import { GET } from './+server.js';

/** @param {Array<{ imagePath: string | null }>} rows */
function databaseRows(rows) {
	mocks.select.mockReturnValue({
		from: () => ({ where: () => ({ limit: async () => rows }) })
	});
}

describe('controlled player media route', () => {
	beforeEach(() => vi.clearAllMocks());

	test('serves a detected managed image with defensive headers', async () => {
		databaseRows([{ imagePath: 'player-images/player-1.png' }]);
		mocks.readManagedPlayerImage.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
		mocks.fileTypeFromBuffer.mockResolvedValue({ mime: 'image/png', ext: 'png' });

		const response = await GET(/** @type {any} */ ({ params: { playerId: 'player-1' } }));

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('cache-control')).toBe('private, max-age=60');
		expect(mocks.readManagedPlayerImage).toHaveBeenCalledWith({
			mediaRoot: 'test-media',
			relativePath: 'player-images/player-1.png'
		});
	});

	test('returns 404 for missing database rows and missing managed files', async () => {
		databaseRows([]);
		await expect(GET(/** @type {any} */ ({ params: { playerId: 'missing' } }))).rejects.toEqual(
			expect.objectContaining({ status: 404 })
		);

		databaseRows([{ imagePath: 'player-images/missing.png' }]);
		mocks.readManagedPlayerImage.mockRejectedValue(new Error('ENOENT'));
		await expect(GET(/** @type {any} */ ({ params: { playerId: 'missing' } }))).rejects.toEqual(
			expect.objectContaining({ status: 404 })
		);
	});

	test('returns 415 when managed bytes are not a supported image', async () => {
		databaseRows([{ imagePath: 'player-images/player-1.bin' }]);
		mocks.readManagedPlayerImage.mockResolvedValue(new Uint8Array([1, 2, 3]));
		mocks.fileTypeFromBuffer.mockResolvedValue(undefined);

		await expect(GET(/** @type {any} */ ({ params: { playerId: 'player-1' } }))).rejects.toEqual(
			expect.objectContaining({ status: 415 })
		);
	});
});
