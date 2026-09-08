import { open, opendir, stat } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {{ gameId: string, captureId: string, receivedAt: string, installationId: string, playerName: string }} ReceiptSummary */

/** @type {Map<string, { mtimeMs: number, size: number, summary: ReceiptSummary }>} */
const receiptCache = new Map();

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

/** @param {string} directory @returns {Promise<{ count: number, latest: ReceiptSummary | null, recent: ReceiptSummary[] }>} */
async function readReceiptSummary(directory) {
	let entries;
	try {
		entries = await opendir(directory);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT')
			return { count: 0, latest: null, recent: [] };
		throw error;
	}
	let count = 0;
	const candidates = [];
	for await (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
		const filename = path.join(directory, entry.name);
		const { mtimeMs, size } = await stat(filename);
		candidates.push({ filename, mtimeMs, size });
		if (++count === 1000) break;
	}
	const recent = [];
	for (const candidate of candidates.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 25)) {
		const cached = receiptCache.get(candidate.filename);
		if (cached?.mtimeMs === candidate.mtimeMs && cached.size === candidate.size) {
			recent.push(cached.summary);
			continue;
		}
		const summary = await readReceiptMetadata(candidate.filename);
		if (receiptCache.size >= 25) {
			const oldest = receiptCache.keys().next().value;
			if (oldest) receiptCache.delete(oldest);
		}
		receiptCache.set(candidate.filename, { ...candidate, summary });
		recent.push(summary);
	}
	recent.sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
	return { count, latest: recent[0] ?? null, recent };
}

/** @param {string} filename @returns {Promise<ReceiptSummary>} */
async function readReceiptMetadata(filename) {
	const receipt = await readJson(filename, 32 * 1024 * 1024);
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
	const installationId = receipt.capture.installationId;
	const localPlayer = receipt.capture.localPlayer;
	const gameName =
		typeof localPlayer?.gameName === 'string' ? localPlayer.gameName.slice(0, 128) : '';
	const tagLine = typeof localPlayer?.tagLine === 'string' ? localPlayer.tagLine.slice(0, 32) : '';
	return {
		gameId,
		captureId,
		receivedAt,
		installationId:
			typeof installationId === 'string' && /^[a-f0-9-]{36}$/i.test(installationId)
				? installationId
				: '',
		playerName: gameName ? `${gameName}${tagLine ? `#${tagLine}` : ''}` : ''
	};
}

/**
 * @param {string} mediaRoot
 * @returns {Promise<{ passwordState: 'waiting' | 'configured' | 'unavailable', receiptCount: number, latestReceipt: ReceiptSummary | null, recentReceipts: ReceiptSummary[] }>}
 */
export async function readRelayOperatorStatus(mediaRoot) {
	const root = path.resolve(mediaRoot, 'player-relay');
	try {
		const passwordState = await readVerifierState(path.join(root, 'relay-password.json'));
		if (passwordState === 'unavailable')
			return { passwordState, receiptCount: 0, latestReceipt: null, recentReceipts: [] };
		const receipts = await readReceiptSummary(path.join(root, 'receipts'));
		return {
			passwordState,
			receiptCount: receipts.count,
			latestReceipt: receipts.latest,
			recentReceipts: receipts.recent
		};
	} catch {
		return {
			passwordState: 'unavailable',
			receiptCount: 0,
			latestReceipt: null,
			recentReceipts: []
		};
	}
}
