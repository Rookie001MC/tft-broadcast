import path from 'node:path';
import { Buffer } from 'node:buffer';
import { parse } from 'csv-parse/sync';
import { fileTypeFromBuffer } from 'file-type';
import yauzl from 'yauzl';
import { normalizeRiotId } from './riot-id.js';

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const REQUIRED_COLUMNS = ['full_name', 'display_name', 'riot_id'];
const IMAGE_TYPES = new Map([
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.jpeg', 'image/jpeg'],
	['.webp', 'image/webp']
]);

/** @typedef {import('yauzl').Entry} ZipEntry */
/** @typedef {import('yauzl').ZipFile} ZipFile */
/** @typedef {{ entry: ZipEntry, name: string }} BundleEntry */
/** @typedef {{ path: string, key: string, mime: string }} PlayerImage */
/** @typedef {{ code: string, row?: number, key?: string, path?: string, message?: string, columns?: string[], rows?: number[], paths?: string[] }} PreviewIssue */
/** @typedef {{ id?: unknown, riotIdKey?: unknown, riotId?: unknown }} ExistingPlayer */
/** @typedef {Record<string, unknown>} CsvRecord */
/** @typedef {{ rowNumber: number, fullName: string, displayName: string, riotId: string, action: 'create' | 'update' | 'skip', riotIdKey?: string, imageKey?: string, gameName?: string, tagline?: string, existingPlayerId?: unknown, image?: PlayerImage, _errors?: PreviewIssue[] }} PreviewRow */

/** @param {Error} error */
function zipError(error) {
	return /absolute path|invalid relative path/i.test(error.message)
		? new Error('Unsafe ZIP entry path')
		: error;
}

/** @param {unknown} error */
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

/** @param {Uint8Array | Buffer} zipBytes @returns {Promise<ZipFile>} */
function openZip(zipBytes) {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(
			Buffer.from(zipBytes),
			{ lazyEntries: true, validateEntrySizes: false },
			(/** @type {Error | null} */ error, /** @type {ZipFile} */ zip) => {
				if (error) reject(zipError(error));
				else resolve(zip);
			}
		);
	});
}

/** @param {ZipFile} zip @returns {() => void} */
function closeZipOnce(zip) {
	let closed = false;
	return () => {
		if (closed) return;
		closed = true;
		zip.close();
	};
}

/**
 * @param {ZipFile} zip
 * @param {ZipEntry} entry
 * @param {{ total: number }} counters
 * @param {() => void} closeZip
 * @returns {Promise<Buffer>}
 */
function readEntry(zip, entry, counters, closeZip) {
	return new Promise((resolve, reject) => {
		zip.openReadStream(entry, (/** @type {Error | null} */ openError, stream) => {
			if (openError || !stream) {
				closeZip();
				reject(openError ?? new Error('Could not read ZIP entry'));
				return;
			}
			/** @type {Buffer[]} */
			const chunks = [];
			let entryBytes = 0;
			let settled = false;
			/** @type {Error | null} */
			let pendingError = null;

			const cleanup = () => {
				stream.removeListener('data', onData);
				stream.removeListener('error', onError);
				stream.removeListener('end', onEnd);
				stream.removeListener('close', onClose);
			};
			/** @param {Error | null} error */
			const settle = (error) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (error) {
					closeZip();
					reject(error);
				} else resolve(Buffer.concat(chunks));
			};
			/** @param {Buffer} chunk */
			const onData = (chunk) => {
				if (pendingError) return;
				entryBytes += chunk.length;
				counters.total += chunk.length;
				if (entryBytes > MAX_EXPANDED_BYTES || counters.total > MAX_EXPANDED_BYTES) {
					pendingError = new Error('ZIP expanded size is too large');
					stream.destroy(pendingError);
					return;
				}
				chunks.push(chunk);
			};
			/** @param {Error} error */
			const onError = (error) => settle(error);
			const onEnd = () => settle(null);
			const onClose = () => settle(pendingError ?? new Error('Could not read ZIP entry'));

			stream.on('data', onData);
			stream.once('error', onError);
			stream.once('end', onEnd);
			stream.once('close', onClose);
		});
	});
}

