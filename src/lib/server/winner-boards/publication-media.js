import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import {
	readContainedManagedFile,
	readManagedPlayerImage,
	resolveContainedPath
} from '$lib/server/media/player-images.js';

const PUBLICATION_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_IMAGES = new Map([
	['image/png', '.png'],
	['image/jpeg', '.jpg'],
	['image/webp', '.webp']
]);
const PUBLICATION_MEDIA_NOT_FOUND = 'Publication media was not found';

/** @param {string} publicationId */
export function isPublicationId(publicationId) {
	return PUBLICATION_ID_PATTERN.test(publicationId);
}

/** @param {string} publicationId @param {string} filename */
export function isPublicationMediaFilename(publicationId, filename) {
	if (!isPublicationId(publicationId)) return false;
	const escapedId = publicationId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(
		`^(?:winner|champion-[0-9]+|augment-[0-9]+)-${escapedId}\\.(?:png|jpg|webp)$`,
		'i'
	).test(filename);
}

/**
 * @param {string} mediaRoot
 * @param {string | null} sourcePath
 * @param {'winner' | 'catalog'} namespace
 */
async function loadSourceImage(mediaRoot, sourcePath, namespace) {
	if (sourcePath === null) return null;
	if (typeof sourcePath !== 'string') throw new Error('Publication source image is invalid');

	let bytes;
	if (namespace === 'winner') {
		const normalized = sourcePath.replaceAll('\\', '/');
		if (!normalized.startsWith('player-images/'))
			throw new Error('Publication source image is invalid');
		try {
			bytes = await readManagedPlayerImage({ mediaRoot, relativePath: normalized });
		} catch {
			throw new Error('Publication source image is invalid or unsupported');
		}
	} else {
		const prefix = '/media/catalog-assets/';
		if (!sourcePath.startsWith(prefix)) throw new Error('Publication source image is invalid');
		try {
			bytes = await readContainedManagedFile({
				mediaRoot: resolveContainedPath(mediaRoot, 'catalog-assets'),
				relativePath: sourcePath.slice(prefix.length)
			});
		} catch {
			throw new Error('Publication source image is invalid or unsupported');
		}
	}

	try {
		const detected = await fileTypeFromBuffer(bytes);
		const extension = detected ? SUPPORTED_IMAGES.get(detected.mime) : null;
		if (!detected || !extension) throw new Error('Unsupported publication image');
		return { bytes, mime: detected.mime, extension };
	} catch {
		throw new Error('Publication source image is invalid or unsupported');
	}
}

/**
 * @param {{
 *   mediaRoot: string,
 *   publicationId: string,
 *   winnerImagePath: string | null,
 *   championIconPaths: Array<string | null>,
 *   augmentIconPaths: Array<string | null>
 * }} input
 */
export async function preparePublicationMedia({
	mediaRoot,
	publicationId,
	winnerImagePath,
	championIconPaths,
	augmentIconPaths
}) {
	if (!isPublicationId(publicationId)) throw new Error('Invalid publication ID');
	if (!Array.isArray(championIconPaths) || !Array.isArray(augmentIconPaths))
		throw new Error('Invalid publication media input');

	const winner = await loadSourceImage(mediaRoot, winnerImagePath, 'winner');
	const champions = await Promise.all(
		championIconPaths.map((sourcePath) => loadSourceImage(mediaRoot, sourcePath, 'catalog'))
	);
	const augments = await Promise.all(
		augmentIconPaths.map((sourcePath) => loadSourceImage(mediaRoot, sourcePath, 'catalog'))
	);
	const relativeDirectory = `publications/${publicationId}`;
	const publicationsRoot = resolveContainedPath(mediaRoot, 'publications');
	const destination = resolveContainedPath(mediaRoot, relativeDirectory);
	let created = false;

	/** @param {string} filename */
	const urlFor = (filename) => `/media/${relativeDirectory}/${filename}`;
	/** @param {string} kind @param {number | null} index @param {{ extension: string } | null} asset */
	const filenameFor = (kind, index, asset) =>
		asset === null
			? null
			: `${kind}${index === null ? '' : `-${index}`}-${publicationId}${asset.extension}`;

	const winnerFilename = filenameFor('winner', null, winner);
	const championFilenames = champions.map((asset, index) => filenameFor('champion', index, asset));
	const augmentFilenames = augments.map((asset, index) => filenameFor('augment', index, asset));

	try {
		await mkdir(publicationsRoot, { recursive: true });
		await mkdir(destination);
		created = true;
		if (winner && winnerFilename) {
			await writeFile(resolveContainedPath(destination, winnerFilename), winner.bytes, {
				flag: 'wx'
			});
		}
		for (let index = 0; index < champions.length; index += 1) {
			const asset = champions[index];
			const filename = championFilenames[index];
			if (asset && filename)
				await writeFile(resolveContainedPath(destination, filename), asset.bytes, { flag: 'wx' });
		}
		for (let index = 0; index < augments.length; index += 1) {
			const asset = augments[index];
			const filename = augmentFilenames[index];
			if (asset && filename)
				await writeFile(resolveContainedPath(destination, filename), asset.bytes, { flag: 'wx' });
		}
	} catch {
		if (created) await rm(destination, { recursive: true, force: true });
		throw new Error('Publication media could not be prepared');
	}

	return {
		relativeDirectory,
		winnerImageUrl: winnerFilename ? urlFor(winnerFilename) : null,
		championImageUrls: championFilenames.map((filename) => (filename ? urlFor(filename) : null)),
		augmentImageUrls: augmentFilenames.map((filename) => (filename ? urlFor(filename) : null))
	};
}

/** @param {{ mediaRoot: string, relativeDirectory: string }} input */
export async function discardPublicationMedia({ mediaRoot, relativeDirectory }) {
	const normalized = relativeDirectory.replaceAll('\\', '/');
	const publicationId = normalized.startsWith('publications/')
		? normalized.slice('publications/'.length)
		: '';
	if (!isPublicationId(publicationId) || normalized !== `publications/${publicationId}`)
		throw new Error('Invalid publication media directory');
	await rm(resolveContainedPath(mediaRoot, normalized), { recursive: true, force: true });
}

/**
 * @param {{ mediaRoot: string, publicationId: string, filename: string }} input
 */
export async function readPublicationMedia({ mediaRoot, publicationId, filename }) {
	if (!isPublicationMediaFilename(publicationId, filename))
		throw new Error(PUBLICATION_MEDIA_NOT_FOUND);
	try {
		const relativePath = path.posix.join('publications', publicationId, filename);
		const bytes = await readContainedManagedFile({ mediaRoot, relativePath });
		const detected = await fileTypeFromBuffer(bytes);
		if (!detected || !SUPPORTED_IMAGES.has(detected.mime))
			throw new Error(PUBLICATION_MEDIA_NOT_FOUND);
		return { bytes, mime: detected.mime };
	} catch {
		throw new Error(PUBLICATION_MEDIA_NOT_FOUND);
	}
}
