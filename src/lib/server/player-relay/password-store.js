import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const FORMAT = 1;
const SALT_BYTES = 16;
const VERIFIER_BYTES = 32;
const MAX_PASSWORD_BYTES = 4 * 1024;

/** @param {string} mediaRoot */
export function createRelayPasswordStore(mediaRoot) {
	const credentialPath = path.resolve(mediaRoot, 'player-relay', 'relay-password.json');
	let writes = Promise.resolve();

	/**
	 * @template T
	 * @param {() => Promise<T>} operation
	 * @returns {Promise<T>}
	 */
	const exclusively = (operation) => {
		const pending = writes.then(operation, operation);
		writes = pending.then(
			() => undefined,
			() => undefined
		);
		return pending;
	};

	return {
		/** @param {unknown} password */
		bootstrap: (password) => exclusively(() => bootstrap(credentialPath, password)),
		/** @param {unknown} currentPassword @param {unknown} nextPassword */
		rotate: (currentPassword, nextPassword) =>
			exclusively(() => rotate(credentialPath, currentPassword, nextPassword)),
		/** @param {unknown} password */
		verify: (password) => verify(credentialPath, password)
	};
}

/** @param {string} credentialPath @param {unknown} password */
async function bootstrap(credentialPath, password) {
	if (!isValidPassword(password)) return { status: 'invalid' };
	try {
		const existing = await readCredential(credentialPath);
		if (existing) return { status: 'already_initialized' };
		const credential = await createCredential(password);
		await writeNewCredential(credentialPath, credential);
		return { status: 'initialized' };
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST')
			return { status: 'already_initialized' };
		return { status: 'unavailable' };
	}
}

/** @param {string} credentialPath @param {unknown} currentPassword @param {unknown} nextPassword */
async function rotate(credentialPath, currentPassword, nextPassword) {
	if (!isValidPassword(nextPassword)) return { status: 'invalid' };
	try {
		const current = await readCredential(credentialPath);
		if (!current || !isValidPassword(currentPassword) || !(await matches(current, currentPassword)))
			return { status: 'authentication_failed' };
		await replaceCredential(credentialPath, await createCredential(nextPassword));
		return { status: 'rotated' };
	} catch {
		return { status: 'unavailable' };
	}
}

/** @param {string} credentialPath @param {unknown} password */
async function verify(credentialPath, password) {
	if (!isValidPassword(password)) return false;
	try {
		const credential = await readCredential(credentialPath);
		return credential ? await matches(credential, password) : false;
	} catch {
		return false;
	}
}

/** @param {unknown} password @returns {password is string} */
function isValidPassword(password) {
	return (
		typeof password === 'string' &&
		!/^\s*$/u.test(password) &&
		Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
	);
}

/** @param {string} credentialPath */
async function readCredential(credentialPath) {
	try {
		const candidate = JSON.parse(await readFile(credentialPath, 'utf8'));
		if (
			!candidate ||
			candidate.format !== FORMAT ||
			typeof candidate.salt !== 'string' ||
			typeof candidate.verifier !== 'string'
		)
			return null;
		const salt = decodeBase64(candidate.salt, SALT_BYTES);
		const verifier = decodeBase64(candidate.verifier, VERIFIER_BYTES);
		return salt && verifier ? { salt, verifier } : null;
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
		throw error;
	}
}

/** @param {string} value @param {number} expectedLength */
function decodeBase64(value, expectedLength) {
	const decoded = Buffer.from(value, 'base64');
	return decoded.length === expectedLength && decoded.toString('base64') === value ? decoded : null;
}

/** @param {string} password */
async function createCredential(password) {
	const salt = randomBytes(SALT_BYTES);
	const verifier = Buffer.from(await scrypt(password, salt, VERIFIER_BYTES));
	return { format: FORMAT, salt: salt.toString('base64'), verifier: verifier.toString('base64') };
}

/** @param {{ salt: Buffer, verifier: Buffer }} credential @param {string} password */
async function matches(credential, password) {
	const candidate = Buffer.from(await scrypt(password, credential.salt, VERIFIER_BYTES));
	return (
		candidate.length === credential.verifier.length &&
		timingSafeEqual(candidate, credential.verifier)
	);
}

/** @param {string} credentialPath @param {{ format: number, salt: string, verifier: string }} credential */
async function writeNewCredential(credentialPath, credential) {
	await mkdir(path.dirname(credentialPath), { recursive: true });
	await writeFile(credentialPath, JSON.stringify(credential), {
		encoding: 'utf8',
		flag: 'wx',
		mode: 0o600
	});
}

/** @param {string} credentialPath @param {{ format: number, salt: string, verifier: string }} credential */
async function replaceCredential(credentialPath, credential) {
	const temporaryPath = `${credentialPath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
	try {
		await writeFile(temporaryPath, JSON.stringify(credential), {
			encoding: 'utf8',
			flag: 'wx',
			mode: 0o600
		});
		await rename(temporaryPath, credentialPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
