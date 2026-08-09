import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { fail } from '@sveltejs/kit';
import { fileTypeFromBuffer } from 'file-type';
import { actionFailure, requireTournamentId, text } from '$lib/server/admin/form-helpers.js';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import {
	createCatalogCorrection,
	excludeCatalogResource,
	restoreCatalogResource,
	updateCatalogCorrection
} from '$lib/server/catalog/catalog-corrections.js';
import {
	assertCatalogCorrectionImagePath,
	MAX_CATALOG_IMAGE_BYTES
} from '$lib/server/catalog/catalog-media.js';
import { catalogArchiveLimits } from '$lib/server/catalog/catalog-config.js';
import { acquireCatalogSync } from '$lib/server/catalog/catalog-lock.js';
import {
	catalogOperatorMessage,
	syncAndActivateCatalog
} from '$lib/server/catalog/catalog-sync.js';
import { db } from '$lib/server/db';
import { deleteManagedFile, resolveContainedPath } from '$lib/server/media/player-images.js';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';
const CORRECTION_IMAGE_EXTENSIONS = new Map([
	['image/png', '.png'],
	['image/jpeg', '.jpg'],
	['image/webp', '.webp']
]);

/** @param {unknown} error */
function isConflict(error) {
	return (
		error instanceof Error && /unique|constraint|already exists|duplicate/i.test(error.message)
	);
}

/** @param {string} action @param {unknown} error @param {string} message */
function correctionFailure(action, error, message) {
	const conflict = isConflict(error);
	const invalidUpload =
		error instanceof Error && /image|upload|file type|size limit/i.test(error.message);
	return fail(conflict ? 409 : invalidUpload ? 400 : 422, {
		action,
		message: conflict ? 'That catalog correction conflicts with an existing resource.' : message
	});
}

/** @param {FormData} form */
async function stageCorrectionImage(form) {
	const image = form.get('image');
	if (!(image instanceof File) || image.size === 0) return null;
	if (image.size > MAX_CATALOG_IMAGE_BYTES)
		throw new Error('Catalog correction image exceeds the size limit');
	const bytes = new Uint8Array(await image.arrayBuffer());
	const detected = await fileTypeFromBuffer(bytes);
	const extension = detected ? CORRECTION_IMAGE_EXTENSIONS.get(detected.mime) : null;
	if (!extension || image.type !== detected?.mime)
		throw new Error('Catalog correction image has an unsupported file type');
	const relativePath = assertCatalogCorrectionImagePath(
		path.posix.join('catalog-corrections', `${randomUUID()}${extension}`)
	);
	await mkdir(resolveContainedPath(MEDIA_ROOT, 'catalog-corrections'), { recursive: true });
	await writeFile(resolveContainedPath(MEDIA_ROOT, relativePath), bytes, { flag: 'wx' });
	return relativePath;
}

/** @param {unknown} previousImagePath @param {string} replacementImagePath */
async function deletePreviousCorrectionImage(previousImagePath, replacementImagePath) {
	if (typeof previousImagePath !== 'string' || previousImagePath === replacementImagePath) return;
	let controlledPath;
	try {
		controlledPath = assertCatalogCorrectionImagePath(previousImagePath);
	} catch {
		return;
	}
	await deleteManagedFile(MEDIA_ROOT, controlledPath).catch(() => {});
}

/** @param {FormData} form @param {string | null} imagePathOverride */
function newCorrectionInput(form, imagePathOverride) {
	const tier = text(form.get('tierOverride'));
	return {
		canonicalSetKey: text(form.get('canonicalSetKey')) || null,
		patchLabel: text(form.get('patchLabel')),
		resourceKind: text(form.get('resourceKind')),
		operation: text(form.get('operation')),
		targetExternalId: text(form.get('targetExternalId')) || null,
		manualExternalId: text(form.get('manualExternalId')) || null,
		displayNameOverride: text(form.get('displayNameOverride')) || null,
		tierOverride: tier ? Number(tier) : null,
		imagePathOverride
	};
}

/** @param {FormData} form @param {string | null} imagePathOverride */
function updatedCorrectionInput(form, imagePathOverride) {
	/** @type {Record<string, unknown>} */
	const input = { correctionId: text(form.get('correctionId')) };
	for (const field of [
		'canonicalSetKey',
		'patchLabel',
		'resourceKind',
		'operation',
		'targetExternalId',
		'manualExternalId',
		'displayNameOverride'
	]) {
		if (form.has(field)) input[field] = text(form.get(field)) || null;
	}
	if (form.has('tierOverride')) {
		const tier = text(form.get('tierOverride'));
		input.tierOverride = tier ? Number(tier) : null;
	}
	if (imagePathOverride) input.imagePathOverride = imagePathOverride;
	return input;
}

