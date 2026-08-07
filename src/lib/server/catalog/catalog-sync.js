import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { LolApi } from 'twisted';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { tournaments } from '../db/schema/tournaments.js';
import { resolveContainedPath } from '../media/player-images.js';
import {
	MAX_ARCHIVE_BYTES,
	cleanupStaleCatalogStaging,
	copyExtractedCatalogImages,
	downloadCatalogImages,
	downloadResponseToFile,
	extractTarGz,
	extractZip,
	findExtractedFile,
	pinSnapshotPath,
	promoteCatalogAssets,
	removeCatalogAssets,
	removeCatalogStaging
} from './catalog-media.js';

const CDRAGON_ROOT = 'https://raw.communitydragon.org';
const DDRAGON_ROOT = 'https://ddragon.leagueoflegends.com';

/** @typedef {'resolving' | 'downloading' | 'extracting' | 'installing' | 'activating'} CatalogSyncPhase */
/** @typedef {{ type: 'progress', phase: CatalogSyncPhase, message: string, completed?: number, total?: number, percent: number | null }} CatalogProgress */
/** @typedef {{ externalId: string, displayName: string, iconPath: string | null, tier: number | null, metadataJson: string }} CatalogAsset */
/** @typedef {{ source: 'communitydragon' | 'datadragon', sourceUrl: string, locale: string, patchLabel: string, setLabel: string | null, champions: CatalogAsset[], augments: CatalogAsset[], warning: string | null }} CatalogCandidate */

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? /** @type {Record<string, unknown>} */ (value)
		: null;
}

/** @param {unknown} value */
function nonEmptyString(value) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {string} url */
function requireHttps(url) {
	if (new URL(url).protocol !== 'https:') throw new Error('Catalog asset URL must use HTTPS');
	return url;
}

/** @param {string} locale */
function cdragonLocale(locale) {
	return locale.trim().replaceAll('-', '_').toLocaleLowerCase('en-US');
}

/** @param {string} locale */
function ddragonLocale(locale) {
	const [language = '', region = ''] = locale.trim().replaceAll('-', '_').split('_');
	if (!language || !region) throw new Error('Catalog locale must include a language and region');
	return `${language.toLocaleLowerCase('en-US')}_${region.toLocaleUpperCase('en-US')}`;
}

/** @param {string} requested @param {string} fallback */
function localeCandidates(requested, fallback) {
	return requested === fallback ? [requested] : [requested, fallback];
}

/** @param {unknown} metadata */
function immutableCdragonPatch(metadata) {
	const version = nonEmptyString(asRecord(metadata)?.version);
	const match = version?.match(/^(\d+)\.(\d+)/);
	if (!match) throw new Error('CommunityDragon latest metadata did not contain a patch');
	return `${match[1]}.${match[2]}`;
}

/** @param {string} value */
function versionParts(value) {
	return value.split('.').map(Number);
}

/** @param {unknown} versions @param {string} requestedPatch */
export function resolveDdragonVersion(versions, requestedPatch) {
	if (!Array.isArray(versions)) throw new Error('Data Dragon versions response was invalid');
	const valid = versions.filter(
		(value) => typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(value)
	);
	const matches =
		requestedPatch === 'latest'
			? valid
			: valid.filter((value) => value === requestedPatch || value.startsWith(`${requestedPatch}.`));
	matches.sort((left, right) => {
		const leftParts = versionParts(left);
		const rightParts = versionParts(right);
		for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
			const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
			if (difference) return difference;
		}
		return 0;
	});
	if (!matches[0]) throw new Error(`Data Dragon patch ${requestedPatch} was not found`);
	return matches[0];
}

/** @param {unknown} rawPath @param {string} patch */
function cdragonIconUrl(rawPath, patch) {
	const iconPath = nonEmptyString(rawPath);
	if (!iconPath) return null;
	if (iconPath.startsWith('https://')) return requireHttps(iconPath);
	if (!iconPath.startsWith('/lol-game-data/assets/'))
		throw new Error('Unsupported CommunityDragon asset path');
	const relativePath = iconPath.slice('/lol-game-data/assets/'.length).toLocaleLowerCase('en-US');
	return requireHttps(
		`${CDRAGON_ROOT}/${patch}/plugins/rcp-be-lol-game-data/global/default/${relativePath}`
	);
}

