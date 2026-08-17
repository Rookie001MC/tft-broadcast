import { randomBytes } from 'node:crypto';

export const PREVIEW_TTL_MS = 15 * 60 * 1000;
export const MAX_PREVIEW_BATCHES = 32;

/** @type {Map<string, { expiresAt: number, batch: any }>} */
const previewBatches = new Map();

/** @param {number} now */
function removeExpired(now) {
	for (const [token, entry] of previewBatches) {
		if (entry.expiresAt <= now) previewBatches.delete(token);
	}
}

/** @param {Date | number | undefined} value */
function timestamp(value) {
	if (value instanceof Date) return value.getTime();
	if (typeof value === 'number') return value;
	return Date.now();
}

/**
 * @param {any} batch
 * @param {{ now?: Date | number, tokenFactory?: () => string }} [options]
 */
export function storeTftMatchPreviewBatch(batch, options = {}) {
	const now = timestamp(options.now);
	removeExpired(now);
	let token;
	do {
		token = options.tokenFactory?.() ?? randomBytes(32).toString('base64url');
	} while (previewBatches.has(token));
	previewBatches.set(token, {
		expiresAt: now + PREVIEW_TTL_MS,
		batch: structuredClone(batch)
	});
	while (previewBatches.size > MAX_PREVIEW_BATCHES) {
		const oldestToken = previewBatches.keys().next().value;
		if (oldestToken === undefined) break;
		previewBatches.delete(oldestToken);
	}
	return token;
}

/** @param {string} token @param {{ now?: Date | number }} [options] */
export function getTftMatchPreviewBatch(token, options = {}) {
	removeExpired(timestamp(options.now));
	const entry = previewBatches.get(token);
	return entry ? structuredClone(entry.batch) : null;
}

/** @param {string} token */
export function deleteTftMatchPreviewBatch(token) {
	return previewBatches.delete(token);
}

export function clearTftMatchPreviewCacheForTests() {
	previewBatches.clear();
}