/** @param {FormData} form @param {string} action @param {boolean} confirmReset */
async function excludeFromForm(form, action, confirmReset) {
	const tournamentId = text(form.get('tournamentId'));
	const resourceKind = text(form.get('resourceKind'));
	const resourceId = text(form.get('resourceId'));
	if (!tournamentId || (resourceKind !== 'champion' && resourceKind !== 'augment') || !resourceId)
		return fail(400, { action, message: 'Tournament and catalog resource are required.' });
	const result = await excludeCatalogResource(db, {
		tournamentId,
		resourceKind,
		resourceId,
		confirmReset
	});
	return { action, result };
}

/** @type {import('./$types').PageServerLoad} */
export const load = loadAdminData;

/** @satisfies {import('./$types').Actions} */
export const actions = {
	createCorrection: async (event) => {
		requireAdmin(event);
		let imagePath = null;
		try {
			const form = await event.request.formData();
			imagePath = await stageCorrectionImage(form);
			const correction = await createCatalogCorrection(db, newCorrectionInput(form, imagePath));
			return { action: 'createCorrection', correction };
		} catch (error) {
			if (imagePath) await deleteManagedFile(MEDIA_ROOT, imagePath).catch(() => {});
			return correctionFailure('createCorrection', error, 'Catalog correction is invalid.');
		}
	},
	updateCorrection: async (event) => {
		requireAdmin(event);
		let imagePath = null;
		try {
			const form = await event.request.formData();
			imagePath = await stageCorrectionImage(form);
			const correction = await updateCatalogCorrection(db, updatedCorrectionInput(form, imagePath));
			if (imagePath) await deletePreviousCorrectionImage(correction.previousImagePath, imagePath);
			return { action: 'updateCorrection', correction };
		} catch (error) {
			if (imagePath) await deleteManagedFile(MEDIA_ROOT, imagePath).catch(() => {});
			return correctionFailure('updateCorrection', error, 'Catalog correction is invalid.');
		}
	},
	excludeResource: async (event) => {
		requireAdmin(event);
		try {
			return await excludeFromForm(await event.request.formData(), 'excludeResource', false);
		} catch (error) {
			return correctionFailure('excludeResource', error, 'Catalog resource could not be hidden.');
		}
	},
	confirmExcludeResource: async (event) => {
		requireAdmin(event);
		try {
			return await excludeFromForm(await event.request.formData(), 'confirmExcludeResource', true);
		} catch (error) {
			return correctionFailure(
				'confirmExcludeResource',
				error,
				'Catalog resource could not be hidden.'
			);
		}
	},
	restoreResource: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const tournamentId = text(form.get('tournamentId'));
			const resourceKind = text(form.get('resourceKind'));
			const resourceId = text(form.get('resourceId'));
			if (
				!tournamentId ||
				(resourceKind !== 'champion' && resourceKind !== 'augment') ||
				!resourceId
			)
				return fail(400, {
					action: 'restoreResource',
					message: 'Tournament and catalog resource are required.'
				});
			const result = await restoreCatalogResource(db, {
				tournamentId,
				resourceKind,
				resourceId
			});
			return { action: 'restoreResource', result };
		} catch (error) {
			return correctionFailure('restoreResource', error, 'Catalog resource could not be restored.');
		}
	},
	syncCatalog: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const archiveLimits = catalogArchiveLimits(env);
			const release = acquireCatalogSync(tournamentId);
			if (!release)
				return actionFailure('syncCatalog', new Error('A catalog sync is already running.'), 409);
			const patch = text(form.get('patch')) || 'latest';
			const locale = text(form.get('locale')) || 'vi_vn';
			try {
				const result = await syncAndActivateCatalog({
					db,
					tournamentId,
					patch,
					locale,
					mediaRoot: MEDIA_ROOT,
					archiveLimits
				});
				return { action: 'syncCatalog', ...result };
			} finally {
				release();
			}
		} catch (error) {
			return actionFailure('syncCatalog', new Error(catalogOperatorMessage(error)), 422);
		}
	}
};
