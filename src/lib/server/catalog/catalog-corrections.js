import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import {
	catalogAugments,
	catalogChampions,
	catalogCorrections,
	catalogSnapshots
} from '../db/schema/catalog.js';
import { tournaments } from '../db/schema/tournaments.js';
import { runDestructiveMaintenance } from '../winner-boards/maintenance.js';
import { assertCatalogCorrectionImagePath } from './catalog-media.js';

const RESOURCE_KINDS = new Set(['champion', 'augment']);
const OPERATIONS = new Set(['add', 'override', 'exclude']);

/** @typedef {{ externalId: string, displayName: string, iconPath: string | null, tier: number | null, metadataJson: string, correctionId: string | null, isExcluded: boolean, provenanceJson: string, [key: string]: any }} MaterializedCatalogResource */

/** @param {unknown} value @param {string} label */
function requiredText(value, label) {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
	return value.trim();
}

/** @param {unknown} value */
function optionalText(value) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {unknown} value */
function optionalTier(value) {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)
		throw new Error('Catalog correction tier must be an integer from 1 to 5');
	return value;
}

/**
 * @param {Record<string, unknown>} input
 * @param {{ requireId?: boolean }} [options]
 */
function normalizedCorrection(input, { requireId = false } = {}) {
	const id = optionalText(input.id);
	if (requireId && !id) throw new Error('Catalog correction ID is required');
	const resourceKind = requiredText(input.resourceKind, 'Catalog correction resource kind');
	if (!RESOURCE_KINDS.has(resourceKind))
		throw new Error('Catalog correction resource kind is invalid');
	const operation = requiredText(input.operation, 'Catalog correction operation');
	if (!OPERATIONS.has(operation)) throw new Error('Catalog correction operation is invalid');
	const manualExternalId = optionalText(input.manualExternalId);
	const targetExternalId = optionalText(input.targetExternalId);
	if (operation === 'add' && !manualExternalId)
		throw new Error('Add correction requires a manual external ID');
	if (operation !== 'add' && !targetExternalId)
		throw new Error(
			`${operation === 'exclude' ? 'Exclude' : 'Override'} correction requires a target external ID`
		);
	const imagePathOverride = optionalText(input.imagePathOverride);
	if (imagePathOverride) assertCatalogCorrectionImagePath(imagePathOverride);
	return {
		...(id ? { id } : {}),
		canonicalSetKey: optionalText(input.canonicalSetKey),
		patchLabel: requiredText(input.patchLabel, 'Catalog correction patch label'),
		resourceKind,
		operation,
		targetExternalId: operation === 'add' ? null : targetExternalId,
		manualExternalId: operation === 'add' ? manualExternalId : null,
		displayNameOverride: optionalText(input.displayNameOverride),
		tierOverride: optionalTier(input.tierOverride),
		imagePathOverride
	};
}

/** @param {Record<string, unknown>} correction @param {string | null} canonicalSetKey @param {string} patchLabel */
function matchesScope(correction, canonicalSetKey, patchLabel) {
	const correctionSetKey = optionalText(correction.canonicalSetKey);
	return correctionSetKey
		? correctionSetKey === canonicalSetKey
		: requiredText(correction.patchLabel, 'Catalog correction patch label') === patchLabel;
}

/** @param {unknown} value */
function validJson(value) {
	if (typeof value !== 'string') return false;
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}

/** @param {unknown} value @param {string} externalId */
function parsedProvenance(value, externalId) {
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
		} catch {
			// Fall through to a safe upstream provenance record.
		}
	}
	return { source: 'upstream', externalId };
}

/** @param {Record<string, any>} previous @param {string} correctionId @param {'override' | 'exclude'} operation */
function correctionProvenance(previous, correctionId, operation) {
	return JSON.stringify({
		source: previous.source === 'manual' ? 'manual' : 'upstream',
		correctionId,
		operation,
		previous
	});
}

/**
 * Materialize normalized upstream records through persisted corrections without
 * mutating either input collection.
 *
 * @param {{
 *   resources: Array<Record<string, any>>,
 *   corrections: Array<Record<string, any>>,
 *   resourceKind?: 'champion' | 'augment',
 *   canonicalSetKey?: string | null,
 *   patchLabel: string
 * }} input
 * @returns {MaterializedCatalogResource[]}
 */
