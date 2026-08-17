import { z } from 'zod';

export const CANONICAL_TFT_MATCH_CONTRACT_VERSION = 1;

export class TftMatchContractError extends Error {
	/**
	 * @param {string} operatorMessage
	 * @param {{ unresolvedExternalIds?: string[], cause?: unknown }} [options]
	 */
	constructor(operatorMessage, options = {}) {
		super(operatorMessage, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'TftMatchContractError';
		this.operatorMessage = operatorMessage;
		this.unresolvedExternalIds = [...(options.unresolvedExternalIds ?? [])].sort();
	}
}

const nonBlank = z.string().trim().min(1);
const rawUnitSchema = z
	.object({
		character_id: z.string(),
		tier: z.number()
	})
	.passthrough();
const rawParticipantSchema = z
	.object({
		puuid: z.string(),
		riotIdGameName: z.string().optional().nullable(),
		riotIdTagline: z.string().optional().nullable(),
		placement: z.number(),
		level: z.number(),
		units: z.array(rawUnitSchema)
	})
	.passthrough();
const rawInfoSchema = z
	.object({
		endOfGameResult: z.string().optional(),
		game_datetime: z.number().finite().nonnegative(),
		game_length: z.number().finite(),
		game_version: z.string(),
		queueId: z.number().optional(),
		queue_id: z.number().optional(),
		tft_game_type: z.string(),
		tft_set_core_name: z.string(),
		tft_set_number: z.number(),
		participants: z.array(rawParticipantSchema)
	})
	.passthrough();
const rawResponseSchema = z
	.object({
		metadata: z
			.object({
				data_version: z.string(),
				match_id: z.string()
			})
			.passthrough(),
		info: rawInfoSchema
	})
	.passthrough();

const canonicalChampionSchema = z
	.object({
		externalId: nonBlank,
		catalogChampionId: nonBlank,
		displayName: nonBlank,
		iconPath: z.string().min(1).nullable(),
		starLevel: z.number().int().min(1).max(3),
		displayOrder: z.number().int().nonnegative()
	})
	.strict();
const canonicalParticipantSchema = z
	.object({
		puuid: nonBlank,
		riotId: z.object({ gameName: nonBlank, tagline: nonBlank }).strict().nullable(),
		placement: z.number().int().min(1).max(8),
		level: z.number().int().positive(),
		champions: z.array(canonicalChampionSchema)
	})
	.strict()
	.superRefine((participant, context) => {
		if (!participant.champions.every((champion, index) => champion.displayOrder === index)) {
			context.addIssue({
				code: 'custom',
				path: ['champions'],
				message: 'Champion display order must be contiguous'
			});
		}
	});
const canonicalSnapshotSchema = z
	.object({
		contractVersion: z.literal(CANONICAL_TFT_MATCH_CONTRACT_VERSION),
		source: z
			.object({
				provider: z.literal('riot'),
				region: nonBlank,
				matchId: nonBlank,
				dataVersion: nonBlank,
				fetchedAt: z.iso.datetime()
			})
			.strict(),
		match: z
			.object({
				completedAt: z.iso.datetime(),
				durationSeconds: z.number().finite().positive(),
				gameVersion: nonBlank,
				queueId: z.number().int().nonnegative(),
				gameType: nonBlank,
				setNumber: z.number().int().positive(),
				setCoreName: nonBlank
			})
			.strict(),
		participants: z.array(canonicalParticipantSchema).length(8)
	})
	.strict()
	.superRefine((snapshot, context) => {
		const puuids = snapshot.participants.map((participant) => participant.puuid);
		if (new Set(puuids).size !== puuids.length) {
			context.addIssue({
				code: 'custom',
				path: ['participants'],
				message: 'PUUIDs must be unique'
			});
		}
		const placements = snapshot.participants
			.map((participant) => participant.placement)
			.sort((left, right) => left - right);
		if (!placements.every((placement, index) => placement === index + 1)) {
			context.addIssue({
				code: 'custom',
				path: ['participants'],
				message: 'Placements must contain exactly 1 through 8'
			});
		}
	});

/** @param {unknown} value */
function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

/**
 * @param {unknown} value
 * @returns {import('./contract.js').CanonicalTftMatchSnapshot}
 */
export function parseCanonicalTftMatchSnapshot(value) {
	const result = canonicalSnapshotSchema.safeParse(value);
	if (!result.success) {
		throw new TftMatchContractError('The selected TFT match is not valid for saving.', {
			cause: result.error
		});
	}
	return /** @type {import('./contract.js').CanonicalTftMatchSnapshot} */ (
		deepFreeze(structuredClone(result.data))
	);
}

/**
 * @typedef {{
 *   id: string,
 *   externalId: string,
 *   displayName: string,
 *   iconPath: string | null,
 *   isExcluded?: boolean
 * }} CatalogChampion
 *
 * @typedef {{
 *   contractVersion: 1,
 *   source: { provider: 'riot', region: string, matchId: string, dataVersion: string, fetchedAt: string },
 *   match: { completedAt: string, durationSeconds: number, gameVersion: string, queueId: number, gameType: string, setNumber: number, setCoreName: string },
 *   participants: Array<{
 *     puuid: string,
 *     riotId: { gameName: string, tagline: string } | null,
 *     placement: number,
 *     level: number,
 *     champions: Array<{ externalId: string, catalogChampionId: string, displayName: string, iconPath: string | null, starLevel: number, displayOrder: number }>
 *   }>
 * }} CanonicalTftMatchSnapshot
 */

/**
 * @param {{
 *   payload: unknown,
 *   requestedMatchId: string,
 *   selectedPuuid: string,
 *   region: string,
 *   catalogChampions: CatalogChampion[],
 *   fetchedAt: string
 * }} input
 * @returns {CanonicalTftMatchSnapshot}
 */
export function normalizeTftMatch(input) {
	const parsed = rawResponseSchema.safeParse(input.payload);
	if (!parsed.success) {
		throw new TftMatchContractError('Riot returned an incomplete TFT match response.', {
			cause: parsed.error
		});
	}

	const { metadata, info } = parsed.data;
	if (metadata.match_id !== input.requestedMatchId) {
		throw new TftMatchContractError('Riot returned a different TFT match than requested.');
	}
	if (info.endOfGameResult !== undefined && info.endOfGameResult !== 'GameComplete') {
		throw new TftMatchContractError('This TFT match did not finish normally.');
	}

	const queueId = info.queueId ?? info.queue_id;
	const catalogByExternalId = new Map(
		input.catalogChampions.map((champion) => [champion.externalId, champion])
	);
	const unresolvedExternalIds = new Set();

	const participants = info.participants
		.map((participant) => ({
			puuid: participant.puuid,
			riotId:
				participant.riotIdGameName?.trim() && participant.riotIdTagline?.trim()
					? {
							gameName: participant.riotIdGameName.trim(),
							tagline: participant.riotIdTagline.trim()
						}
					: null,
			placement: participant.placement,
			level: participant.level,
			champions: participant.units.map((unit, displayOrder) => {
				const externalId = unit.character_id.trim();
				if (!externalId) {
					throw new TftMatchContractError('A TFT unit is missing its catalog identifier.');
				}
				if (!Number.isInteger(unit.tier) || unit.tier < 1 || unit.tier > 3) {
					throw new TftMatchContractError('A TFT unit has an unsupported star level.');
				}
				const catalogChampion = catalogByExternalId.get(externalId);
				if (!catalogChampion) {
					unresolvedExternalIds.add(externalId);
					return null;
				}
				return {
					externalId,
					catalogChampionId: catalogChampion.id,
					displayName: catalogChampion.displayName,
					iconPath: catalogChampion.iconPath,
					starLevel: unit.tier,
					displayOrder
				};
			})
		}))
		.sort((left, right) => left.placement - right.placement);

	if (unresolvedExternalIds.size > 0) {
		const sortedIds = [...unresolvedExternalIds].sort();
		throw new TftMatchContractError(
			`The active catalog is missing these TFT units: ${sortedIds.join(', ')}.`,
			{ unresolvedExternalIds: sortedIds }
		);
	}

	const snapshot = {
		contractVersion: CANONICAL_TFT_MATCH_CONTRACT_VERSION,
		source: {
			provider: /** @type {const} */ ('riot'),
			region: input.region,
			matchId: metadata.match_id,
			dataVersion: metadata.data_version,
			fetchedAt: input.fetchedAt
		},
		match: {
			completedAt: new Date(info.game_datetime).toISOString(),
			durationSeconds: info.game_length,
			gameVersion: info.game_version,
			queueId,
			gameType: info.tft_game_type,
			setNumber: info.tft_set_number,
			setCoreName: info.tft_set_core_name
		},
		participants
	};

	const canonical = parseCanonicalTftMatchSnapshot(snapshot);
	if (!canonical.participants.some((participant) => participant.puuid === input.selectedPuuid)) {
		throw new TftMatchContractError('The selected player is not present in this TFT match.');
	}
	return canonical;
}

/**
 * @param {CanonicalTftMatchSnapshot} snapshot
 * @param {string} selectedPuuid
 * @returns {import('$lib/tft-match.js').TftMatchPreviewRow}
 */
export function previewRowFromSnapshot(snapshot, selectedPuuid) {
	const participant = snapshot.participants.find((row) => row.puuid === selectedPuuid);
	if (!participant) {
		throw new TftMatchContractError('The selected player is not present in this TFT match.');
	}

	return {
		available: true,
		matchId: snapshot.source.matchId,
		completedAt: snapshot.match.completedAt,
		placement: participant.placement,
		gameType: snapshot.match.gameType,
		setNumber: snapshot.match.setNumber,
		setCoreName: snapshot.match.setCoreName,
		champions: structuredClone(participant.champions)
	};
}