/** @param {unknown} filename */
function ddragonIconFilename(filename) {
	const value = nonEmptyString(filename);
	if (!value) return null;
	const basename = path.posix.basename(value);
	if (basename !== value || basename === '.' || basename === '..')
		throw new Error('Unsupported Data Dragon asset filename');
	return basename;
}

/** @param {string} externalId @param {string} displayName */
function isPlaceholder(externalId, displayName) {
	return /(?:^|_)(?:blank|placeholder)$/i.test(externalId) || /^placeholder$/i.test(displayName);
}

/** @param {unknown} payload @param {string} patch */
function normalizeCdragon(payload, patch) {
	const root = asRecord(payload);
	const sets = asRecord(root?.sets);
	if (!root || !sets) throw new Error('CommunityDragon catalog payload was invalid');
	const selectedEntry = Object.entries(sets)
		.filter(([key]) => /^\d+$/.test(key))
		.sort(([left], [right]) => Number(right) - Number(left))[0];
	if (!selectedEntry) throw new Error('CommunityDragon catalog had no numeric set');
	const [setKey, selectedValue] = selectedEntry;
	const selectedSet = asRecord(selectedValue);
	const rawChampions = selectedSet?.champions;
	if (!Array.isArray(rawChampions)) throw new Error('CommunityDragon set had no champions');
	const champions = rawChampions.flatMap((raw) => {
		const record = asRecord(raw);
		const externalId = nonEmptyString(record?.apiName);
		const displayName = nonEmptyString(record?.name);
		if (!record || !externalId || !displayName || isPlaceholder(externalId, displayName)) return [];
		return [
			{
				externalId,
				displayName,
				iconPath: cdragonIconUrl(record.squareIcon, patch),
				tier: typeof record.cost === 'number' && Number.isInteger(record.cost) ? record.cost : null,
				metadataJson: JSON.stringify(record)
			}
		];
	});
	if (champions.length === 0) throw new Error('CommunityDragon catalog had no usable champions');
	const rawItems = Array.isArray(root.items) ? root.items : [];
	const augments = rawItems.flatMap((raw) => {
		const record = asRecord(raw);
		const externalId = nonEmptyString(record?.apiName);
		const displayName = nonEmptyString(record?.name);
		if (!record || !externalId || !displayName || !/augment/i.test(externalId)) return [];
		return [
			{
				externalId,
				displayName,
				iconPath: cdragonIconUrl(record.icon, patch),
				tier: null,
				metadataJson: JSON.stringify(record)
			}
		];
	});
	return { setLabel: nonEmptyString(selectedSet?.name) ?? setKey, champions, augments };
}

/** @param {unknown} payload */
function normalizeDdragonEntries(payload) {
	const data = asRecord(asRecord(payload)?.data);
	if (!data) throw new Error('Data Dragon catalog payload was invalid');
	return Object.entries(data).flatMap(([key, raw]) => {
		const record = asRecord(raw);
		const externalId = nonEmptyString(record?.id) ?? nonEmptyString(key);
		const displayName = nonEmptyString(record?.name);
		if (!record || !externalId || !displayName || isPlaceholder(externalId, displayName)) return [];
		const image = asRecord(record.image);
		return [
			{
				externalId,
				displayName,
				iconPath: ddragonIconFilename(image?.full),
				tier: typeof record.tier === 'number' && Number.isInteger(record.tier) ? record.tier : null,
				metadataJson: JSON.stringify(record)
			}
		];
	});
}

/** @param {Array<string | null>} warnings */
function combineWarnings(warnings) {
	const value = warnings.filter(Boolean).join(' ');
	return value || null;
}

/** @param {(progress: CatalogProgress) => void} onProgress @param {CatalogSyncPhase} phase @param {string} message @param {number} [completed] @param {number} [total] */
function emit(onProgress, phase, message, completed, total) {
	const percent =
		total !== undefined && total > 0 && completed !== undefined
			? Math.min(100, Math.round((completed / total) * 100))
			: null;
	onProgress({
		type: 'progress',
		phase,
		message,
		...(completed === undefined ? {} : { completed }),
		...(total === undefined ? {} : { total }),
		percent
	});
}