export function applyCatalogCorrections({
	resources,
	corrections,
	resourceKind,
	canonicalSetKey = null,
	patchLabel
}) {
	if (!Array.isArray(resources) || !Array.isArray(corrections))
		throw new Error('Catalog correction inputs must be arrays');
	const normalizedPatch = requiredText(patchLabel, 'Catalog patch label');
	const normalizedSetKey = optionalText(canonicalSetKey);
	let normalizedKind = resourceKind;
	if (!normalizedKind) {
		const kinds = new Set(
			corrections
				.map((correction) => optionalText(correction.resourceKind))
				.filter((kind) => RESOURCE_KINDS.has(/** @type {string} */ (kind)))
		);
		if (kinds.size === 1) normalizedKind = /** @type {'champion' | 'augment'} */ ([...kinds][0]);
	}
	if (!normalizedKind) {
		const kinds = new Set(
			resources
				.map((resource) => optionalText(resource.resourceKind))
				.filter((kind) => RESOURCE_KINDS.has(/** @type {string} */ (kind)))
		);
		if (kinds.size === 1) normalizedKind = /** @type {'champion' | 'augment'} */ ([...kinds][0]);
	}
	if (!normalizedKind && corrections.length === 0) normalizedKind = 'champion';
	if (!normalizedKind || !RESOURCE_KINDS.has(normalizedKind))
		throw new Error('Catalog resource kind is required');

	/** @type {MaterializedCatalogResource[]} */
	const materialized = resources.map((resource) => {
		const externalId = requiredText(resource.externalId, 'Catalog resource external ID');
		return {
			...resource,
			externalId,
			displayName: requiredText(resource.displayName, 'Catalog resource display name'),
			iconPath: optionalText(resource.iconPath),
			tier: optionalTier(resource.tier),
			metadataJson: validJson(resource.metadataJson) ? resource.metadataJson : '{}',
			correctionId: null,
			isExcluded: false,
			provenanceJson: validJson(resource.provenanceJson)
				? resource.provenanceJson
				: JSON.stringify({ source: 'upstream', externalId })
		};
	});
	const byExternalId = new Map();
	for (const resource of materialized) {
		if (byExternalId.has(resource.externalId))
			throw new Error(
				`Catalog ${normalizedKind} resources must have a unique external ID: ${resource.externalId}`
			);
		byExternalId.set(resource.externalId, resource);
	}

	const matching = corrections.filter(
		(correction) =>
			optionalText(correction.resourceKind) === normalizedKind &&
			matchesScope(correction, normalizedSetKey, normalizedPatch)
	);
	for (const rawCorrection of matching) {
		const correction = normalizedCorrection(rawCorrection, { requireId: true });
		const correctionId = /** @type {string} */ (correction.id);
		if (correction.operation === 'add') {
			const externalId = /** @type {string} */ (correction.manualExternalId);
			if (byExternalId.has(externalId))
				throw new Error(
					`Catalog ${normalizedKind} resources must have a unique external ID: ${externalId}`
				);
			const manual = {
				externalId,
				displayName: correction.displayNameOverride ?? externalId,
				iconPath: correction.imagePathOverride,
				tier: correction.tierOverride,
				metadataJson: '{}',
				correctionId,
				isExcluded: false,
				provenanceJson: JSON.stringify({
					source: 'manual',
					correctionId,
					operation: 'add'
				})
			};
			materialized.push(manual);
			byExternalId.set(externalId, manual);
			continue;
		}
		const target = byExternalId.get(correction.targetExternalId);
		if (!target) continue;
		const previousProvenance = parsedProvenance(target.provenanceJson, target.externalId);
		if (correction.operation === 'override') {
			if (correction.displayNameOverride !== null)
				target.displayName = correction.displayNameOverride;
			if (correction.tierOverride !== null) target.tier = correction.tierOverride;
			if (correction.imagePathOverride !== null) target.iconPath = correction.imagePathOverride;
			if (target.isExcluded) continue;
		} else {
			target.isExcluded = true;
		}
		target.correctionId = correctionId;
		target.provenanceJson = correctionProvenance(
			previousProvenance,
			correctionId,
			/** @type {'override' | 'exclude'} */ (correction.operation)
		);
	}

	return materialized;
}

