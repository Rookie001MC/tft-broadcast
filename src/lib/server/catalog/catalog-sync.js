import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { LolApi } from 'twisted';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { tournaments } from '../db/schema/tournaments.js';
import { resolveContainedPath } from '../media/player-images.js';
import { catalogArchiveLimits } from './catalog-config.js';
import {
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
/** @typedef {'communitydragon' | 'datadragon'} CatalogSource */
/** @typedef {'unavailable' | 'size_limit' | 'invalid_asset' | 'invalid_catalog' | 'internal'} CatalogFailureCategory */
/** @typedef {{ source: CatalogSource, locale: string, phase: CatalogSyncPhase, category: CatalogFailureCategory, cause: string }} CatalogAttemptFailure */

export class CatalogSyncError extends Error {
	/** @param {string} message @param {CatalogAttemptFailure[]} attempts */
	constructor(message, attempts) {
		super(message);
		this.name = 'CatalogSyncError';
		this.attempts = attempts;
	}
}

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
	if (iconPath.startsWith('/lol-game-data/assets/')) {
		const relativePath = iconPath.slice('/lol-game-data/assets/'.length).toLocaleLowerCase('en-US');
		return requireHttps(
			`${CDRAGON_ROOT}/${patch}/plugins/rcp-be-lol-game-data/global/default/${relativePath}`
		);
	}
	if (/^assets\//i.test(iconPath)) {
		const relativePath = iconPath.toLocaleLowerCase('en-US').replace(/\.tex$/i, '.png');
		if (!/\.(?:png|jpe?g|webp)$/i.test(relativePath))
			throw new Error('Unsupported CommunityDragon asset path');
		return requireHttps(`${CDRAGON_ROOT}/${patch}/game/${relativePath}`);
	}
	throw new Error('Unsupported CommunityDragon asset path');
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
	if (!root || !Array.isArray(root.setData) || !Array.isArray(root.items))
		throw new Error('CommunityDragon catalog payload was invalid');
	const selectedSet = root.setData
		.map(asRecord)
		.filter((entry) => {
			const number = entry?.number;
			return Number.isInteger(number) && entry?.mutator === `TFTSet${number}`;
		})
		.sort((left, right) => Number(right?.number) - Number(left?.number))[0];
	if (!selectedSet) throw new Error('CommunityDragon catalog had no standard numeric set');
	const rawChampions = selectedSet?.champions;
	if (!Array.isArray(rawChampions)) throw new Error('CommunityDragon set had no champions');
	const champions = rawChampions.flatMap((raw) => {
		const record = asRecord(raw);
		const externalId = nonEmptyString(record?.apiName);
		const displayName = nonEmptyString(record?.name);
		const traits = record?.traits;
		const cost = record?.cost;
		if (
			!record ||
			!externalId ||
			!displayName ||
			isPlaceholder(externalId, displayName) ||
			!Array.isArray(traits) ||
			traits.length === 0 ||
			!Number.isInteger(cost) ||
			Number(cost) < 1 ||
			Number(cost) > 5
		)
			return [];
		return [
			{
				externalId,
				displayName,
				iconPath: cdragonIconUrl(record.squareIcon, patch),
				tier: Number(cost),
				metadataJson: JSON.stringify(record)
			}
		];
	});
	if (champions.length === 0) throw new Error('CommunityDragon catalog had no usable champions');
	if (!Array.isArray(selectedSet.augments))
		throw new Error('CommunityDragon standard set had no augment references');
	const itemsById = new Map(
		root.items.flatMap((raw) => {
			const record = asRecord(raw);
			const externalId = nonEmptyString(record?.apiName);
			return record && externalId ? [[externalId, record]] : [];
		})
	);
	const augments = selectedSet.augments.map((rawId) => {
		const augmentId = nonEmptyString(rawId);
		const record = augmentId ? itemsById.get(augmentId) : null;
		const externalId = nonEmptyString(record?.apiName);
		const displayName = nonEmptyString(record?.name);
		if (!record || !externalId || !displayName)
			throw new Error(`CommunityDragon augment ${augmentId ?? 'reference'} was unresolved`);
		return {
			externalId,
			displayName,
			iconPath: cdragonIconUrl(record.icon, patch),
			tier: null,
			metadataJson: JSON.stringify(record)
		};
	});
	return {
		setLabel: nonEmptyString(selectedSet.name) ?? `Set ${selectedSet.number}`,
		champions,
		augments
	};
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

/** @param {unknown} error */
function failureCause(error) {
	return error instanceof Error ? error.message : String(error);
}

/** @param {unknown} error */
function deepestError(error) {
	let current = error;
	const seen = new Set();
	while (
		current instanceof Error &&
		'cause' in current &&
		current.cause instanceof Error &&
		!seen.has(current.cause)
	) {
		seen.add(current);
		current = current.cause;
	}
	return current;
}

/** @param {unknown} error @returns {CatalogFailureCategory} */
function failureCategory(error) {
	const message = failureCause(error);
	if (/size limit|exceeds? the configured/i.test(message)) return 'size_limit';
	if (/HTTP \d+|unavailable|failed for https:/i.test(message)) return 'unavailable';
	if (/unsupported .*path|unsafe path|not allowed|unsupported file type/i.test(message))
		return 'invalid_asset';
	if (/invalid|had no|missing|not found|unresolved/i.test(message)) return 'invalid_catalog';
	return 'internal';
}

/** @param {CatalogAttemptFailure} attempt */
function publicAttemptSummary(attempt) {
	const source = attempt.source === 'communitydragon' ? 'CommunityDragon' : 'Data Dragon';
	const reason = {
		unavailable: 'the source was unavailable',
		size_limit: 'the package exceeded the configured size limit',
		invalid_asset: 'the source referenced an unsupported asset',
		invalid_catalog: 'the source returned unusable catalog data',
		internal: 'the source failed unexpectedly'
	}[attempt.category];
	return `${source} failed during ${attempt.phase}: ${reason}.`;
}

/** @param {CatalogAttemptFailure[]} attempts */
function latestSourceAttempts(attempts) {
	/** @type {Map<CatalogSource, CatalogAttemptFailure>} */
	const latest = new Map();
	for (const attempt of attempts) latest.set(attempt.source, attempt);
	return [...latest.values()];
}

/** @param {CatalogAttemptFailure[]} attempts */
function totalFailureMessage(attempts) {
	const details = latestSourceAttempts(attempts).map(publicAttemptSummary).join(' ');
	return `${details || 'Catalog sources failed.'} The prior snapshot remains active.`;
}

/** @param {CatalogSyncPhase} phase @param {string} syncId */
function operationFailureMessage(phase, syncId) {
	if (phase === 'installing')
		return `Catalog images were downloaded, but the local asset snapshot could not be installed. Check MEDIA_ROOT access and server diagnostics. The prior snapshot remains active. Sync reference: ${syncId}.`;
	if (phase === 'activating')
		return `Catalog assets were installed, but the database could not activate the snapshot. Check server diagnostics. The prior snapshot remains active. Sync reference: ${syncId}.`;
	return `Catalog synchronization failed during ${phase}. Check server diagnostics. The prior snapshot remains active. Sync reference: ${syncId}.`;
}

/** @param {unknown} caught */
export function catalogOperatorMessage(caught) {
	if (caught instanceof CatalogSyncError) return caught.message;
	if (!(caught instanceof Error)) return 'Catalog synchronization failed.';
	if (caught.name === 'AbortError') return 'Catalog synchronization was cancelled.';
	const allowed = [
		'Tournament not found',
		'Catalog patch must be',
		'Catalog locale must',
		'CATALOG_MAX_ARCHIVE_GIB',
		'CATALOG_MAX_EXTRACTED_GIB'
	];
	return allowed.some((value) => caught.message.includes(value))
		? caught.message
		: 'Catalog synchronization failed; the prior snapshot remains active.';
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
 * @param {{ patch: string, locale: string, fetchJson: (url: string, init?: RequestInit) => Promise<unknown>, fetchResponse: (url: string, init?: RequestInit) => Promise<Response>, candidateRoot: string, signal?: AbortSignal, onProgress: (progress: CatalogProgress) => void, recordAttempt: (failure: Omit<CatalogAttemptFailure, 'category' | 'cause'> & { error: unknown }) => void }} input
 * @returns {Promise<CatalogCandidate | null>}
 */
async function tryCdragon({
	patch,
	locale,
	fetchJson,
	fetchResponse,
	candidateRoot,
	signal,
	onProgress,
	recordAttempt
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
			recordAttempt({
				source: 'communitydragon',
				locale: cdragonLocale(locale),
				phase: 'resolving',
				error
			});
			return null;
		}
	}
	const requestedLocale = cdragonLocale(locale);
	for (const candidateLocale of localeCandidates(requestedLocale, 'en_us')) {
		const sourceUrl = `${CDRAGON_ROOT}/${resolvedPatch}/cdragon/tft/${candidateLocale}.json`;
		/** @type {CatalogSyncPhase} */
		let phase = 'resolving';
		try {
			emit(onProgress, 'resolving', `Loading CommunityDragon catalog ${candidateLocale}`);
			const normalized = normalizeCdragon(await fetchJson(sourceUrl, { signal }), resolvedPatch);
			const total = [...normalized.champions, ...normalized.augments].filter(
				(asset) => asset.iconPath
			).length;
			let championsDone = 0;
			phase = 'downloading';
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
			recordAttempt({
				source: 'communitydragon',
				locale: candidateLocale,
				phase,
				error
			});
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
 * @param {{ version: string, candidateRoot: string, fetchResponse: (url: string, init?: RequestInit) => Promise<Response>, maxArchiveBytes: number, maxExtractedBytes: number, signal?: AbortSignal, onProgress: (progress: CatalogProgress) => void, onPhase: (phase: CatalogSyncPhase) => void }} input
 */
async function downloadAndExtractDdragon({
	version,
	candidateRoot,
	fetchResponse,
	maxArchiveBytes,
	maxExtractedBytes,
	signal,
	onProgress,
	onPhase
}) {
	for (const format of ['tgz', 'zip']) {
		const sourceUrl = `${DDRAGON_ROOT}/cdn/dragontail-${version}.${format}`;
		onPhase('downloading');
		emit(onProgress, 'downloading', `Downloading Data Dragon ${version}`);
		const response = await fetchResponse(sourceUrl, { signal });
		if (!response.ok) continue;
		const archivePath = path.join(candidateRoot, `dragontail.${format}`);
		await downloadResponseToFile({
			response,
			destination: archivePath,
			maxBytes: maxArchiveBytes,
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
		onPhase('extracting');
		emit(onProgress, 'extracting', 'Extracting the Data Dragon package');
		if (format === 'tgz')
			await extractTarGz({
				archivePath,
				destination: extractedRoot,
				maxExtractedBytes,
				signal
			});
		else
			await extractZip({
				archivePath,
				destination: extractedRoot,
				maxExtractedBytes,
				signal
			});
		await rm(archivePath, { force: true });
		return { sourceUrl, extractedRoot };
	}
	throw new Error(`Data Dragon package ${version} was unavailable`);
}

/**
 * @param {{ patch: string, locale: string, getVersions: () => Promise<string[]>, fetchResponse: (url: string, init?: RequestInit) => Promise<Response>, candidateRoot: string, archiveLimits: { maxArchiveBytes: number, maxExtractedBytes: number }, signal?: AbortSignal, onProgress: (progress: CatalogProgress) => void, recordAttempt: (failure: Omit<CatalogAttemptFailure, 'category' | 'cause'> & { error: unknown }) => void }} input
 * @returns {Promise<CatalogCandidate | null>}
 */
async function tryDdragon({
	patch,
	locale,
	getVersions,
	fetchResponse,
	candidateRoot,
	archiveLimits,
	signal,
	onProgress,
	recordAttempt
}) {
	/** @type {CatalogSyncPhase} */
	let phase = 'resolving';
	let attemptedLocale = ddragonLocale(locale);
	try {
		emit(onProgress, 'resolving', 'Resolving the Data Dragon package version');
		const version = resolveDdragonVersion(await getVersions(), patch);
		if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
		const { sourceUrl, extractedRoot } = await downloadAndExtractDdragon({
			version,
			candidateRoot,
			fetchResponse,
			...archiveLimits,
			signal,
			onProgress,
			onPhase: (nextPhase) => {
				phase = nextPhase;
			}
		});
		const requestedLocale = ddragonLocale(locale);
		for (const candidateLocale of localeCandidates(requestedLocale, 'en_US')) {
			attemptedLocale = candidateLocale;
			phase = 'resolving';
			const championJson = await findExtractedFile(
				extractedRoot,
				`/data/${candidateLocale}/tft-champion.json`
			);
			if (!championJson) {
				recordAttempt({
					source: 'datadragon',
					locale: candidateLocale,
					phase,
					error: new Error(`Data Dragon champion catalog ${candidateLocale} was missing`)
				});
				continue;
			}
			try {
				const champions = normalizeDdragonEntries(await readJson(championJson));
				if (champions.length === 0) {
					recordAttempt({
						source: 'datadragon',
						locale: candidateLocale,
						phase,
						error: new Error(
							`Data Dragon champion catalog ${candidateLocale} had no usable champions`
						)
					});
					continue;
				}
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
				phase = 'installing';
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
				recordAttempt({
					source: 'datadragon',
					locale: candidateLocale,
					phase,
					error
				});
				await rm(path.join(candidateRoot, 'assets'), { recursive: true, force: true });
			}
		}
	} catch (error) {
		if (signal?.aborted) throw error;
		recordAttempt({ source: 'datadragon', locale: attemptedLocale, phase, error });
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
 *   archiveLimits?: { maxArchiveBytes: number, maxExtractedBytes: number },
 *   signal?: AbortSignal,
 *   onProgress?: (progress: CatalogProgress) => void,
 *   logger?: Pick<Console, 'warn' | 'error'>
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
	archiveLimits = catalogArchiveLimits(),
	signal,
	onProgress = () => {},
	logger = console
}) {
	/** @type {CatalogSyncPhase} */
	let currentPhase = 'resolving';
	/** @param {CatalogProgress} progress */
	const reportProgress = (progress) => {
		currentPhase = progress.phase;
		onProgress(progress);
	};
	const [tournament] = await db
		.select({ activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId })
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1);
	if (!tournament) throw new Error('Tournament not found');
	const normalizedPatch = patch.trim();
	if (normalizedPatch !== 'latest' && !/^\d+\.\d+(?:\.\d+)?$/.test(normalizedPatch))
		throw new Error('Catalog patch must be latest or a numeric patch');
	if (
		!Number.isSafeInteger(archiveLimits.maxArchiveBytes) ||
		archiveLimits.maxArchiveBytes <= 0 ||
		!Number.isSafeInteger(archiveLimits.maxExtractedBytes) ||
		archiveLimits.maxExtractedBytes <= 0
	)
		throw new Error('Catalog archive limits must be positive safe integers');
	await cleanupStaleCatalogStaging(mediaRoot);
	const snapshotId = randomUUID();
	/** @type {CatalogAttemptFailure[]} */
	const attempts = [];
	/** @param {Omit<CatalogAttemptFailure, 'category' | 'cause'> & { error: unknown }} failure */
	const recordAttempt = (failure) => {
		const attempt = {
			source: failure.source,
			locale: failure.locale,
			phase: failure.phase,
			category: failureCategory(failure.error),
			cause: failureCause(failure.error)
		};
		attempts.push(attempt);
		logger.warn('catalog_sync_attempt_failed', {
			syncId: snapshotId,
			tournamentId,
			...attempt
		});
	};
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
			onProgress: reportProgress,
			recordAttempt
		});
		if (!candidate) {
			const ddragonRoot = path.join(syncRoot, 'datadragon');
			candidate = await tryDdragon({
				patch: normalizedPatch,
				locale,
				getVersions,
				fetchResponse,
				candidateRoot: ddragonRoot,
				archiveLimits,
				signal,
				onProgress: reportProgress,
				recordAttempt
			});
		}
		if (!candidate) {
			const message = totalFailureMessage(attempts);
			logger.error('catalog_sync_failed', {
				syncId: snapshotId,
				tournamentId,
				activeSnapshotId: tournament.activeCatalogSnapshotId,
				attempts
			});
			throw new CatalogSyncError(message, attempts);
		}
		const communityFailure = attempts
			.filter((attempt) => attempt.source === 'communitydragon')
			.at(-1);
		if (candidate.source === 'datadragon' && communityFailure)
			candidate.warning = combineWarnings([
				`CommunityDragon failed during ${communityFailure.phase}; Data Dragon was used instead.`,
				candidate.warning
			]);
		candidate.champions = candidate.champions.map((asset) => ({
			...asset,
			iconPath: asset.iconPath ? pinSnapshotPath(asset.iconPath, snapshotId) : null
		}));
		candidate.augments = candidate.augments.map((asset) => ({
			...asset,
			iconPath: asset.iconPath ? pinSnapshotPath(asset.iconPath, snapshotId) : null
		}));
		emit(reportProgress, 'installing', 'Installing the local catalog asset snapshot');
		await promoteCatalogAssets(mediaRoot, snapshotId, candidate.source);
		promoted = true;
		emit(reportProgress, 'activating', 'Activating the local catalog snapshot');
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
		if (!(error instanceof CatalogSyncError)) {
			const mediaPath = path.resolve(mediaRoot);
			const diagnosticError = deepestError(error);
			logger.error('catalog_sync_unexpected_failure', {
				syncId: snapshotId,
				tournamentId,
				activeSnapshotId: tournament.activeCatalogSnapshotId,
				phase: currentPhase,
				cause: failureCause(diagnosticError).replaceAll(mediaPath, '<MEDIA_ROOT>'),
				...(diagnosticError instanceof Error &&
				'code' in diagnosticError &&
				typeof diagnosticError.code === 'string'
					? { code: diagnosticError.code }
					: {}),
				...(diagnosticError instanceof Error &&
				'syscall' in diagnosticError &&
				typeof diagnosticError.syscall === 'string'
					? { syscall: diagnosticError.syscall }
					: {})
			});
		}
		if (promoted) await removeCatalogAssets(mediaRoot, snapshotId);
		throw error instanceof CatalogSyncError
			? error
			: new CatalogSyncError(operationFailureMessage(currentPhase, snapshotId), attempts);
	} finally {
		await removeCatalogStaging(mediaRoot, snapshotId);
	}
}