/** @param {ZipEntry} entry */
function normalizedEntryName(entry) {
	return entry.fileName.replaceAll('\\', '/');
}

/** @param {ZipEntry} entry */
function isSymlink(entry) {
	return ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

/** @param {string} name */
function assertSafeEntryName(name) {
	if (
		path.posix.isAbsolute(name) ||
		name.split('/').includes('..') ||
		(!name.startsWith('player_images/') && name !== 'players.csv')
	) {
		throw new Error('Unsafe ZIP entry path');
	}
	if (path.posix.extname(name).toLocaleLowerCase('en-US') === '.zip') {
		throw new Error('Nested ZIP entries are not supported');
	}
}

/**
 * Reads ZIP entries one at a time, rejecting unsafe metadata before their
 * contents are opened.
 *
 * @param {Uint8Array | Buffer} zipBytes
 * @returns {Promise<BundleEntry[]>}
 */
async function collectEntries(zipBytes) {
	const zip = await openZip(zipBytes);
	/** @type {BundleEntry[]} */
	const entries = [];
	let declaredExpandedBytes = 0;

	return new Promise((resolve, reject) => {
		let settled = false;
		const fail = (/** @type {Error} */ error) => {
			if (settled) return;
			settled = true;
			zip.close();
			reject(error);
		};
		const succeed = () => {
			if (settled) return;
			settled = true;
			zip.close();
			resolve(entries);
		};

		zip.once('error', (/** @type {Error} */ error) => fail(zipError(error)));
		zip.on('entry', (/** @type {ZipEntry} */ entry) => {
			try {
				if (entry.generalPurposeBitFlag & 0x1)
					throw new Error('Encrypted ZIP entries are not supported');
				if (isSymlink(entry)) throw new Error('ZIP symlinks are not supported');
				const name = normalizedEntryName(entry);
				assertSafeEntryName(name);

				if (entries.length + 1 > MAX_ENTRIES) throw new Error('ZIP contains too many entries');
				declaredExpandedBytes += entry.uncompressedSize;
				if (declaredExpandedBytes > MAX_EXPANDED_BYTES)
					throw new Error('ZIP expanded size is too large');

				entries.push({ entry, name });
				zip.readEntry();
			} catch (error) {
				fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
		zip.once('end', succeed);
		zip.readEntry();
	});
}

/**
 * Reopens a validated bundle and returns the bytes for the exact image paths
 * selected by its preview.
 *
 * @param {Uint8Array | Buffer} zipBytes
 * @param {string[]} imagePaths
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function readPlayerBundleImages(zipBytes, imagePaths) {
	const requested = new Set(imagePaths);
	if (requested.size !== imagePaths.length) throw new Error('Duplicate requested image path');
	const entries = await collectEntries(zipBytes);
	const selected = entries.filter(({ name }) => requested.has(name));
	if (selected.length !== requested.size) throw new Error('Previewed image is missing from bundle');

	const zip = await openZip(zipBytes);
	const closeZip = closeZipOnce(zip);
	try {
		const images = new Map();
		const counters = { total: 0 };
		for (const { entry, name } of selected)
			images.set(name, await readEntry(zip, entry, counters, closeZip));
		return images;
	} finally {
		closeZip();
	}
}

/** @param {string} value */
function key(value) {
	return value.trim().toLocaleLowerCase('en-US');
}

/** @param {unknown} value */
function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @param {ExistingPlayer[]} existingPlayers @returns {Map<string, ExistingPlayer>} */
function existingByRiotId(existingPlayers) {
	/** @type {Map<string, ExistingPlayer>} */
	const players = new Map();
	for (const player of existingPlayers) {
		const riotIdKey = text(player.riotIdKey);
		if (riotIdKey) players.set(key(riotIdKey), player);
		else if (typeof player.riotId === 'string') {
			try {
				players.set(normalizeRiotId(player.riotId).riotIdKey, player);
			} catch {
				// Existing invalid legacy IDs cannot be matched by a valid import row.
			}
		}
	}
	return players;
}

/**
 * Inspect an uploaded player bundle without making database or media writes.
 *
 * @param {Uint8Array | Buffer} zipBytes
 * @param {ExistingPlayer[]} existingPlayers
 */
export async function inspectPlayerBundle(zipBytes, existingPlayers = []) {
	if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength > MAX_ZIP_BYTES) {
		throw new Error('ZIP file is too large');
	}

	const entries = await collectEntries(zipBytes);
	const csvEntries = entries.filter(({ name }) => name === 'players.csv');
	if (csvEntries.length !== 1) throw new Error('ZIP must contain exactly one players.csv');

	const zip = await openZip(zipBytes);
	const closeZip = closeZipOnce(zip);
	try {
		const counters = { total: 0 };
		const csvBytes = await readEntry(zip, csvEntries[0].entry, counters, closeZip);
		const imageEntries = entries.filter(
			({ name }) => name.startsWith('player_images/') && !name.endsWith('/')
		);
		/** @type {PlayerImage[]} */
		const images = [];
		/** @type {PreviewIssue[]} */
		const errors = [];
		/** @type {PreviewIssue[]} */
		const warnings = [];

		for (const { entry, name } of imageEntries) {
			const extension = path.posix.extname(name).toLocaleLowerCase('en-US');
			const expectedMime = IMAGE_TYPES.get(extension);
			if (!expectedMime) {
				errors.push({ code: 'unsupported_image_extension', path: name });
				continue;
			}

			const bytes = await readEntry(zip, entry, counters, closeZip);
			const type = await fileTypeFromBuffer(bytes);
			if (!type || !IMAGE_TYPES.has(`.${type.ext}`) || type.mime !== expectedMime) {
				errors.push({ code: 'image_type_mismatch', path: name });
				continue;
			}

			const basename = path.posix.basename(name);
			images.push({ path: name, key: key(basename.slice(0, -extension.length)), mime: type.mime });
		}

		/** @type {Map<string, PlayerImage[]>} */
		const imagesByKey = new Map();
		for (const image of images) {
			const candidates = imagesByKey.get(image.key) ?? [];
			candidates.push(image);
			imagesByKey.set(image.key, candidates);
		}
		for (const [imageKey, candidates] of imagesByKey) {
			if (candidates.length > 1)
				warnings.push({
					code: 'duplicate_image',
					key: imageKey,
					paths: candidates.map(({ path }) => path)
				});
		}

		/** @type {CsvRecord[]} */
		let records;
		/** @type {string[]} */
		let columns = [];
		try {
			records = /** @type {CsvRecord[]} */ (
				parse(csvBytes.toString('utf8'), {
					columns: (/** @type {string[]} */ header) => {
						columns = header.map((column) => text(column));
						return columns;
					},
					bom: true,
					skip_empty_lines: true,
					trim: true,
					relax_column_count: false
				})
			);
		} catch (error) {
			return {
				rows: [],
				errors: [...errors, { code: 'invalid_csv', message: errorMessage(error) }],
				warnings,
				matchedImages: [],
				unmatchedImages: images,
				canCommit: false
			};
		}

		const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
		if (missingColumns.length > 0) {
			return {
				rows: [],
				errors: [...errors, { code: 'missing_required_columns', columns: missingColumns }],
				warnings,
				matchedImages: [],
				unmatchedImages: images,
				canCommit: false
			};
		}

		/** @type {PreviewRow[]} */
		const rows = [];
		const existing = existingByRiotId(existingPlayers);
		/** @type {Map<string, PreviewRow[]>} */
		const riotRows = new Map();
		/** @type {Map<string, PreviewRow[]>} */
		const displayRows = new Map();

		for (const [index, record] of records.entries()) {
			const rowNumber = index + 2;
			const fullName = text(record.full_name);
			const displayName = text(record.display_name);
			const rawRiotId = text(record.riot_id);
			/** @type {PreviewRow} */
			const row = {
				rowNumber,
				fullName,
				displayName,
				riotId: rawRiotId,
				action: 'skip',
				_errors: []
			};
			const rowErrors = /** @type {PreviewIssue[]} */ (row._errors);

			if (!fullName) rowErrors.push({ code: 'missing_full_name', row: rowNumber });
			if (!displayName) rowErrors.push({ code: 'missing_display_name', row: rowNumber });
			let normalized;
			try {
				normalized = normalizeRiotId(rawRiotId);
				Object.assign(row, normalized);
			} catch (error) {
				rowErrors.push({ code: 'invalid_riot_id', row: rowNumber, message: errorMessage(error) });
			}

			const splitName = text(record.riot_game_name);
			const splitTagline = text(record.riot_tagline);
			if (splitName || splitTagline) {
				try {
					const split = normalizeRiotId(`${splitName}#${splitTagline}`);
					if (!normalized || split.riotIdKey !== normalized.riotIdKey) {
						rowErrors.push({ code: 'riot_id_mismatch', row: rowNumber });
					}
				} catch {
					rowErrors.push({ code: 'riot_id_mismatch', row: rowNumber });
				}
			}

			if (normalized) {
				const duplicateRiotRows = riotRows.get(normalized.riotIdKey) ?? [];
				duplicateRiotRows.push(row);
				riotRows.set(normalized.riotIdKey, duplicateRiotRows);
			}
			if (displayName) {
				const displayKey = key(displayName);
				const duplicateDisplayRows = displayRows.get(displayKey) ?? [];
				duplicateDisplayRows.push(row);
				displayRows.set(displayKey, duplicateDisplayRows);
			}

			row._errors = rowErrors;
			rows.push(row);
		}

		for (const [riotIdKey, duplicateRows] of riotRows) {
			if (duplicateRows.length > 1) {
				errors.push({
					code: 'duplicate_riot_id',
					key: riotIdKey,
					rows: duplicateRows.map(({ rowNumber }) => rowNumber)
				});
				for (const row of duplicateRows)
					/** @type {PreviewIssue[]} */ (row._errors).push({
						code: 'duplicate_riot_id',
						key: riotIdKey
					});
			}
		}
		for (const [displayNameKey, duplicateRows] of displayRows) {
			if (duplicateRows.length > 1) {
				errors.push({
					code: 'duplicate_display_name',
					key: displayNameKey,
					rows: duplicateRows.map(({ rowNumber }) => rowNumber)
				});
				for (const row of duplicateRows)
					/** @type {PreviewIssue[]} */ (row._errors).push({
						code: 'duplicate_display_name',
						key: displayNameKey
					});
			}
		}

		/** @type {PlayerImage[]} */
		const matchedImages = [];
		const imageKeysUsed = new Set();
		for (const row of rows) {
			const rowErrors = row._errors ?? [];
			if (rowErrors.length === 0 && row.riotIdKey && row.imageKey) {
				const player = existing.get(row.riotIdKey);
				row.action = player ? 'update' : 'create';
				if (player?.id) row.existingPlayerId = player.id;
				const candidates = imagesByKey.get(row.imageKey) ?? [];
				if (candidates.length === 1) {
					row.image = candidates[0];
					matchedImages.push(candidates[0]);
					imageKeysUsed.add(candidates[0].key);
				}
			}
			if (rowErrors.length > 0)
				errors.push(...rowErrors.map((error) => ({ ...error, row: row.rowNumber })));
			delete row._errors;
		}

		const unmatchedImages = images.filter((image) => !imageKeysUsed.has(image.key));
		for (const image of unmatchedImages)
			warnings.push({ code: 'unmatched_image', path: image.path });

		return {
			rows,
			errors,
			warnings,
			matchedImages,
			unmatchedImages,
			canCommit: errors.length === 0
		};
	} finally {
		closeZip();
	}
}
