import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ readPublicationMedia: vi.fn() }));

vi.mock('$env/dynamic/private', () => ({ env: { MEDIA_ROOT: 'C:\\private\\test-media' } }));
vi.mock('$lib/server/winner-boards/publication-media.js', async (importOriginal) => ({
	...(await importOriginal()),
	readPublicationMedia: mocks.readPublicationMedia
}));

import { GET } from './+server.js';

const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const FILENAME = `winner-${PUBLICATION_ID}.png`;

describe('immutable publication media route', () => {
	beforeEach(() => vi.clearAllMocks());

	test('serves redetected publication bytes with immutable defensive headers', async () => {
		mocks.readPublicationMedia.mockResolvedValue({
			bytes: new Uint8Array([137, 80, 78, 71]),
			mime: 'image/png'
		});

		const response = await GET(
			/** @type {any} */ ({ params: { publicationId: PUBLICATION_ID, filename: FILENAME } })
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(mocks.readPublicationMedia).toHaveBeenCalledWith({
			mediaRoot: 'C:\\private\\test-media',
			publicationId: PUBLICATION_ID,
			filename: FILENAME
		});
	});

	test.each([
		['an invalid publication ID', '../private', FILENAME],
		['a filename without its publication ID', PUBLICATION_ID, 'winner.png'],
		['a traversal filename', PUBLICATION_ID, '..\\secret.png'],
		['an unsupported extension', PUBLICATION_ID, `winner-${PUBLICATION_ID}.svg`]
	])(
		'returns a generic 404 for %s before reading the filesystem',
		async (_case, publicationId, filename) => {
			let caught;
			try {
				await GET(/** @type {any} */ ({ params: { publicationId, filename } }));
			} catch (error) {
				caught = error;
			}

			expect(caught).toEqual(
				expect.objectContaining({
					status: 404,
					body: expect.objectContaining({ message: 'Publication media was not found' })
				})
			);
			expect(JSON.stringify(caught)).not.toContain('C:\\private\\test-media');
			expect(mocks.readPublicationMedia).not.toHaveBeenCalled();
		}
	);

	test('maps missing or invalid stored media to the same generic 404', async () => {
		mocks.readPublicationMedia.mockRejectedValue(
			new Error('ENOENT: C:\\private\\test-media\\publications\\missing.png')
		);

		let caught;
		try {
			await GET(
				/** @type {any} */ ({ params: { publicationId: PUBLICATION_ID, filename: FILENAME } })
			);
		} catch (error) {
			caught = error;
		}

		expect(caught).toEqual(
			expect.objectContaining({
				status: 404,
				body: expect.objectContaining({ message: 'Publication media was not found' })
			})
		);
		expect(JSON.stringify(caught)).not.toContain('C:\\private\\test-media');
	});
});
