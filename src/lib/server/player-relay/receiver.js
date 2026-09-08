import { createHash } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { createRelayPasswordStore } from './password-store.js';

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const CAPTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const passwordStore = createRelayPasswordStore(env.MEDIA_ROOT || 'media');

/** @param {Request} request */
export async function isAuthorized(request) {
	const supplied = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
	return supplied ? passwordStore.verify(supplied) : false;
}

/** @param {unknown} password */
export function bootstrapPassword(password) {
	return passwordStore.bootstrap(password);
}

/** @param {Request} request @param {unknown} nextPassword */
export async function rotatePassword(request, nextPassword) {
	const currentPassword = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
	return passwordStore.rotate(currentPassword, nextPassword);
}

/** @param {unknown} value @returns {any | null} */
function validCapture(value) {
	if (!value || typeof value !== 'object') return null;
	const capture = /** @type {Record<string, unknown>} */ (value);
	if (
		capture.protocolVersion !== 1 ||
		typeof capture.captureId !== 'string' ||
		!CAPTURE_ID.test(capture.captureId)
	)
		return null;
	if (
		typeof capture.payloadJson !== 'string' ||
		Buffer.byteLength(capture.payloadJson, 'utf8') > MAX_PAYLOAD_BYTES
	)
		return null;
	if (typeof capture.payloadSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(capture.payloadSha256))
		return null;
	try {
		if (!JSON.parse(capture.payloadJson) || typeof JSON.parse(capture.payloadJson) !== 'object')
			return null;
	} catch {
		return null;
	}
	const hash = createHash('sha256').update(capture.payloadJson, 'utf8').digest('hex');
	return hash === capture.payloadSha256 ? capture : null;
}

/** @param {Request} request */
export async function receiveCapture(request) {
	const contentLength = Number(request.headers.get('content-length') ?? 0);
	if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES)
		return { status: 413, body: { code: 'payload_too_large' } };
	const text = await request.text();
	if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BYTES)
		return { status: 413, body: { code: 'payload_too_large' } };
	let input;
	try {
		input = JSON.parse(text);
	} catch {
		return { status: 400, body: { code: 'invalid_envelope' } };
	}
	const capture = validCapture(input);
	if (
		!capture ||
		request.headers.get('idempotency-key')?.toLowerCase() !== capture.captureId.toLowerCase()
	)
		return { status: 400, body: { code: 'invalid_envelope' } };
	const root = path.resolve(env.MEDIA_ROOT || 'media', 'player-relay', 'receipts');
	const receiptPath = path.join(root, `${capture.captureId.toLowerCase()}.json`);
	const receivedAt = new Date().toISOString();
	const receipt = JSON.stringify({ capture, receivedAt });
	await mkdir(root, { recursive: true });
	try {
		const temporary = `${receiptPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
		await writeFile(temporary, receipt, { flag: 'wx' });
		await link(temporary, receiptPath);
		await rm(temporary, { force: true });
		return { status: 201, body: { captureId: capture.captureId, status: 'stored', receivedAt } };
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
		const existing = JSON.parse(await readFile(receiptPath, 'utf8'));
		if (existing?.capture?.payloadSha256 !== capture.payloadSha256)
			return { status: 409, body: { code: 'id_content_conflict' } };
		return {
			status: 200,
			body: { captureId: capture.captureId, status: 'duplicate', receivedAt: existing.receivedAt }
		};
	}
}

export function handshake() {
	return {
		protocolVersion: 1,
		serverId: env.PLAYER_RELAY_SERVER_ID || 'local-server',
		eventId: env.PLAYER_RELAY_EVENT_ID || 'unconfigured',
		maxPayloadBytes: MAX_PAYLOAD_BYTES
	};
}