/**
 * @param {any} database
 * @param {Record<string, unknown>} input
 */
export async function createCatalogCorrection(database, input) {
	const correction = normalizedCorrection(input);
	const now = new Date();
	const [created] = await database
		.insert(catalogCorrections)
		.values({ id: randomUUID(), ...correction, createdAt: now, updatedAt: now })
		.returning();
	if (!created) throw new Error('Catalog correction could not be created');
	return created;
}

const MUTABLE_FIELDS = [
	'canonicalSetKey',
	'patchLabel',
	'resourceKind',
	'operation',
	'targetExternalId',
	'manualExternalId',
	'displayNameOverride',
	'tierOverride',
	'imagePathOverride'
];

/**
 * @param {any} database
 * @param {Record<string, unknown> & { correctionId?: string }} input
 */
export async function updateCatalogCorrection(database, input) {
	const correctionId = requiredText(input.correctionId, 'Catalog correction ID');
	const [existing] = await database
		.select()
		.from(catalogCorrections)
		.where(eq(catalogCorrections.id, correctionId))
		.limit(1);
	if (!existing) throw new Error('Catalog correction not found');
	const merged = { ...existing };
	for (const field of MUTABLE_FIELDS) {
		if (Object.hasOwn(input, field)) merged[field] = input[field];
	}
	const correction = normalizedCorrection(merged);
	const [updated] = await database
		.update(catalogCorrections)
		.set({ ...correction, updatedAt: new Date() })
		.where(eq(catalogCorrections.id, correctionId))
		.returning();
	if (!updated) throw new Error('Catalog correction not found');
	return updated;
}

/** @param {'champion' | 'augment'} resourceKind */
function resourceTable(resourceKind) {
	if (resourceKind === 'champion') return catalogChampions;
	if (resourceKind === 'augment') return catalogAugments;
	throw new Error('Catalog correction resource kind is invalid');
}

/**
 * @param {any} database
 * @param {{ tournamentId: string, resourceKind: 'champion' | 'augment', resourceId: string, confirmReset?: boolean }} input
 */
export async function excludeCatalogResource(database, input) {
	const tournamentId = requiredText(input.tournamentId, 'Tournament ID');
	const resourceId = requiredText(input.resourceId, 'Catalog resource ID');
	const table = resourceTable(input.resourceKind);
	const outcome = await runDestructiveMaintenance(database, {
		target: { kind: input.resourceKind, id: resourceId },
		confirmReset: input.confirmReset === true,
		operation: async (transaction) => {
			const [tournament] = await transaction
				.select({ activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId })
				.from(tournaments)
				.where(eq(tournaments.id, tournamentId))
				.limit(1);
			if (!tournament?.activeCatalogSnapshotId) throw new Error('Tournament has no active catalog');
			const [resource] = await transaction
				.select()
				.from(table)
				.where(
					and(
						eq(table.id, resourceId),
						eq(table.catalogSnapshotId, tournament.activeCatalogSnapshotId)
					)
				)
				.limit(1);
			if (!resource) throw new Error('Catalog resource not found in the active snapshot');
			if (resource.isExcluded)
				return { excluded: true, reset: false, correctionId: resource.correctionId };
			const [snapshot] = await transaction
				.select({
					canonicalSetKey: catalogSnapshots.canonicalSetKey,
					patchLabel: catalogSnapshots.patchLabel
				})
				.from(catalogSnapshots)
				.where(eq(catalogSnapshots.id, resource.catalogSnapshotId))
				.limit(1);
			if (!snapshot) throw new Error('Catalog snapshot not found');
			const correction = await createCatalogCorrection(transaction, {
				canonicalSetKey: snapshot.canonicalSetKey,
				patchLabel: snapshot.patchLabel,
				resourceKind: input.resourceKind,
				operation: 'exclude',
				targetExternalId: resource.externalId
			});
			const previousProvenance = parsedProvenance(resource.provenanceJson, resource.externalId);
			await transaction
				.update(table)
				.set({
					correctionId: correction.id,
					isExcluded: true,
					provenanceJson: correctionProvenance(previousProvenance, correction.id, 'exclude')
				})
				.where(eq(table.id, resourceId));
			return { excluded: true, correctionId: correction.id };
		}
	});
	if (outcome.kind === 'reset_required') return outcome;
	return { ...outcome.value, reset: outcome.reset };
}