/**
 * @param {{ patch: string, locale: string, fetchJson: (url: string, init?: RequestInit) => Promise<unknown>, fetchResponse: (url: string, init?: RequestInit) => Promise<Response>, candidateRoot: string, signal?: AbortSignal, onProgress: (progress: CatalogProgress) => void }} input
 * @returns {Promise<CatalogCandidate | null>}
 */
async function tryCdragon({
	patch,
	locale,
	fetchJson,
	fetchResponse,
	candidateRoot,
	signal,
	onProgress
}) {
	let resolvedPatch = patch;
	if (patch === 'latest') {
		try {
			emit(onProgress, 'resolving', 'Resolving the latest CommunityDragon patch');
			resolvedPatch = immutableCdragonPatch(
				await fetchJson(`${CDRAGON_ROOT}/latest/content-metadata.json`, { signal })
			);
		} catch (error) {
			if (signal?.aborted) throw error;
			return null;
		}
	}
	const requestedLocale = cdragonLocale(locale);
	for (const candidateLocale of localeCandidates(requestedLocale, 'en_us')) {
		const sourceUrl = `${CDRAGON_ROOT}/${resolvedPatch}/cdragon/tft/${candidateLocale}.json`;
		try {
			emit(onProgress, 'resolving', `Loading CommunityDragon catalog ${candidateLocale}`);
			const normalized = normalizeCdragon(await fetchJson(sourceUrl, { signal }), resolvedPatch);
			const total = [...normalized.champions, ...normalized.augments].filter(
				(asset) => asset.iconPath
			).length;
			let championsDone = 0;
			emit(onProgress, 'downloading', 'Downloading CommunityDragon images', 0, total);
			const champions = await downloadCatalogImages({
				assets: normalized.champions,
				kind: 'champions',
				destination: path.join(candidateRoot, 'assets', 'champions'),
				fetchResponse,
				signal,
				onProgress: (completed) => {
					championsDone = completed;
					emit(onProgress, 'downloading', 'Downloading CommunityDragon images', completed, total);
				}
			});
			const augments = await downloadCatalogImages({
				assets: normalized.augments,
				kind: 'augments',
				destination: path.join(candidateRoot, 'assets', 'augments'),
				fetchResponse,
				signal,
				onProgress: (completed) =>
					emit(
						onProgress,
						'downloading',
						'Downloading CommunityDragon images',
						championsDone + completed,
						total
					)
			});
			return {
				source: 'communitydragon',
				sourceUrl,
				locale: candidateLocale,
				patchLabel: resolvedPatch,
				setLabel: normalized.setLabel,
				champions,
				augments,
				warning: combineWarnings([
					candidateLocale !== requestedLocale
						? `CommunityDragon fell back to locale ${candidateLocale}.`
						: null,
					normalized.augments.length === 0
						? 'Augments were unavailable from CommunityDragon.'
						: null
				])
			};
		} catch (error) {
			if (signal?.aborted) throw error;
			await rm(candidateRoot, { recursive: true, force: true });
		}
	}
	return null;
}

/** @param {string} filename */
async function readJson(filename) {
	return JSON.parse(await readFile(filename, 'utf8'));
}

/**
 * @param {{ version: string, candidateRoot: string, fetchResponse: (url: string, init?: RequestInit) => Promise<Response>, signal?: AbortSignal, onProgress: (progress: CatalogProgress) => void }} input
 */
async function downloadAndExtractDdragon({
	version,
	candidateRoot,
	fetchResponse,
	signal,
	onProgress
}) {
	for (const format of ['tgz', 'zip']) {
		const sourceUrl = `${DDRAGON_ROOT}/cdn/dragontail-${version}.${format}`;
		emit(onProgress, 'downloading', `Downloading Data Dragon ${version}`);
		const response = await fetchResponse(sourceUrl, { signal });
		if (!response.ok) continue;
		const archivePath = path.join(candidateRoot, `dragontail.${format}`);
		await downloadResponseToFile({
			response,
			destination: archivePath,
			maxBytes: MAX_ARCHIVE_BYTES,
			signal,
			onBytes: (completed, total) =>
				emit(
					onProgress,
					'downloading',
					`Downloading Data Dragon ${version}`,
					completed,
					total ?? undefined
				)
		});
		const extractedRoot = path.join(candidateRoot, 'extracted');
		emit(onProgress, 'extracting', 'Extracting the Data Dragon package');
		if (format === 'tgz') await extractTarGz({ archivePath, destination: extractedRoot, signal });
		else await extractZip({ archivePath, destination: extractedRoot, signal });
		await rm(archivePath, { force: true });
		return { sourceUrl, extractedRoot };
	}
	throw new Error(`Data Dragon package ${version} was unavailable`);
}

