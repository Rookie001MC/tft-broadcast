import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { playerImportPreviews } from '$lib/server/db/schema/imports.js';
import { players } from '$lib/server/db/schema/players.js';
import {
	deleteManagedFile,
	resolveContainedPath,
	writeManagedPlayerImage
} from '../media/player-images.js';
import { inspectPlayerBundle, readPlayerBundleImages } from './player-bundle.js';

const PREVIEW_LIFETIME_MS = 30 * 60 * 1000;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const STAGED_ZIP_NAME =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.zip$/i;
const MANAGED_IMAGE_NAME =
	/^[a-zA-Z0-9_-]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i;

/** @param {Uint8Array} bytes */
function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

/** @param {unknown} value */
function normalizedJson(value) {
	return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value);
}

/** @param {unknown} value */
function parsedJson(value) {
	return typeof value === 'string' ? JSON.parse(value) : value;
}

/** @param {unknown} value */
function dateValue(value) {
	if (value instanceof Date) return value;
	if (typeof value === 'number' || typeof value === 'string') {
		const parsed = new Date(
			typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
		);
		if (!Number.isNaN(parsed.getTime())) return parsed;
	}
	return null;
}

/** @param {unknown} value */
function summaryValue(value) {
	if (typeof value === 'string') {
		try {
			return summaryValue(JSON.parse(value));
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const summary = /** @type {Record<string, unknown>} */ (value);
	if (![summary.created, summary.updated, summary.skipped].every(Number.isInteger)) return null;
	return {
		created: /** @type {number} */ (summary.created),
		updated: /** @type {number} */ (summary.updated),
		skipped: /** @type {number} */ (summary.skipped)
	};
}

/** @param {unknown} value */
function previewPayload(value) {
	const parsed = parsedJson(value);
	if (
		parsed &&
		typeof parsed === 'object' &&
		!Array.isArray(parsed) &&
		'__committedImport' in parsed
	) {
		const envelope = /** @type {Record<string, any>} */ (parsed);
		return {
			preview: envelope.preview,
			committedAt: dateValue(envelope.__committedImport?.committedAt),
			summary: summaryValue(envelope.__committedImport?.summary)
		};
	}
	return { preview: parsed, committedAt: null, summary: null };
}

/** @param {any} database */
async function supportsTerminalColumns(database) {
	const columns = await database.all(sql.raw('PRAGMA table_info(player_import_previews)'));
	const names = new Set(columns.map((/** @type {{ name?: unknown }} */ column) => column.name));
	return names.has('committed_at') && names.has('result_summary_json');
}

/** @param {Record<string, any>} player @param {Record<string, any>} row */
function playerDetailsChanged(player, row) {
	return (
		player.riotId !== row.riotId ||
		player.riotIdKey !== row.riotIdKey ||
		player.riotGameName !== row.gameName ||
		player.riotTagline !== row.tagline ||
		player.fullName !== row.fullName ||
		player.displayName !== row.displayName
	);
}

/** @param {string} stagedPath @param {string} token */
function assertExpectedStagedPath(stagedPath, token) {
	if (stagedPath.replaceAll('\\', '/') !== `import-staging/${token}.zip`)
		throw new Error('Invalid staged import path');
}

/** @param {unknown} error */
function isNotFound(error) {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

/**
 * Remove expired preview records and their app-contained staging files.
 * Missing files count as already removed. Unsafe paths or other deletion
 * failures retain the database row so a later cleanup can retry safely.
 *
 * @param {any} db
 * @param {string} mediaRoot
 * @param {Date} now
 */
async function cleanupExpiredPreviews(db, mediaRoot, now) {
	const expired = await db
		.select({ token: playerImportPreviews.token, stagedPath: playerImportPreviews.stagedPath })
		.from(playerImportPreviews)
		.where(
			and(eq(playerImportPreviews.status, 'previewed'), lte(playerImportPreviews.expiresAt, now))
		);

	for (const preview of expired) {
		try {
			assertExpectedStagedPath(preview.stagedPath, preview.token);
			await deleteManagedFile(mediaRoot, preview.stagedPath);
		} catch (error) {
			if (!isNotFound(error)) continue;
		}

		await db
			.delete(playerImportPreviews)
			.where(
				and(
					eq(playerImportPreviews.token, preview.token),
					eq(playerImportPreviews.status, 'previewed'),
					lte(playerImportPreviews.expiresAt, now)
				)
			);
	}
}

/**
 * Retry cleanup for files left without database metadata by an insert failure
 * or transaction rollback. Only old, direct children matching names generated
 * by this module are eligible, avoiding both active-import races and arbitrary
 * path deletion.
 *
 * @param {any} db
 * @param {string} mediaRoot
 * @param {Date} now
 */
async function reconcileOrphanFiles(db, mediaRoot, now) {
	const cutoff = now.getTime() - ORPHAN_GRACE_MS;
	/** @type {Array<{ stagedPath: string }>} */
	const previewRows = await db
		.select({ stagedPath: playerImportPreviews.stagedPath })
		.from(playerImportPreviews)
		.where(eq(playerImportPreviews.status, 'previewed'));
	const referencedStaging = new Set(
		previewRows.map(({ stagedPath }) => stagedPath.replaceAll('\\', '/'))
	);
	/** @type {Array<{ imagePath: string | null }>} */
	const playerRows = await db.select({ imagePath: players.imagePath }).from(players);
	const referencedImages = new Set(
		playerRows.flatMap(({ imagePath }) => (imagePath ? [imagePath.replaceAll('\\', '/')] : []))
	);

	await reconcileDirectory({
		mediaRoot,
		directory: 'import-staging',
		namePattern: STAGED_ZIP_NAME,
		referencedPaths: referencedStaging,
		cutoff
	});
	await reconcileDirectory({
		mediaRoot,
		directory: 'player-images',
		namePattern: MANAGED_IMAGE_NAME,
		referencedPaths: referencedImages,
		cutoff
	});
}

/**
 * @param {{ mediaRoot: string, directory: string, namePattern: RegExp, referencedPaths: Set<string>, cutoff: number }} input
 */
async function reconcileDirectory({ mediaRoot, directory, namePattern, referencedPaths, cutoff }) {
	const absoluteDirectory = resolveContainedPath(mediaRoot, directory);
	let entries;
	try {
		entries = await readdir(absoluteDirectory, { withFileTypes: true });
	} catch (error) {
		if (isNotFound(error)) return;
		throw error;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !namePattern.test(entry.name)) continue;
		const relativePath = path.posix.join(directory, entry.name);
		if (referencedPaths.has(relativePath)) continue;
		try {
			const metadata = await stat(resolveContainedPath(absoluteDirectory, entry.name));
			if (metadata.mtimeMs > cutoff) continue;
			await deleteManagedFile(mediaRoot, relativePath);
		} catch {
			// The contained orphan remains visible for the next reconciliation pass.
		}
	}
}

/**
 * Load the latest persisted import record. Committed rows are terminal even
 * though their staged ZIP is deliberately removed after the transaction.
 *
 * @param {{ db: any, mediaRoot: string }} input
 */
export async function loadLatestPlayerImportPreview({ db, mediaRoot }) {
	const [stored] = await db
		.select({
			token: playerImportPreviews.token,
			stagedPath: playerImportPreviews.stagedPath,
			previewJson: playerImportPreviews.previewJson,
			status: playerImportPreviews.status,
			expiresAt: playerImportPreviews.expiresAt,
			createdAt: playerImportPreviews.createdAt
		})
		.from(playerImportPreviews)
		.orderBy(desc(playerImportPreviews.createdAt), desc(sql`rowid`))
		.limit(1);
	if (!stored) return null;

	const payload = previewPayload(stored.previewJson);
	let committedAt = payload.committedAt;
	let summary = payload.summary;
	if (stored.status === 'committed' && (await supportsTerminalColumns(db))) {
		const [terminal] = await db.all(sql`
			SELECT committed_at AS committedAt, result_summary_json AS resultSummaryJson
			FROM player_import_previews
			WHERE token = ${stored.token}
			LIMIT 1
		`);
		committedAt = dateValue(terminal?.committedAt) ?? committedAt;
		summary = summaryValue(terminal?.resultSummaryJson) ?? summary;
	}

	const result = {
		token: stored.token,
		preview: payload.preview,
		status: stored.status,
		expiresAt: stored.expiresAt,
		createdAt: stored.createdAt,
		...(committedAt ? { committedAt } : {}),
		...(summary ? { summary } : {})
	};
	if (stored.status === 'committed') return result;
	if (stored.expiresAt.getTime() <= Date.now()) return { ...result, status: 'expired' };

	try {
		assertExpectedStagedPath(stored.stagedPath, stored.token);
		const details = await stat(resolveContainedPath(mediaRoot, stored.stagedPath));
		if (!details.isFile()) return { ...result, status: 'unavailable' };
	} catch {
		return { ...result, status: 'unavailable' };
	}
	return result;
}

/**
 * @param {{ db: any, zipBytes: Uint8Array, mediaRoot: string, existingPlayers: Array<Record<string, unknown>> }} input
 */
export async function stagePlayerImport({ db, zipBytes, mediaRoot, existingPlayers }) {
	const createdAt = new Date();
	await cleanupExpiredPreviews(db, mediaRoot, createdAt);
	await reconcileOrphanFiles(db, mediaRoot, createdAt);
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
	const storedPayload = previewPayload(stored.previewJson);

	const absoluteStagedPath = resolveContainedPath(mediaRoot, stored.stagedPath);
	const zipBytes = await readFile(absoluteStagedPath);
	if (sha256(zipBytes) !== stored.sha256)
		throw new Error('Import bundle digest does not match preview');

	/** @type {Array<{ id: string, riotId: string | null, riotIdKey: string | null, imagePath: string | null, createdAt: Date }>} */
	const existingPlayers = await db.select().from(players);
	const preview = await inspectPlayerBundle(zipBytes, existingPlayers);
	if (!preview.canCommit) throw new Error('Import has validation errors');
	if (normalizedJson(preview) !== normalizedJson(storedPayload.preview))
		throw new Error('Import preview is stale');

	const requestedImagePaths = preview.rows.flatMap((row) => (row.image ? [row.image.path] : []));
	const imageBytes = await readPlayerBundleImages(zipBytes, requestedImagePaths);
	const terminalColumns = await supportsTerminalColumns(db);
	/** @type {string[]} */
	const newlyWrittenPaths = [];
	/** @type {string[]} */
	const replacedImagePaths = [];
	/** @type {{ committedAt: Date, summary: { created: number, updated: number, skipped: number }} | undefined} */
	let committedResult;

	try {
		committedResult = await db.transaction(async (/** @type {any} */ tx) => {
			const transactionPlayers = await tx.select().from(players);
			const transactionPreview = await inspectPlayerBundle(zipBytes, transactionPlayers);
			if (
				!transactionPreview.canCommit ||
				normalizedJson(transactionPreview) !== normalizedJson(storedPayload.preview)
			)
				throw new Error('Import preview is stale');

			const existingByKey = new Map(
				transactionPlayers.map((/** @type {Record<string, any>} */ player) => [
					player.riotIdKey,
					player
				])
			);
			const preparedRows = transactionPreview.rows.map((row) => {
				if (!row.riotIdKey || !row.gameName || !row.tagline)
					throw new Error('Import has validation errors');
				const existing = existingByKey.get(row.riotIdKey);
				return {
					row,
					existing,
					playerId: existing?.id ?? randomUUID(),
					imagePath: /** @type {string | null} */ (null),
					changed: !existing || playerDetailsChanged(existing, row) || Boolean(row.image)
				};
			});
			const summary = preparedRows.reduce(
				(result, prepared) => {
					if (!prepared.existing) result.created += 1;
					else if (prepared.changed) result.updated += 1;
					else result.skipped += 1;
					return result;
				},
				{ created: 0, updated: 0, skipped: 0 }
			);

			const committedAt = new Date();
			let claimed;
			if (terminalColumns) {
				claimed = await tx.run(sql`
					UPDATE player_import_previews
					SET status = 'committed',
						committed_at = ${committedAt.getTime()},
						result_summary_json = ${JSON.stringify(summary)}
					WHERE token = ${token}
						AND status = 'previewed'
						AND expires_at > ${committedAt.getTime()}
				`);
			} else {
				const committed = await tx
					.update(playerImportPreviews)
					.set({
						status: 'committed',
						previewJson: normalizedJson({
							preview: storedPayload.preview,
							__committedImport: { committedAt: committedAt.toISOString(), summary }
						})
					})
					.where(
						and(
							eq(playerImportPreviews.token, token),
							eq(playerImportPreviews.status, 'previewed'),
							gt(playerImportPreviews.expiresAt, committedAt)
						)
					)
					.returning({ token: playerImportPreviews.token });
				claimed = { rowsAffected: committed.length };
			}
			if (claimed.rowsAffected !== 1)
				throw new Error(
					stored.expiresAt.getTime() <= committedAt.getTime()
						? 'Import preview has expired'
						: 'Import preview has already been used'
				);

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
				if (prepared.existing?.imagePath) replacedImagePaths.push(prepared.existing.imagePath);
			}

			for (const prepared of preparedRows) {
				const { row, existing, playerId, imagePath, changed } = prepared;
				if (!changed) continue;
				const values = {
					id: playerId,
					riotId: row.riotId,
					riotIdKey: row.riotIdKey,
					riotGameName: row.gameName,
					riotTagline: row.tagline,
					fullName: row.fullName,
					displayName: row.displayName,
					imagePath: imagePath ?? existing?.imagePath ?? null,
					createdAt: existing?.createdAt ?? committedAt,
					updatedAt: committedAt
				};
				const updates = {
					riotId: values.riotId,
					riotGameName: values.riotGameName,
					riotTagline: values.riotTagline,
					fullName: values.fullName,
					displayName: values.displayName,
					updatedAt: committedAt,
					...(imagePath ? { imagePath } : {})
				};
				await tx
					.insert(players)
					.values(values)
					.onConflictDoUpdate({ target: players.riotIdKey, set: updates });
			}
			return { committedAt, summary };
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
	await Promise.all(
		replacedImagePaths.map((relativePath) =>
			deleteManagedFile(mediaRoot, relativePath).catch(() => {})
		)
	);
	if (!committedResult) throw new Error('Import preview commit did not complete');
	return { token, status: 'committed', ...committedResult };
}
