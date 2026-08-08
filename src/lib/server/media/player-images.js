import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';

const IMAGE_EXTENSIONS = new Map([
	['image/png', '.png'],
	['image/jpeg', '.jpg'],
	['image/webp', '.webp']
]);

/**
 * Resolve an app-owned relative media path without allowing it to leave the
 * configured media root.
 *
 * @param {string} root
 * @param {string} relativePath
 */
export function resolveContainedPath(root, relativePath) {
	const absoluteRoot = path.resolve(root);
	const target = path.resolve(absoluteRoot, relativePath);
	const relative = path.relative(absoluteRoot, target);
	if (relative.startsWith('..') || path.isAbsolute(relative))
		throw new Error('Path escapes managed root');
	return target;
}

/**
 * Read an app-owned relative media path after containing it to the configured
 * media root. Callers remain responsible for validating their path namespace.
 *
 * @param {{ mediaRoot: string, relativePath: string }} input
 */
export async function readContainedManagedFile({ mediaRoot, relativePath }) {
	return readFile(resolveContainedPath(mediaRoot, relativePath));
}

/**
 * @param {{ mediaRoot: string, playerId: string, bytes: Uint8Array, mime: string }} input
 */
export async function writeManagedPlayerImage({ mediaRoot, playerId, bytes, mime }) {
	if (!/^[a-zA-Z0-9_-]+$/.test(playerId)) throw new Error('Invalid player ID');
	const extension = IMAGE_EXTENSIONS.get(mime);
	const type = await fileTypeFromBuffer(bytes);
	if (!extension || !type || type.mime !== mime)
		throw new Error('Image content does not match its MIME type');

	const directory = resolveContainedPath(mediaRoot, 'player-images');
	await mkdir(directory, { recursive: true });

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const relativePath = path.posix.join(
			'player-images',
			`${playerId}-${randomUUID()}${extension}`
		);
		try {
			await writeFile(resolveContainedPath(mediaRoot, relativePath), bytes, { flag: 'wx' });
			return relativePath;
		} catch (error) {
			if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
		}
	}

	throw new Error('Could not allocate a unique managed image path');
}

/** @param {{ mediaRoot: string, relativePath: string }} input */
export async function readManagedPlayerImage({ mediaRoot, relativePath }) {
	const normalized = relativePath.replaceAll('\\', '/');
	if (!normalized.startsWith('player-images/'))
		throw new Error('Invalid managed player image path');
	const imageRoot = resolveContainedPath(mediaRoot, 'player-images');
	return readContainedManagedFile({
		mediaRoot: imageRoot,
		relativePath: normalized.slice('player-images/'.length)
	});
}

/** @param {string} mediaRoot @param {string} relativePath */
export async function deleteManagedFile(mediaRoot, relativePath) {
	await rm(resolveContainedPath(mediaRoot, relativePath), { force: true });
}