/**
 * @param {{ patch: string, locale: string, getVersions: () => Promise<string[]>, fetchResponse: (url: string, init?: RequestInit) => Promise<Response>, candidateRoot: string, signal?: AbortSignal, onProgress: (progress: CatalogProgress) => void }} input
 * @returns {Promise<CatalogCandidate | null>}
 */
async function tryDdragon({
	patch,
	locale,
	getVersions,
	fetchResponse,
	candidateRoot,
	signal,
	onProgress
}) {
	try {
		emit(onProgress, 'resolving', 'Resolving the Data Dragon package version');
		const version = resolveDdragonVersion(await getVersions(), patch);
		if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
		const { sourceUrl, extractedRoot } = await downloadAndExtractDdragon({
			version,
			candidateRoot,
			fetchResponse,
			signal,
			onProgress
		});
		const requestedLocale = ddragonLocale(locale);
		for (const candidateLocale of localeCandidates(requestedLocale, 'en_US')) {
			const championJson = await findExtractedFile(
				extractedRoot,
				`/data/${candidateLocale}/tft-champion.json`
			);
			if (!championJson) continue;
			try {
				const champions = normalizeDdragonEntries(await readJson(championJson));
				if (champions.length === 0) continue;
				const augmentJson = await findExtractedFile(
					extractedRoot,
					`/data/${candidateLocale}/tft-augments.json`
				);
				/** @type {CatalogAsset[]} */
				let augments = [];
				if (augmentJson) {
					try {
						augments = normalizeDdragonEntries(await readJson(augmentJson));
					} catch {
						augments = [];
					}
				}
				emit(onProgress, 'installing', 'Installing TFT images from Data Dragon');
				const installedChampions = await copyExtractedCatalogImages({
					assets: champions,
					kind: 'champions',
					extractedRoot,
					destination: path.join(candidateRoot, 'assets', 'champions'),
					signal
				});
				augments = await copyExtractedCatalogImages({
					assets: augments,
					kind: 'augments',
					extractedRoot,
					destination: path.join(candidateRoot, 'assets', 'augments'),
					signal
				});
				await rm(extractedRoot, { recursive: true, force: true });
				return {
					source: 'datadragon',
					sourceUrl,
					locale: candidateLocale,
					patchLabel: version,
					setLabel: null,
					champions: installedChampions,
					augments,
					warning: combineWarnings([
						candidateLocale !== requestedLocale
							? `Data Dragon fell back to locale ${candidateLocale}.`
							: null,
						augments.length === 0 ? 'Augments were unavailable from Data Dragon.' : null
					])
				};
			} catch (error) {
				if (signal?.aborted) throw error;
				await rm(path.join(candidateRoot, 'assets'), { recursive: true, force: true });
			}
		}
	} catch (error) {
		if (signal?.aborted) throw error;
	}
	await rm(candidateRoot, { recursive: true, force: true });
	return null;
}

/**
 * Fetch, install, normalize, and atomically pin a TFT catalog for a tournament.
 *
 * @param {{
 *   db: any,
 *   tournamentId: string,
 *   patch: string,
 *   locale: string,
 *   mediaRoot?: string,
 *   fetchJson?: (url: string, init?: RequestInit) => Promise<unknown>,
 *   fetchResponse?: (url: string, init?: RequestInit) => Promise<Response>,
 *   getVersions?: () => Promise<string[]>,
 *   signal?: AbortSignal,
 *   onProgress?: (progress: CatalogProgress) => void
 * }} input
 */
