import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { zipSync } from 'fflate';
import tar from 'tar-stream';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	cleanupStaleCatalogStaging,
	downloadCatalogImages,
	extractTarGz,
	extractZip,
	readManagedCatalogAsset
} from './catalog-media.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64'
);

/** @param {{ name: string, type?: 'file' | 'symlink', body?: string }[]} entries @returns {Promise<Buffer>} */
function archive(entries) {
	return new Promise((resolve, reject) => {
		const pack = tar.pack();
		const gzip = createGzip();
		/** @type {Buffer[]} */
		const chunks = [];
		gzip.on('data', (chunk) => chunks.push(chunk));
		gzip.on('error', reject);
		gzip.on('end', () => resolve(Buffer.concat(chunks)));
		pack.pipe(gzip);
		for (const entry of entries)
			pack.entry(
				{
					name: entry.name,
					type: entry.type ?? 'file',
					...(entry.type === 'symlink' ? { linkname: 'target' } : {})
				},
				entry.body ?? ''
			);
		pack.finalize();
	});
}

describe('catalog package extraction', () => {
	/** @type {string} */
	let root;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'tft-catalog-media-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test('extracts regular package files while counting actual bytes', async () => {
		const archivePath = path.join(root, 'catalog.tgz');
		await writeFile(
			archivePath,
			await archive([{ name: '16.15.1/data/en_US/test.json', body: '{}' }])
		);
		/** @type {number[]} */
		const samples = [];
		await extractTarGz({
			archivePath,
			destination: path.join(root, 'out'),
			onExtracted: (bytes) => samples.push(bytes)
		});
		expect(await readFile(path.join(root, 'out/16.15.1/data/en_US/test.json'), 'utf8')).toBe('{}');
		expect(samples.at(-1)).toBe(2);
	});

	test('enforces the configured total extraction limit for tar and ZIP packages', async () => {
		const tarPath = path.join(root, 'limited.tgz');
		await writeFile(tarPath, await archive([{ name: 'data.json', body: '{}' }]));
		await expect(
			extractTarGz({
				archivePath: tarPath,
				destination: path.join(root, 'limited-tar'),
				maxExtractedBytes: 1
			})
		).rejects.toThrow('configured size limit');

		const zipPath = path.join(root, 'limited.zip');
		await writeFile(zipPath, zipSync({ 'data.json': new TextEncoder().encode('{}') }));
		await expect(
			extractZip({
				archivePath: zipPath,
				destination: path.join(root, 'limited-zip'),
				maxExtractedBytes: 1
			})
		).rejects.toThrow('configured size limit');
	});

	test('rejects traversing paths and symbolic links', async () => {
		/** @type {{ name: string, type?: 'file' | 'symlink', body?: string }[][]} */
		const unsafeArchives = [
			[{ name: '../escape.txt', body: 'nope' }],
			[{ name: 'link', type: 'symlink' }]
		];
		for (const entries of unsafeArchives) {
			const archivePath = path.join(root, `${Math.random()}.tgz`);
			await writeFile(archivePath, await archive(entries));
			await expect(
				extractTarGz({ archivePath, destination: path.join(root, `${Math.random()}-out`) })
			).rejects.toThrow(/unsafe path|not allowed/);
		}
	});

	test('extracts the documented ZIP package exception and counts streamed bytes', async () => {
		const archivePath = path.join(root, 'catalog.zip');
		await writeFile(
			archivePath,
			zipSync({ '10.10.5/data/en_US/test.json': new TextEncoder().encode('{"ok":true}') })
		);
		/** @type {number[]} */
		const samples = [];
		await extractZip({
			archivePath,
			destination: path.join(root, 'zip-out'),
			onExtracted: (bytes) => samples.push(bytes)
		});
		expect(await readFile(path.join(root, 'zip-out/10.10.5/data/en_US/test.json'), 'utf8')).toBe(
			'{"ok":true}'
		);
		expect(samples.at(-1)).toBe(11);
	});

	test('bounds CommunityDragon image downloads to eight concurrent requests', async () => {
		let active = 0;
		let maximum = 0;
		const assets = Array.from({ length: 12 }, (_, index) => ({
			externalId: `asset-${index}`,
			displayName: `Asset ${index}`,
			iconPath: `https://assets.example/${index}.png`,
			tier: null,
			metadataJson: '{}'
		}));
		await downloadCatalogImages({
			assets,
			kind: 'champions',
			destination: path.join(root, 'downloads'),
			fetchResponse: async () => {
				active += 1;
				maximum = Math.max(maximum, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return new Response(Uint8Array.from(PNG));
			}
		});
		expect(maximum).toBe(8);
	});

	test('serves only contained, detected catalog images from managed storage', async () => {
		const image = path.join(root, 'catalog-assets/snapshot/champions/ahri.png');
		await mkdir(path.dirname(image), { recursive: true });
		await writeFile(image, PNG);
		const asset = await readManagedCatalogAsset(root, 'snapshot/champions/ahri.png');
		expect(asset.mime).toBe('image/png');
		await expect(
			readManagedCatalogAsset(root, 'snapshot/champions/../../../outside.png')
		).rejects.toThrow('unsafe path');
	});

	test('removes stale staging directories but leaves current work alone', async () => {
		const staging = path.join(root, 'catalog-staging');
		const stale = path.join(staging, 'stale');
		await mkdir(path.join(staging, 'current'), { recursive: true });
		await mkdir(stale, { recursive: true });
		const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
		await utimes(stale, old, old);
		await cleanupStaleCatalogStaging(root);
		expect(await stat(path.join(staging, 'current'))).toBeTruthy();
		expect(await stat(stale).catch(() => null)).toBeNull();
	});
});
