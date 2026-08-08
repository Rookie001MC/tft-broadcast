import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const PNG_A = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);
const PNG_B = Buffer.from([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
	0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1,
	255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);
const JPEG = Buffer.from([
	255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217
]);
const WEBP = Buffer.from([
	82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0
]);

const FIRST_PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_PUBLICATION_ID = '22222222-2222-4222-8222-222222222222';

function publicationMediaApi() {
	return import('./publication-media.js');
}

/** @param {string} url */
function filenameFromUrl(url) {
	return new URL(url, 'https://broadcast.example').pathname.split('/').at(-1);
}

describe('publication media', () => {
	/** @type {string} */
	let mediaRoot;

	beforeEach(async () => {
		mediaRoot = await mkdtemp(path.join(tmpdir(), 'tft-publication-media-'));
	});

	afterEach(async () => {
		await rm(mediaRoot, { recursive: true, force: true });
	});

	test('copies detected PNG, JPEG, and WebP sources to generated publication URLs', async () => {
		const playerPath = 'player-images/player-one.png';
		const championPath = 'snapshot-active/champions/champion-one.jpg';
		const augmentPath = 'snapshot-active/augments/augment-one.webp';
		await mkdir(path.join(mediaRoot, path.dirname(playerPath)), { recursive: true });
		await mkdir(path.join(mediaRoot, 'catalog-assets', path.dirname(championPath)), {
			recursive: true
		});
		await mkdir(path.join(mediaRoot, 'catalog-assets', path.dirname(augmentPath)), {
			recursive: true
		});
		await writeFile(path.join(mediaRoot, playerPath), PNG_A);
		await writeFile(path.join(mediaRoot, 'catalog-assets', championPath), JPEG);
		await writeFile(path.join(mediaRoot, 'catalog-assets', augmentPath), WEBP);

		const { preparePublicationMedia, readPublicationMedia } = await publicationMediaApi();
		const prepared = await preparePublicationMedia({
			mediaRoot,
			publicationId: FIRST_PUBLICATION_ID,
			winnerImagePath: playerPath,
			championIconPaths: [`/media/catalog-assets/${championPath}`, null],
			augmentIconPaths: [`/media/catalog-assets/${augmentPath}`]
		});

		expect(prepared.relativeDirectory).toBe(`publications/${FIRST_PUBLICATION_ID}`);
		expect(prepared.winnerImageUrl).toMatch(
			new RegExp(`^/media/publications/${FIRST_PUBLICATION_ID}/[a-z0-9-]+\\.png$`)
		);
		expect(prepared.championImageUrls).toEqual([
			expect.stringMatching(
				new RegExp(`^/media/publications/${FIRST_PUBLICATION_ID}/[a-z0-9-]+\\.jpg$`)
			),
			null
		]);
		expect(prepared.augmentImageUrls).toEqual([
			expect.stringMatching(
				new RegExp(`^/media/publications/${FIRST_PUBLICATION_ID}/[a-z0-9-]+\\.webp$`)
			)
		]);
		const generatedNames = [
			filenameFromUrl(prepared.winnerImageUrl),
			filenameFromUrl(prepared.championImageUrls[0]),
			filenameFromUrl(prepared.augmentImageUrls[0])
		];
		expect(new Set(generatedNames).size).toBe(3);

		const winner = await readPublicationMedia({
			mediaRoot,
			publicationId: FIRST_PUBLICATION_ID,
			filename: generatedNames[0]
		});
		expect(winner).toEqual({ bytes: PNG_A, mime: 'image/png' });
	});

	test('keeps published bytes immutable after current source files are replaced', async () => {
		const playerPath = 'player-images/player-one.png';
		await mkdir(path.join(mediaRoot, path.dirname(playerPath)), { recursive: true });
		await writeFile(path.join(mediaRoot, playerPath), PNG_A);
		const { preparePublicationMedia, readPublicationMedia } = await publicationMediaApi();

		const first = await preparePublicationMedia({
			mediaRoot,
			publicationId: FIRST_PUBLICATION_ID,
			winnerImagePath: playerPath,
			championIconPaths: [],
			augmentIconPaths: []
		});
		await writeFile(path.join(mediaRoot, playerPath), PNG_B);
		const second = await preparePublicationMedia({
			mediaRoot,
			publicationId: SECOND_PUBLICATION_ID,
			winnerImagePath: playerPath,
			championIconPaths: [],
			augmentIconPaths: []
		});

		const firstAsset = await readPublicationMedia({
			mediaRoot,
			publicationId: FIRST_PUBLICATION_ID,
			filename: filenameFromUrl(first.winnerImageUrl)
		});
		const secondAsset = await readPublicationMedia({
			mediaRoot,
			publicationId: SECOND_PUBLICATION_ID,
			filename: filenameFromUrl(second.winnerImageUrl)
		});
		expect(firstAsset.bytes).toEqual(PNG_A);
		expect(secondAsset.bytes).toEqual(PNG_B);
		expect(first.winnerImageUrl).toContain(`/publications/${FIRST_PUBLICATION_ID}/`);
		expect(second.winnerImageUrl).toContain(`/publications/${SECOND_PUBLICATION_ID}/`);
	});

	test('rejects invalid source bytes without leaving a publication directory', async () => {
		const playerPath = 'player-images/player-one.png';
		await mkdir(path.join(mediaRoot, path.dirname(playerPath)), { recursive: true });
		await writeFile(path.join(mediaRoot, playerPath), 'not an image');
		const { preparePublicationMedia } = await publicationMediaApi();

		await expect(
			preparePublicationMedia({
				mediaRoot,
				publicationId: FIRST_PUBLICATION_ID,
				winnerImagePath: playerPath,
				championIconPaths: [],
				augmentIconPaths: []
			})
		).rejects.toThrow(/invalid|unsupported/i);
		expect(
			await stat(path.join(mediaRoot, 'publications', FIRST_PUBLICATION_ID)).catch(() => null)
		).toBeNull();
	});

	test('discards unreferenced media after a publication transaction failure', async () => {
		const playerPath = 'player-images/player-one.png';
		await mkdir(path.join(mediaRoot, path.dirname(playerPath)), { recursive: true });
		await writeFile(path.join(mediaRoot, playerPath), PNG_A);
		const { preparePublicationMedia, discardPublicationMedia } = await publicationMediaApi();
		const prepared = await preparePublicationMedia({
			mediaRoot,
			publicationId: FIRST_PUBLICATION_ID,
			winnerImagePath: playerPath,
			championIconPaths: [],
			augmentIconPaths: []
		});

		await discardPublicationMedia({
			mediaRoot,
			relativeDirectory: prepared.relativeDirectory
		});

		expect(
			await stat(path.join(mediaRoot, prepared.relativeDirectory)).catch(() => null)
		).toBeNull();
	});

	test('returns a generic missing-media error without exposing the managed root', async () => {
		const { readPublicationMedia } = await publicationMediaApi();
		/** @type {Error | null} */
		let caught = null;
		try {
			await readPublicationMedia({
				mediaRoot,
				publicationId: FIRST_PUBLICATION_ID,
				filename: 'missing.png'
			});
		} catch (error) {
			caught = error instanceof Error ? error : new Error(String(error));
		}

		expect(caught).toEqual(expect.objectContaining({ message: 'Publication media was not found' }));
		expect(caught.message).not.toContain(mediaRoot);
	});
});
