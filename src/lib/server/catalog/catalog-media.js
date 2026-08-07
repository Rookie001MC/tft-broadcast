import { constants as fsConstants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createGunzip } from 'node:zlib';
import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type';
import tar from 'tar-stream';
import yauzl from 'yauzl';
import { resolveContainedPath } from '../media/player-images.js';
import { DEFAULT_MAX_ARCHIVE_BYTES, DEFAULT_MAX_EXTRACTED_BYTES } from './catalog-config.js';

export const MAX_ARCHIVE_BYTES = DEFAULT_MAX_ARCHIVE_BYTES;
export const MAX_EXTRACTED_BYTES = DEFAULT_MAX_EXTRACTED_BYTES;
export const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024 * 1024;
export const MAX_CATALOG_IMAGE_BYTES = 10 * 1024 * 1024;
const STALE_STAGING_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM']);
const SUPPORTED_IMAGES = new Map([
	['image/png', '.png'],
	['image/jpeg', '.jpg'],
	['image/webp', '.webp']
]);

/** @typedef {{ externalId: string, displayName: string, iconPath: string | null, tier: number | null, metadataJson: string }} CatalogAsset */

/** @param {string} value */
function safeRelativePath(value) {
	const normalized = value.replaceAll('\\', '/');
	if (
		!normalized ||
		normalized.includes('\0') ||
		normalized.startsWith('/') ||
		/^[a-zA-Z]:/.test(normalized) ||
		normalized.split('/').includes('..')
	)
		throw new Error('Archive contains an unsafe path');
	const clean = path.posix.normalize(normalized);
	if (clean === '..' || clean.startsWith('../')) throw new Error('Archive contains an unsafe path');
	return clean;
}

/** @param {string} value */
function safeStem(value) {
	const stem = value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
	return stem.slice(0, 100) || 'asset';
}