export async function syncAndActivateCatalog({
	db,
	tournamentId,
	patch,
	locale,
	mediaRoot = 'media',
	fetchJson = async (url, init) => {
		const response = await fetch(url, init);
		if (!response.ok) throw new Error(`Catalog sync failed for ${url}`);
		return response.json();
	},
	fetchResponse = fetch,
	getVersions = () => new LolApi().DataDragon.getVersions(),
	signal,
	onProgress = () => {}
}) {
	const [tournament] = await db
		.select({ activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId })
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1);
	if (!tournament) throw new Error('Tournament not found');
	const normalizedPatch = patch.trim();
	if (normalizedPatch !== 'latest' && !/^\d+\.\d+(?:\.\d+)?$/.test(normalizedPatch))
		throw new Error('Catalog patch must be latest or a numeric patch');
	await cleanupStaleCatalogStaging(mediaRoot);
	const snapshotId = randomUUID();
	const syncRoot = resolveContainedPath(mediaRoot, `catalog-staging/${snapshotId}`);
	await mkdir(syncRoot, { recursive: true });
	let promoted = false;
	try {
		const cdragonRoot = path.join(syncRoot, 'communitydragon');
		/** @type {CatalogCandidate | null} */
		let candidate = await tryCdragon({
			patch: normalizedPatch,
			locale,
			fetchJson,
			fetchResponse,
			candidateRoot: cdragonRoot,
			signal,
			onProgress
		});
		let candidateRoot = cdragonRoot;
		if (!candidate) {
			const ddragonRoot = path.join(syncRoot, 'datadragon');
			candidate = await tryDdragon({
				patch: normalizedPatch,
				locale,
				getVersions,
				fetchResponse,
				candidateRoot: ddragonRoot,
				signal,
				onProgress
			});
			candidateRoot = ddragonRoot;
		}
		if (!candidate) {
			return {
				activated: false,
				snapshotId: tournament.activeCatalogSnapshotId,
				source: null,
				locale: cdragonLocale(locale),
				champions: [],
				augments: [],
				warning: 'Catalog could not be synchronized; the prior snapshot remains active.'
			};
		}
		await rename(path.join(candidateRoot, 'assets'), path.join(syncRoot, 'assets'));
		candidate.champions = candidate.champions.map((asset) => ({
			...asset,
			iconPath: asset.iconPath ? pinSnapshotPath(asset.iconPath, snapshotId) : null
		}));
		candidate.augments = candidate.augments.map((asset) => ({
			...asset,
			iconPath: asset.iconPath ? pinSnapshotPath(asset.iconPath, snapshotId) : null
		}));
		emit(onProgress, 'activating', 'Activating the local catalog snapshot');
		await promoteCatalogAssets(mediaRoot, snapshotId);
		promoted = true;
		const syncedAt = new Date();
		await db.transaction(async (/** @type {any} */ tx) => {
			await tx.insert(catalogSnapshots).values({
				id: snapshotId,
				source: candidate.source,
				sourceUrl: candidate.sourceUrl,
				locale: candidate.locale,
				patchLabel: candidate.patchLabel,
				setLabel: candidate.setLabel,
				syncedAt,
				isAvailable: true,
				metadataJson: JSON.stringify({ warning: candidate.warning })
			});
			await tx.insert(catalogChampions).values(
				candidate.champions.map((champion) => ({
					id: randomUUID(),
					catalogSnapshotId: snapshotId,
					...champion
				}))
			);
			if (candidate.augments.length > 0)
				await tx.insert(catalogAugments).values(
					candidate.augments.map((augment) => ({
						id: randomUUID(),
						catalogSnapshotId: snapshotId,
						...augment
					}))
				);
			const activated = await tx
				.update(tournaments)
				.set({ activeCatalogSnapshotId: snapshotId, updatedAt: syncedAt })
				.where(eq(tournaments.id, tournamentId))
				.returning({ id: tournaments.id });
			if (activated.length !== 1) throw new Error('Tournament not found');
		});
		return {
			activated: true,
			snapshotId,
			source: candidate.source,
			locale: candidate.locale,
			champions: candidate.champions,
			augments: candidate.augments,
			warning: candidate.warning
		};
	} catch (error) {
		if (promoted) await removeCatalogAssets(mediaRoot, snapshotId);
		throw error;
	} finally {
		await removeCatalogStaging(mediaRoot, snapshotId);
	}
}
