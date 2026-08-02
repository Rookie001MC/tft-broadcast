import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { tournaments } from '../db/schema/tournaments.js';

const CDRAGON_ROOT = 'https://raw.communitydragon.org';
const DDRAGON_ROOT = 'https://ddragon.leagueoflegends.com';

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

/** @param {unknown} versions */
function immutableDdragonPatch(versions) {
	if (!Array.isArray(versions)) throw new Error('Data Dragon versions response was invalid');
	const version = versions.find(
		(value) => typeof value === 'string' && /^\d+\.\d+(?:\.\d+)?$/.test(value)
	);
	if (!version) throw new Error('Data Dragon versions response was empty');
	return version;
}

/**
 * @param {unknown} rawPath
 * @param {string} patch
 */
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

/**
 * @param {unknown} filename
 * @param {string} version
 * @param {'tft-champion' | 'tft-augment'} assetType
 */
function ddragonIconUrl(filename, version, assetType) {
	const value = nonEmptyString(filename);
	if (!value) return null;
	return requireHttps(
		`${DDRAGON_ROOT}/cdn/${version}/img/${assetType}/${encodeURIComponent(value)}`
	);
}

/** @param {string} externalId @param {string} displayName */
function isPlaceholder(externalId, displayName) {
	return /(?:^|_)(?:blank|placeholder)$/i.test(externalId) || /^placeholder$/i.test(displayName);
}

/**
 * @param {unknown} payload
 * @param {string} patch
 */
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
		const tier =
			typeof record.cost === 'number' && Number.isInteger(record.cost) ? record.cost : null;
		return [
			{
				externalId,
				displayName,
				iconPath: cdragonIconUrl(record.squareIcon, patch),
				tier,
				metadataJson: JSON.stringify(record)
			}
		];
	});
	if (champions.length === 0) throw new Error('CommunityDragon catalog had no usable champions');

	/** @type {unknown[]} */
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

	return {
		setLabel: nonEmptyString(selectedSet?.name) ?? setKey,
		champions,
		augments
	};
}

/**
 * @param {unknown} payload
 * @param {string} version
 * @param {'tft-champion' | 'tft-augment'} assetType
 */