/** @param {string} mediaRoot */
export async function cleanupStaleCatalogStaging(mediaRoot) {
	const stagingRoot = resolveContainedPath(mediaRoot, 'catalog-staging');
	await mkdir(stagingRoot, { recursive: true });
	const now = Date.now();
	for (const entry of await readdir(stagingRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const target = resolveContainedPath(stagingRoot, entry.name);
		const details = await stat(target).catch(() => null);
		if (details && now - details.mtimeMs >= STALE_STAGING_MS)
			await rm(target, { recursive: true, force: true });
	}
}

/**
 * @param {{ response: Response, destination: string, maxBytes: number, signal?: AbortSignal, onBytes?: (completed: number, total: number | null) => void }} input
 */
export async function downloadResponseToFile({ response, destination, maxBytes, signal, onBytes }) {
	if (!response.ok || !response.body)
		throw new Error(`Download failed with HTTP ${response.status}`);
	const declared = Number(response.headers.get('content-length'));
	const total = Number.isSafeInteger(declared) && declared >= 0 ? declared : null;
	if (total !== null && total > maxBytes)
		throw new Error('Download exceeds the configured size limit');
	await mkdir(path.dirname(destination), { recursive: true });
	let completed = 0;
	const counter = new Transform({
		transform(chunk, _encoding, callback) {
			completed += chunk.length;
			if (completed > maxBytes) callback(new Error('Download exceeds the configured size limit'));
			else {
				onBytes?.(completed, total);
				callback(null, chunk);
			}
		}
	});
	await pipeline(response.body, counter, createWriteStream(destination, { flags: 'wx' }), {
		signal
	});
}

/**
 * @param {{ archivePath: string, destination: string, maxExtractedBytes?: number, signal?: AbortSignal, onExtracted?: (bytes: number) => void }} input
 */
export async function extractTarGz({
	archivePath,
	destination,
	maxExtractedBytes = MAX_EXTRACTED_BYTES,
	signal,
	onExtracted
}) {
	await mkdir(destination, { recursive: true });
	const extract = tar.extract();
	// streamx can emit an extraction error after pipeline has already rejected.
	extract.on('error', () => {});
	let extractedBytes = 0;
	/** @type {unknown} */
	let extractionError = null;

	extract.on('entry', (header, entry, next) => {
		void (async () => {
			try {
				if (extractionError) {
					entry.resume();
					next();
					return;
				}
				if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
				const name = safeRelativePath(header.name);
				const target = resolveContainedPath(destination, name);
				if (header.type === 'directory') {
					await mkdir(target, { recursive: true });
					entry.resume();
					next();
					return;
				}
				if (header.type !== 'file')
					throw new Error('Archive links and special entries are not allowed');
				if ((header.size ?? 0) > MAX_ARCHIVE_ENTRY_BYTES)
					throw new Error('Archive entry exceeds the configured size limit');
				await mkdir(path.dirname(target), { recursive: true });
				let entryBytes = 0;
				const counter = new Transform({
					transform(chunk, _encoding, callback) {
						entryBytes += chunk.length;
						extractedBytes += chunk.length;
						if (entryBytes > MAX_ARCHIVE_ENTRY_BYTES || extractedBytes > maxExtractedBytes)
							callback(new Error('Extracted archive exceeds the configured size limit'));
						else {
							onExtracted?.(extractedBytes);
							callback(null, chunk);
						}
					}
				});
				await pipeline(entry, counter, createWriteStream(target, { flags: 'wx' }), { signal });
				next();
			} catch (error) {
				extractionError = error;
				entry.resume();
				next();
			}
		})();
	});

	try {
		await pipeline(createReadStream(archivePath), createGunzip(), extract, { signal });
	} catch (error) {
		throw extractionError ?? error;
	}
	if (extractionError) throw extractionError;
}

/** @param {string} archivePath */
function openZip(archivePath) {
	return new Promise((resolve, reject) => {
		yauzl.open(
			archivePath,
			{ lazyEntries: true, autoClose: true, validateEntrySizes: false },
			(error, zip) =>
				error || !zip ? reject(error ?? new Error('ZIP could not be opened')) : resolve(zip)
		);
	});
}

/** @param {import('yauzl').ZipFile} zip @param {import('yauzl').Entry} entry */
function openZipEntry(zip, entry) {
	return new Promise((resolve, reject) => {
		zip.openReadStream(entry, (error, stream) =>
			error || !stream ? reject(error ?? new Error('ZIP entry could not be read')) : resolve(stream)
		);
	});
}

/**
 * @param {{ archivePath: string, destination: string, maxExtractedBytes?: number, signal?: AbortSignal, onExtracted?: (bytes: number) => void }} input
 */
export async function extractZip({
	archivePath,
	destination,
	maxExtractedBytes = MAX_EXTRACTED_BYTES,
	signal,
	onExtracted
}) {
	await mkdir(destination, { recursive: true });
	const zip = /** @type {import('yauzl').ZipFile} */ (await openZip(archivePath));
	let extractedBytes = 0;
	await new Promise((resolve, reject) => {
		let settled = false;
		/** @param {unknown} error */
		const fail = (error) => {
			if (settled) return;
			settled = true;
			zip.close();
			reject(error);
		};
		zip.on('error', fail);
		zip.on('end', () => {
			if (!settled) {
				settled = true;
				resolve(undefined);
			}
		});
		zip.on('entry', (entry) => {
			void (async () => {
				try {
					if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
					const name = safeRelativePath(entry.fileName);
					const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
					if ((entry.generalPurposeBitFlag & 0x1) !== 0)
						throw new Error('Encrypted archive entries are not allowed');
					if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000)
						throw new Error('Archive links and special entries are not allowed');
					const target = resolveContainedPath(destination, name);
					if (name.endsWith('/')) {
						await mkdir(target, { recursive: true });
						zip.readEntry();
						return;
					}
					if (entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES)
						throw new Error('Archive entry exceeds the configured size limit');
					await mkdir(path.dirname(target), { recursive: true });
					const stream = /** @type {NodeJS.ReadableStream} */ (await openZipEntry(zip, entry));
					let entryBytes = 0;
					const counter = new Transform({
						transform(chunk, _encoding, callback) {
							entryBytes += chunk.length;
							extractedBytes += chunk.length;
							if (entryBytes > MAX_ARCHIVE_ENTRY_BYTES || extractedBytes > maxExtractedBytes)
								callback(new Error('Extracted archive exceeds the configured size limit'));
							else {
								onExtracted?.(extractedBytes);
								callback(null, chunk);
							}
						}
					});
					await pipeline(stream, counter, createWriteStream(target, { flags: 'wx' }), { signal });
					zip.readEntry();
				} catch (error) {
					fail(error);
				}
			})();
		});
		zip.readEntry();
	});
}

