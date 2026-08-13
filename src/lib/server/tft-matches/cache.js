import { randomBytes } from 'node:crypto';

export const PREVIEW_TTL_MS = 15 * 60_000;
export const MAX_PREVIEW_BATCHES = 32;

const previews = new Map();

/** @param {Date | number | undefined} value */
function timestamp(value) {
	if (value instanceof Date) return value.getTime();
	return typeof value === 'number' ? value : Date.now();
}

/** @param {number} now */
function deleteExpired(now) {
	for (const [token, batch] of previews) {
		if (batch.expiresAt <= now) previews.delete(token);
	}
}

/**
 * @param {Record<string, any>} batch
 * @param {{ now?: Date | number, tokenFactory?: () => string }} [options]
 */
export function storeTftMatchPreviewBatch(batch, options = {}) {
	const now = timestamp(options.now);
	deleteExpired(now);
	const token = options.tokenFactory?.() ?? randomBytes(32).toString('base64url');
	previews.set(
		token,
		structuredClone({ ...batch, createdAt: now, expiresAt: now + PREVIEW_TTL_MS })
	);
	while (previews.size > MAX_PREVIEW_BATCHES) previews.delete(previews.keys().next().value);
	return token;
}

/** @param {string} token @param {{ now?: Date | number }} [options] */
export function getTftMatchPreviewBatch(token, options = {}) {
	const now = timestamp(options.now);
	deleteExpired(now);
	const batch = previews.get(token);
	return batch ? structuredClone(batch) : null;
}

/** @param {string} token */
export function deleteTftMatchPreviewBatch(token) {
	return previews.delete(token);
}

export function clearTftMatchPreviewCacheForTests() {
	previews.clear();
}