/**
 * @param {any} database
 * @param {{ tournamentId: string, resourceKind: 'champion' | 'augment', resourceId: string, confirmReset?: boolean }} input
 */
export async function restoreCatalogResource(database, input) {
	const tournamentId = requiredText(input.tournamentId, 'Tournament ID');
	const resourceId = requiredText(input.resourceId, 'Catalog resource ID');
	const table = resourceTable(input.resourceKind);
	const outcome = await runDestructiveMaintenance(database, {
		target: { kind: input.resourceKind, id: resourceId },
		confirmReset: input.confirmReset === true,
		operation: async (transaction) => {
			const [tournament] = await transaction
				.select({ activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId })
				.from(tournaments)
				.where(eq(tournaments.id, tournamentId))
				.limit(1);
			if (!tournament?.activeCatalogSnapshotId) throw new Error('Tournament has no active catalog');
			const [resource] = await transaction
				.select()
				.from(table)
				.where(
					and(
						eq(table.id, resourceId),
						eq(table.catalogSnapshotId, tournament.activeCatalogSnapshotId)
					)
				)
				.limit(1);
			if (!resource) throw new Error('Catalog resource not found in the active snapshot');
			if (!resource.isExcluded || !resource.correctionId) return { restored: false };
			const [correction] = await transaction
				.select({ operation: catalogCorrections.operation })
				.from(catalogCorrections)
				.where(eq(catalogCorrections.id, resource.correctionId))
				.limit(1);
			if (correction?.operation !== 'exclude')
				throw new Error('Catalog resource is not linked to an exclusion correction');
			const linkedResources = await transaction
				.select()
				.from(table)
				.where(eq(table.correctionId, resource.correctionId));
			for (const linkedResource of linkedResources) {
				const exclusionProvenance = parsedProvenance(
					linkedResource.provenanceJson,
					linkedResource.externalId
				);
				const previousProvenance =
					typeof exclusionProvenance.previous === 'object' &&
					exclusionProvenance.previous !== null &&
					!Array.isArray(exclusionProvenance.previous)
						? exclusionProvenance.previous
						: { source: 'upstream', externalId: linkedResource.externalId };
				const previousCorrectionId = optionalText(previousProvenance.correctionId);
				const remainsExcluded = previousProvenance.operation === 'exclude';
				if (remainsExcluded && !previousCorrectionId)
					throw new Error('Catalog exclusion provenance is missing its prior correction');
				await transaction
					.update(table)
					.set({
						correctionId: previousCorrectionId,
						isExcluded: remainsExcluded,
						provenanceJson: JSON.stringify(previousProvenance)
					})
					.where(eq(table.id, linkedResource.id));
			}
			await transaction
				.delete(catalogCorrections)
				.where(eq(catalogCorrections.id, resource.correctionId));
			return { restored: true };
		}
	});
	if (outcome.kind === 'reset_required') return outcome;
	return { ...outcome.value, reset: outcome.reset };
}

/**
 * Load only corrections capable of matching a candidate scope.
 *
 * @param {any} database
 * @param {{ canonicalSetKey?: string | null, patchLabel: string }} scope
 */
export async function loadMatchingCatalogCorrections(database, scope) {
	const canonicalSetKey = optionalText(scope.canonicalSetKey);
	const patchLabel = requiredText(scope.patchLabel, 'Catalog patch label');
	const where = canonicalSetKey
		? or(
				eq(catalogCorrections.canonicalSetKey, canonicalSetKey),
				and(
					isNull(catalogCorrections.canonicalSetKey),
					eq(catalogCorrections.patchLabel, patchLabel)
				)
			)
		: and(
				isNull(catalogCorrections.canonicalSetKey),
				eq(catalogCorrections.patchLabel, patchLabel)
			);
	return database
		.select()
		.from(catalogCorrections)
		.where(where)
		.orderBy(asc(catalogCorrections.createdAt), asc(catalogCorrections.id));
}