function normalizeDdragonEntries(payload, version, assetType) {
	const data = asRecord(asRecord(payload)?.data);
	if (!data) throw new Error('Data Dragon catalog payload was invalid');
	return Object.entries(data).flatMap(([key, raw]) => {
		const record = asRecord(raw);
		const externalId = nonEmptyString(record?.id) ?? nonEmptyString(key);
		const displayName = nonEmptyString(record?.name);
		if (!record || !externalId || !displayName || isPlaceholder(externalId, displayName)) return [];
		const image = asRecord(record.image);
		const tier =
			typeof record.tier === 'number' && Number.isInteger(record.tier) ? record.tier : null;
		return [
			{
				externalId,
				displayName,
				iconPath: ddragonIconUrl(image?.full, version, assetType),
				tier,
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

/**
 * @typedef {{
 *   externalId: string,
 *   displayName: string,
 *   iconPath: string | null,
 *   tier: number | null,
 *   metadataJson: string
 * }} NormalizedAsset
 */

/**
 * @typedef {{
 *   source: 'communitydragon' | 'datadragon',
 *   sourceUrl: string,
 *   locale: string,
 *   patchLabel: string,
 *   setLabel: string | null,
 *   champions: NormalizedAsset[],
 *   augments: NormalizedAsset[],
 *   warning: string | null
 * }} CatalogCandidate
 */

/**
 * @param {{ patch: string, locale: string, fetchJson: (url: string) => Promise<unknown> }} input
 * @returns {Promise<CatalogCandidate | null>}
 */
async function tryCdragon({ patch, locale, fetchJson }) {
	let resolvedPatch = patch;
	if (patch === 'latest') {
		try {
			resolvedPatch = immutableCdragonPatch(
				await fetchJson(`${CDRAGON_ROOT}/latest/content-metadata.json`)
			);
		} catch {
			return null;
		}
	}

	const requestedLocale = cdragonLocale(locale);
	for (const candidateLocale of localeCandidates(requestedLocale, 'en_us')) {
		const sourceUrl = `${CDRAGON_ROOT}/${resolvedPatch}/cdragon/tft/${candidateLocale}.json`;
		try {
			const normalized = normalizeCdragon(await fetchJson(sourceUrl), resolvedPatch);
			return {
				source: 'communitydragon',
				sourceUrl,
				locale: candidateLocale,
				patchLabel: resolvedPatch,
				setLabel: normalized.setLabel,
				champions: normalized.champions,
				augments: normalized.augments,
				warning: combineWarnings([
					candidateLocale !== requestedLocale
						? `CommunityDragon fell back to locale ${candidateLocale}.`
						: null,
					normalized.augments.length === 0
						? 'Augments were unavailable from CommunityDragon.'
						: null
				])
			};
		} catch {
			// Try the next documented source/locale without activating partial data.
		}
	}
	return null;
}

/**
 * @param {{ patch: string, locale: string, fetchJson: (url: string) => Promise<unknown> }} input
 * @returns {Promise<CatalogCandidate | null>}
 */
async function tryDdragon({ patch, locale, fetchJson }) {
	let resolvedVersion = patch;
	if (patch === 'latest') {
		try {
			resolvedVersion = immutableDdragonPatch(await fetchJson(`${DDRAGON_ROOT}/api/versions.json`));
		} catch {
			return null;
		}
	}

	const requestedLocale = ddragonLocale(locale);
	for (const candidateLocale of localeCandidates(requestedLocale, 'en_US')) {
		const sourceUrl = `${DDRAGON_ROOT}/cdn/${resolvedVersion}/data/${candidateLocale}/tft-champion.json`;
		try {
			const champions = normalizeDdragonEntries(
				await fetchJson(sourceUrl),
				resolvedVersion,
				'tft-champion'
			);
			if (champions.length === 0) throw new Error('Data Dragon catalog had no usable champions');

			/** @type {NormalizedAsset[]} */
			let augments = [];
			let augmentWarning = null;
			try {
				const augmentUrl = `${DDRAGON_ROOT}/cdn/${resolvedVersion}/data/${candidateLocale}/tft-augments.json`;
				augments = normalizeDdragonEntries(
					await fetchJson(augmentUrl),
					resolvedVersion,
					'tft-augment'
				);
				if (augments.length === 0) augmentWarning = 'Augments were unavailable from Data Dragon.';
			} catch {
				augmentWarning = 'Augments were unavailable from Data Dragon.';
			}

			return {
				source: 'datadragon',
				sourceUrl,
				locale: candidateLocale,
				patchLabel: resolvedVersion,
				setLabel: null,
				champions,
				augments,
				warning: combineWarnings([
					candidateLocale !== requestedLocale
						? `Data Dragon fell back to locale ${candidateLocale}.`
						: null,
					augmentWarning
				])
			};
		} catch {
			// Try the next documented locale without writing partial data.
		}
	}
	return null;
}

/**
 * Fetch, normalize, and atomically pin a TFT catalog for a tournament.
 *
 * @param {{
 *   db: any,
 *   tournamentId: string,
 *   patch: string,
 *   locale: string,
 *   fetchJson: (url: string) => Promise<unknown>
 * }} input
 */
export async function syncAndActivateCatalog({ db, tournamentId, patch, locale, fetchJson }) {
	const [tournament] = await db
		.select({ activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId })
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1);
	if (!tournament) throw new Error('Tournament not found');

	const normalizedPatch = patch.trim();
	if (normalizedPatch !== 'latest' && !/^\d+\.\d+(?:\.\d+)?$/.test(normalizedPatch))
		throw new Error('Catalog patch must be latest or a numeric patch');

	const candidate =
		(await tryCdragon({ patch: normalizedPatch, locale, fetchJson })) ??
		(await tryDdragon({ patch: normalizedPatch, locale, fetchJson }));
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

	const snapshotId = randomUUID();
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
		if (candidate.augments.length > 0) {
			await tx.insert(catalogAugments).values(
				candidate.augments.map((augment) => ({
					id: randomUUID(),
					catalogSnapshotId: snapshotId,
					...augment
				}))
			);
		}
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
}
