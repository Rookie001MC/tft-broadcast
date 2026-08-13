import { z } from 'zod';

export const CANONICAL_TFT_MATCH_CONTRACT_VERSION = 1;

const EXCLUDED_EXTERNAL_IDS = new Set(['TFT17_IvernMinion', 'TFT17_Summon']);

const rawMatchSchema = z
	.object({
		metadata: z
			.object({
				match_id: z.string().trim().min(1),
				participants: z.array(z.string().trim().min(1))
			})
			.passthrough(),
		info: z
			.object({
				queueId: z.number().int().optional(),
				queue_id: z.number().int().optional(),
				game_datetime: z.number().finite(),
				participants: z.array(
					z
						.object({
							puuid: z.string(),
							placement: z.number().int(),
							units: z.array(
								z.object({ character_id: z.string(), tier: z.number().int() }).passthrough()
							),
							augments: z.array(z.string()).optional()
						})
						.passthrough()
				)
			})
			.passthrough()
	})
	.passthrough();

const championSchema = z
	.object({
		catalogChampionId: z.string().min(1),
		externalId: z.string().min(1),
		displayName: z.string().min(1),
		iconPath: z.string().nullable(),
		starLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
		displayOrder: z.number().int().nonnegative()
	})
	.strict();

const snapshotSchema = z
	.object({
		contractVersion: z.literal(CANONICAL_TFT_MATCH_CONTRACT_VERSION),
		matchId: z.string().min(1),
		region: z.string().min(1),
		queueId: z.number().int(),
		completedAt: z.string().datetime({ offset: true }),
		fetchedAt: z.string().datetime({ offset: true }),
		participants: z.array(
			z
				.object({
					puuid: z.string().min(1),
					placement: z.number().int().min(1).max(8),
					champions: z.array(championSchema)
				})
				.strict()
		)
	})
	.strict();

/** Error safe for operator-facing display. */
export class TftMatchContractError extends Error {
	/** @param {string} operatorMessage @param {string[]} [unresolvedExternalIds] */
	constructor(operatorMessage, unresolvedExternalIds = []) {
		super(operatorMessage);
		this.name = 'TftMatchContractError';
		this.operatorMessage = operatorMessage;
		this.unresolvedExternalIds = [...new Set(unresolvedExternalIds)].sort();
	}
}

/** @param {unknown} value @returns {string} */
function requiredText(value) {
	if (typeof value !== 'string' || !value.trim())
		throw new TftMatchContractError('TFT match data is invalid.');
	return value.trim();
}

/** @param {unknown} value */
function parseRawMatch(value) {
	const parsed = rawMatchSchema.safeParse(value);
	if (!parsed.success) throw new TftMatchContractError('TFT match data is invalid.');
	return parsed.data;
}

/** @param {unknown} value */
function isoDate(value) {
	const date = value instanceof Date ? value : new Date(/** @type {any} */ (value));
	if (Number.isNaN(date.getTime()))
		throw new TftMatchContractError('TFT match timestamp is invalid.');
	return date.toISOString();
}

/** @param {unknown} value */
function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

/** @param {Array<{ id: unknown, externalId: unknown, displayName: unknown, iconPath?: unknown, isExcluded?: unknown }>} catalogChampions */
function catalogByExternalId(catalogChampions) {
	const catalog = new Map();
	const excludedExternalIds = new Set(EXCLUDED_EXTERNAL_IDS);
	const retainedCatalogIds = new Set();
	for (const row of catalogChampions) {
		const externalId = requiredText(row?.externalId);
		if (row?.isExcluded || EXCLUDED_EXTERNAL_IDS.has(externalId)) {
			excludedExternalIds.add(externalId);
			continue;
		}
		const champion = {
			catalogChampionId: requiredText(row?.id),
			externalId,
			displayName: requiredText(row?.displayName),
			iconPath: typeof row?.iconPath === 'string' ? row.iconPath : null
		};
		if (catalog.has(externalId) || retainedCatalogIds.has(champion.catalogChampionId))
			throw new TftMatchContractError('Catalog champion mappings are invalid.');
		catalog.set(externalId, champion);
		retainedCatalogIds.add(champion.catalogChampionId);
	}
	return { catalog, excludedExternalIds };
}

/** @param {unknown} value @returns {import('$lib/tft-match.js').CanonicalTftMatchSnapshot} */
export function parseCanonicalTftMatchSnapshot(value) {
	const parsed = snapshotSchema.safeParse(value);
	if (!parsed.success) throw new TftMatchContractError('TFT match snapshot is invalid.');
	const placements = parsed.data.participants
		.map((participant) => participant.placement)
		.sort((a, b) => a - b);
	const puuids = parsed.data.participants.map((participant) => participant.puuid);
	if (
		placements.length !== 8 ||
		placements.some((placement, index) => placement !== index + 1) ||
		new Set(puuids).size !== puuids.length
	)
		throw new TftMatchContractError('TFT match snapshot is invalid.');
	for (const participant of parsed.data.participants) {
		const catalogChampionIds = new Set();
		const externalIds = new Set();
		if (
			participant.champions.some((champion, index) => {
				if (champion.displayOrder !== index) return true;
				if (
					catalogChampionIds.has(champion.catalogChampionId) ||
					externalIds.has(champion.externalId)
				)
					return true;
				catalogChampionIds.add(champion.catalogChampionId);
				externalIds.add(champion.externalId);
				return false;
			})
		)
			throw new TftMatchContractError('TFT match snapshot is invalid.');
	}
	return /** @type {import('$lib/tft-match.js').CanonicalTftMatchSnapshot} */ (
		deepFreeze(structuredClone(parsed.data))
	);
}