/**
 * @param {{ response: Response, destination: string, externalId: string, signal?: AbortSignal }} input
 */
async function installDownloadedImage({ response, destination, externalId, signal }) {
	const temporary = path.join(destination, `${safeStem(externalId)}.download`);
	await downloadResponseToFile({
		response,
		destination: temporary,
		maxBytes: MAX_CATALOG_IMAGE_BYTES,
		signal
	});
	const detected = await fileTypeFromFile(temporary);
	const extension = detected ? SUPPORTED_IMAGES.get(detected.mime) : null;
	if (!extension) throw new Error('Catalog image has an unsupported file type');
	const finalPath = path.join(destination, `${safeStem(externalId)}${extension}`);
	await rename(temporary, finalPath);
	return finalPath;
}

/**
 * @param {{ assets: CatalogAsset[], kind: 'champions' | 'augments', destination: string, fetchResponse: (url: string, init?: RequestInit) => Promise<Response>, signal?: AbortSignal, onProgress?: (completed: number, total: number) => void }} input
 */
export async function downloadCatalogImages({
	assets,
	kind,
	destination,
	fetchResponse,
	signal,
	onProgress
}) {
	const withImages = assets.filter((asset) => asset.iconPath);
	await mkdir(destination, { recursive: true });
	let cursor = 0;
	let completed = 0;
	const results = new Map();
	async function worker() {
		while (cursor < withImages.length) {
			const index = cursor++;
			const asset = withImages[index];
			const response = await fetchResponse(/** @type {string} */ (asset.iconPath), { signal });
			const installed = await installDownloadedImage({
				response,
				destination,
				externalId: `${index}-${asset.externalId}`,
				signal
			});
			results.set(asset, `/media/catalog-assets/__SNAPSHOT__/${kind}/${path.basename(installed)}`);
			completed += 1;
			onProgress?.(completed, withImages.length);
		}
	}
	const workers = Array.from({ length: Math.min(8, withImages.length) }, () => worker());
	const settled = await Promise.allSettled(workers);
	const failure = settled.find((result) => result.status === 'rejected');
	if (failure?.status === 'rejected') throw failure.reason;
	return assets.map((asset) => ({
		...asset,
		iconPath: asset.iconPath ? results.get(asset) : null
	}));
}

/**
 * @param {{ assets: CatalogAsset[], kind: 'champions' | 'augments', extractedRoot: string, destination: string, signal?: AbortSignal }} input
 */
export async function copyExtractedCatalogImages({
	assets,
	kind,
	extractedRoot,
	destination,
	signal
}) {
	await mkdir(destination, { recursive: true });
	const files = await listFiles(extractedRoot);
	const bySuffix = new Map(
		files.map((file) => [file.replaceAll('\\', '/').toLocaleLowerCase(), file])
	);
	const expectedDirectory = kind === 'champions' ? 'tft-champion' : 'tft-augment';
	const installed = [];
	for (let index = 0; index < assets.length; index += 1) {
		if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
		const asset = assets[index];
		if (!asset.iconPath) {
			installed.push({ ...asset, iconPath: null });
			continue;
		}
		const filename = path.posix.basename(asset.iconPath).toLocaleLowerCase();
		const suffix = `/img/${expectedDirectory}/${filename}`;
		const source = [...bySuffix.entries()].find(([name]) => name.endsWith(suffix))?.[1];
		if (!source) throw new Error(`Data Dragon image was missing for ${asset.externalId}`);
		const details = await stat(source);
		if (details.size > MAX_CATALOG_IMAGE_BYTES)
			throw new Error('Catalog image exceeds the size limit');
		const bytes = await readFile(source);
		const detected = await fileTypeFromBuffer(bytes);
		const extension = detected ? SUPPORTED_IMAGES.get(detected.mime) : null;
		if (!extension) throw new Error('Catalog image has an unsupported file type');
		const filenameOut = `${index}-${safeStem(asset.externalId)}${extension}`;
		await copyFile(source, path.join(destination, filenameOut));
		installed.push({
			...asset,
			iconPath: `/media/catalog-assets/__SNAPSHOT__/${kind}/${filenameOut}`
		});
	}
	return installed;
}

