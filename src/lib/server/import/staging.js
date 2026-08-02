import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, lte } from 'drizzle-orm';
import { playerImportPreviews } from '$lib/server/db/schema/imports.js';
import { players } from '$lib/server/db/schema/players.js';
import {
	deleteManagedFile,
	resolveContainedPath,
	writeManagedPlayerImage
} from '../media/player-images.js';
import { inspectPlayerBundle, readPlayerBundleImages } from './player-bundle.js';

const PREVIEW_LIFETIME_MS = 30 * 60 * 1000;

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {unknown} value */
function normalizedJson(value) {
	return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value);
}

/** @param {string} stagedPath @param {string} token */
function assertExpectedStagedPath(stagedPath, token) {
	if (stagedPath.replaceAll('\\', '/') !== `import-staging/${token}.zip`)
		throw new Error('Invalid staged import path');
}

/**
 * Remove expired preview records and their app-contained staging files.
 * File deletion is best effort so a missing or corrupt path cannot block later
 * imports; the database row is still retired.
 *
 * @param {any} db
 * @param {string} mediaRoot
 * @param {Date} now
 */
async function cleanupExpiredPreviews(db, mediaRoot, now) {
	const expired = await db
		.select({ token: playerImportPreviews.token, stagedPath: playerImportPreviews.stagedPath })
		.from(playerImportPreviews)
		.where(lte(playerImportPreviews.expiresAt, now));

	for (const preview of expired) {
		try {
			assertExpectedStagedPath(preview.stagedPath, preview.token);
			await deleteManagedFile(mediaRoot, preview.stagedPath);
		} catch {
			// Stale records must not make new previews unavailable.
		}
	}

	if (expired.length > 0)
		await db.delete(playerImportPreviews).where(lte(playerImportPreviews.expiresAt, now));
}

/**
 * @param {{ db: any, zipBytes: Uint8Array, mediaRoot: string, existingPlayers: Array<Record<string, unknown>> }} input
 */
export async function stagePlayerImport({ db, zipBytes, mediaRoot, existingPlayers }) {
	const createdAt = new Date();
	await cleanupExpiredPreviews(db, mediaRoot, createdAt);
	const preview = await inspectPlayerBundle(zipBytes, existingPlayers);
	const token = randomUUID();
	const stagedPath = path.posix.join('import-staging', `${token}.zip`);
	const absolutePath = resolveContainedPath(mediaRoot, stagedPath);
	await mkdir(resolveContainedPath(mediaRoot, 'import-staging'), { recursive: true });
	await writeFile(absolutePath, zipBytes, { flag: 'wx' });

	try {
		await db.insert(playerImportPreviews).values({
			token,
			stagedPath,
			sha256: sha256(zipBytes),
			previewJson: normalizedJson(preview),
			status: 'previewed',
			expiresAt: new Date(createdAt.getTime() + PREVIEW_LIFETIME_MS),
			createdAt
		});
	} catch (error) {
		await deleteManagedFile(mediaRoot, stagedPath).catch(() => {});
		throw error;
	}

	return { token, preview };
}

/**
 * @param {{ db: any, token: string, mediaRoot: string }} input
 */
export async function commitStagedPlayerImport({ db, token, mediaRoot }) {
	const [stored] = await db
		.select()
		.from(playerImportPreviews)
		.where(eq(playerImportPreviews.token, token))
		.limit(1);
	if (!stored) throw new Error('Import preview was not found');
	if (stored.status !== 'previewed') throw new Error('Import preview has already been used');
	if (stored.expiresAt.getTime() <= Date.now()) throw new Error('Import preview has expired');
	assertExpectedStagedPath(stored.stagedPath, token);

	const absoluteStagedPath = resolveContainedPath(mediaRoot, stored.stagedPath);
	const zipBytes = await readFile(absoluteStagedPath);
	if (sha256(zipBytes) !== stored.sha256)
		throw new Error('Import bundle digest does not match preview');

	/** @type {Array<{ id: string, riotId: string | null, riotIdKey: string | null, imagePath: string | null, createdAt: Date }>} */
	const existingPlayers = await db.select().from(players);
	const preview = await inspectPlayerBundle(zipBytes, existingPlayers);
	if (!preview.canCommit) throw new Error('Import has validation errors');
	if (normalizedJson(preview) !== normalizedJson(stored.previewJson))
		throw new Error('Import preview is stale');

	const requestedImagePaths = preview.rows.flatMap((row) => (row.image ? [row.image.path] : []));
	const imageBytes = await readPlayerBundleImages(zipBytes, requestedImagePaths);
	const existingByKey = new Map(existingPlayers.map((player) => [player.riotIdKey, player]));
	const preparedRows = preview.rows.map((row) => {
		if (!row.riotIdKey || !row.gameName || !row.tagline)
			throw new Error('Import has validation errors');
		const existing = existingByKey.get(row.riotIdKey);
		return {
			row,
			existing,
			playerId: existing?.id ?? randomUUID(),
			imagePath: /** @type {string | null} */ (null)
		};
	});
	/** @type {string[]} */
	const newlyWrittenPaths = [];

	try {
		for (const prepared of preparedRows) {
			if (!prepared.row.image) continue;
			const bytes = imageBytes.get(prepared.row.image.path);
			if (!bytes) throw new Error('Previewed image is missing from bundle');
			prepared.imagePath = await writeManagedPlayerImage({
				mediaRoot,
				playerId: prepared.playerId,
				bytes,
				mime: prepared.row.image.mime
			});
			newlyWrittenPaths.push(prepared.imagePath);
		}

		await db.transaction(async (/** @type {any} */ tx) => {
			const now = new Date();
			for (const prepared of preparedRows) {
				const { row, existing, playerId, imagePath } = prepared;
				const values = {
					id: playerId,
					riotId: row.riotId,
					riotIdKey: row.riotIdKey,
					riotGameName: row.gameName,
					riotTagline: row.tagline,
					fullName: row.fullName,
					displayName: row.displayName,
					imagePath: imagePath ?? existing?.imagePath ?? null,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now
				};
				const updates = {
					riotId: values.riotId,
					riotGameName: values.riotGameName,
					riotTagline: values.riotTagline,
					fullName: values.fullName,
					displayName: values.displayName,
					updatedAt: now,
					...(imagePath ? { imagePath } : {})
				};
				await tx
					.insert(players)
					.values(values)
					.onConflictDoUpdate({ target: players.riotIdKey, set: updates });
			}

			const committed = await tx
				.update(playerImportPreviews)
				.set({ status: 'committed' })
				.where(
					and(eq(playerImportPreviews.token, token), eq(playerImportPreviews.status, 'previewed'))
				)
				.returning({ token: playerImportPreviews.token });
			if (committed.length !== 1) throw new Error('Import preview has already been used');
		});
	} catch (error) {
		await Promise.all(
			newlyWrittenPaths.map((relativePath) =>
				deleteManagedFile(mediaRoot, relativePath).catch(() => {})
			)
		);
		throw error;
	}

	await deleteManagedFile(mediaRoot, stored.stagedPath).catch(() => {});
	return { imported: preparedRows.length };
}
