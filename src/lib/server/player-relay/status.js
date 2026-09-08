import { open, opendir, stat } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {{ gameId: string, captureId: string, receivedAt: string }} ReceiptSummary */

/** @param {string} filename @param {number} maxBytes */
async function readJson(filename, maxBytes) {
	const file = await open(filename, 'r');
	try {
		const size = (await file.stat()).size;
		if (size > maxBytes) throw Error('Relay file too large');
		const buffer = Buffer.alloc(size + 1);
		const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
		if (bytesRead > size) throw Error('Relay file changed');
		return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
	} finally {
		await file.close();
	}
}

/** @param {string} filename @returns {Promise<'waiting' | 'configured' | 'unavailable'>} */
async function readVerifierState(filename) {
	try {
		const value = await readJson(filename, 4096);
		return value?.format === 1 &&
			typeof value.salt === 'string' &&
			/^[A-Za-z0-9+/]{22}==$/.test(value.salt) &&
			typeof value.verifier === 'string' &&
			/^[A-Za-z0-9+/]{43}=$/.test(value.verifier)
			? 'configured'
			: 'unavailable';
	} catch (error) {
		return /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
			? 'waiting'
			: 'unavailable';
	}
}

/** @param {string} directory @returns {Promise<{ count: number, latest: ReceiptSummary | null }>} */
async function readReceiptSummary(directory) {
	let entries;
	try {
		entries = await opendir(directory);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT')
			return { count: 0, latest: null };
		throw error;
	}
	let count = 0;
	let newest = '';
	let newestTime = -Infinity;
	for await (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
		const filename = path.join(directory, entry.name);
		const { mtimeMs } = await stat(filename);
		if (mtimeMs > newestTime) {
			newest = filename;
			newestTime = mtimeMs;
		}
		if (++count === 1000) break;
	}
	if (!newest) return { count, latest: null };
	const receipt = await readJson(newest, 32 * 1024 * 1024);
	const gameId = receipt?.capture?.gameId;
	const captureId = receipt?.capture?.captureId;
	const receivedAt = receipt?.receivedAt;
	if (
		typeof gameId !== 'string' ||
		!gameId ||
		gameId.length > 128 ||
		typeof captureId !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId) ||
		typeof receivedAt !== 'string' ||
		receivedAt.length > 64 ||
		!Number.isFinite(Date.parse(receivedAt))
	)
		throw Error('Invalid relay receipt metadata');
	return { count, latest: { gameId, captureId, receivedAt } };
}

/**
 * @param {string} mediaRoot
 * @returns {Promise<{ passwordState: 'waiting' | 'configured' | 'unavailable', receiptCount: number, latestReceipt: ReceiptSummary | null }>}
 */
export async function readRelayOperatorStatus(mediaRoot) {
	const root = path.resolve(mediaRoot, 'player-relay');
	try {
		const passwordState = await readVerifierState(path.join(root, 'relay-password.json'));
		if (passwordState === 'unavailable')
			return { passwordState, receiptCount: 0, latestReceipt: null };
		const receipts = await readReceiptSummary(path.join(root, 'receipts'));
		return { passwordState, receiptCount: receipts.count, latestReceipt: receipts.latest };
	} catch {
		return { passwordState: 'unavailable', receiptCount: 0, latestReceipt: null };
	}
}