/** @param {string} root */
export async function listFiles(root) {
	/** @type {string[]} */
	const output = [];
	/** @param {string} directory */
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const target = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(target);
			else if (entry.isFile()) output.push(target);
		}
	}
	await visit(root);
	return output;
}

/** @param {string} root @param {string} suffix */
export async function findExtractedFile(root, suffix) {
	const normalizedSuffix = suffix.replaceAll('\\', '/').toLocaleLowerCase();
	return (await listFiles(root)).find((file) =>
		file.replaceAll('\\', '/').toLocaleLowerCase().endsWith(normalizedSuffix)
	);
}

/** @param {string} template @param {string} snapshotId */
export function pinSnapshotPath(template, snapshotId) {
	return template.replace('__SNAPSHOT__', snapshotId);
}

/** @param {string} source @param {string} destination */
async function renameCatalogDirectory(source, destination) {
	for (let attempt = 0; attempt < 6; attempt += 1) {
		try {
			await rename(source, destination);
			return;
		} catch (error) {
			const code = error instanceof Error && 'code' in error ? error.code : null;
			if (!TRANSIENT_RENAME_ERRORS.has(/** @type {string} */ (code)) || attempt === 5) throw error;
			await delay(50 * 2 ** attempt);
		}
	}
}

/** @param {string} mediaRoot @param {string} snapshotId @param {'communitydragon' | 'datadragon'} source */
export async function promoteCatalogAssets(mediaRoot, snapshotId, source) {
	const stagingAssets = resolveContainedPath(
		mediaRoot,
		`catalog-staging/${snapshotId}/${source}/assets`
	);
	const finalAssets = resolveContainedPath(mediaRoot, `catalog-assets/${snapshotId}`);
	await mkdir(path.dirname(finalAssets), { recursive: true });
	try {
		await renameCatalogDirectory(stagingAssets, finalAssets);
	} catch (error) {
		const code = error instanceof Error && 'code' in error ? error.code : null;
		if (!TRANSIENT_RENAME_ERRORS.has(/** @type {string} */ (code))) throw error;
		await mkdir(finalAssets);
		try {
			for (const sourceFile of await listFiles(stagingAssets)) {
				const relativePath = path.relative(stagingAssets, sourceFile);
				const destination = resolveContainedPath(finalAssets, relativePath);
				await mkdir(path.dirname(destination), { recursive: true });
				await copyFile(sourceFile, destination, fsConstants.COPYFILE_EXCL);
			}
		} catch (copyError) {
			await rm(finalAssets, { recursive: true, force: true });
			throw copyError;
		}
	}
	return finalAssets;
}

/** @param {string} mediaRoot @param {string} snapshotId */
export async function removeCatalogStaging(mediaRoot, snapshotId) {
	await rm(resolveContainedPath(mediaRoot, `catalog-staging/${snapshotId}`), {
		recursive: true,
		force: true
	});
}

/** @param {string} mediaRoot @param {string} snapshotId */
export async function removeCatalogAssets(mediaRoot, snapshotId) {
	await rm(resolveContainedPath(mediaRoot, `catalog-assets/${snapshotId}`), {
		recursive: true,
		force: true
	});
}

/** @param {string} mediaRoot @param {string} assetPath */
export async function readManagedCatalogAsset(mediaRoot, assetPath) {
	const normalized = safeRelativePath(assetPath);
	const catalogRoot = resolveContainedPath(mediaRoot, 'catalog-assets');
	const filename = resolveContainedPath(catalogRoot, normalized);
	const bytes = await readFile(filename);
	const detected = await fileTypeFromBuffer(bytes);
	if (!detected || !SUPPORTED_IMAGES.has(detected.mime))
		throw new Error('Unsupported catalog image');
	return { bytes, mime: detected.mime };
}