/**
 * @param {{ payload: unknown, requestedMatchId: string, selectedPuuid: string, region: string, catalogChampions: Array<any>, fetchedAt: Date | string }} input
 * @returns {import('$lib/tft-match.js').CanonicalTftMatchSnapshot}
 */
export function normalizeTftMatch(input) {
	const raw = parseRawMatch(input?.payload);
	const requestedMatchId = requiredText(input?.requestedMatchId);
	const selectedPuuid = requiredText(input?.selectedPuuid);
	const region = requiredText(input?.region);
	if (raw.metadata.match_id !== requestedMatchId)
		throw new TftMatchContractError('Fetched match ID does not match the requested match.');
	const queueId = raw.info.queueId ?? raw.info.queue_id;
	if (!Number.isInteger(queueId)) throw new TftMatchContractError('TFT match queue is invalid.');
	const metadataPuuids = raw.metadata.participants.map(requiredText);
	const participants = raw.info.participants;
	const participantPuuids = participants.map((participant) => requiredText(participant.puuid));
	if (
		metadataPuuids.length !== 8 ||
		new Set(metadataPuuids).size !== metadataPuuids.length ||
		new Set(participantPuuids).size !== participantPuuids.length ||
		metadataPuuids.some((puuid) => !participantPuuids.includes(puuid))
	)
		throw new TftMatchContractError('TFT match participants are invalid.');
	const placements = participants.map((participant) => participant.placement).sort((a, b) => a - b);
	if (participants.length !== 8 || placements.some((placement, index) => placement !== index + 1))
		throw new TftMatchContractError('TFT match placements are incomplete.');
	if (!participantPuuids.includes(selectedPuuid))
		throw new TftMatchContractError('Selected player was not found in the match.');
	const { catalog, excludedExternalIds } = catalogByExternalId(
		Array.isArray(input?.catalogChampions) ? input.catalogChampions : []
	);
	const unresolvedExternalIds = new Set();
	const normalizedParticipants = participants.map((participant) => {
		const seenCatalogChampionIds = new Set();
		const champions = [];
		for (const unit of participant.units) {
			const externalId = requiredText(unit.character_id);
			if (unit.tier < 1 || unit.tier > 3)
				throw new TftMatchContractError('TFT champion tier is invalid.');
			if (excludedExternalIds.has(externalId)) continue;
			const mapped = catalog.get(externalId);
			if (!mapped) {
				unresolvedExternalIds.add(externalId);
				continue;
			}
			if (seenCatalogChampionIds.has(mapped.catalogChampionId))
				throw new TftMatchContractError('TFT match champions are invalid.');
			seenCatalogChampionIds.add(mapped.catalogChampionId);
			champions.push({ ...mapped, starLevel: unit.tier, displayOrder: champions.length });
		}
		return { puuid: participant.puuid.trim(), placement: participant.placement, champions };
	});
	if (unresolvedExternalIds.size > 0)
		throw new TftMatchContractError(
			'Some TFT champions could not be mapped to the active catalog.',
			[...unresolvedExternalIds]
		);
	return parseCanonicalTftMatchSnapshot({
		contractVersion: CANONICAL_TFT_MATCH_CONTRACT_VERSION,
		matchId: raw.metadata.match_id,
		region,
		queueId,
		completedAt: isoDate(raw.info.game_datetime),
		fetchedAt: isoDate(input?.fetchedAt),
		participants: normalizedParticipants.sort((left, right) => left.placement - right.placement)
	});
}

/** @param {unknown} snapshot @param {string} selectedPuuid */
export function previewRowFromSnapshot(snapshot, selectedPuuid) {
	const parsed = parseCanonicalTftMatchSnapshot(snapshot);
	const selected = parsed.participants.find((participant) => participant.puuid === selectedPuuid);
	if (!selected)
		throw new TftMatchContractError('Selected player was not found in the match snapshot.');
	return deepFreeze({
		contractVersion: parsed.contractVersion,
		matchId: parsed.matchId,
		region: parsed.region,
		queueId: parsed.queueId,
		completedAt: parsed.completedAt,
		fetchedAt: parsed.fetchedAt,
		selectedPuuid: selected.puuid,
		placement: selected.placement,
		champions: structuredClone(selected.champions)
	});
}
