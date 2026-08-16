import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import {
	graphicState,
	winnerBoardPublications,
	winnerBoardState,
	winnerBoardStateAugments,
	winnerBoardStateChampions
} from '../db/schema/winner-boards.js';
import {
	discardPublicationMedia,
	isPublicationId,
	isPublicationMediaFilename,
	preparePublicationMedia
} from './publication-media.js';
import { insertTftMatchSnapshot } from '../tft-matches/snapshot-repository.js';

/**
 * @import {
 *   WinnerBoardPublicationPayload,
 *   WinnerBoardStateView
 * } from '$lib/winner-board.js'
 */

const CURRENT_STATE_ID = 'current';
const LIVE_STATE_ID = 'live';
const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';
const WRITE_TRANSACTION_ATTEMPTS = 10;
const INVALID_PUBLICATION_PAYLOAD = 'Published winner board payload is invalid';
let writeTail = Promise.resolve();

/**
 * @typedef {{
 *   tournamentId: string,
 *   winnerPlayerId: string,
 *   title: string,
 *   champions: Array<{ catalogChampionId: string, starLevel: number | null }>,
 *   augmentIds: string[],
 *   sourceSnapshot?: import('../tft-matches/snapshot-repository.js').TftMatchSnapshotSource
 * }} SaveWinnerBoardStateInput
 */

/** @param {string[]} values @param {string} message */
function assertUnique(values, message) {
	if (new Set(values).size !== values.length) throw new Error(message);
}

/** @param {unknown} error */
function isDatabaseLocked(error) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		(error.code.startsWith('SQLITE_BUSY') || error.code.startsWith('SQLITE_LOCKED'))
	);
}

/** @param {number} milliseconds */
function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** @param {any} database @param {(transaction: any) => Promise<any>} operation */
async function runWriteTransaction(database, operation) {
	for (let attempt = 0; attempt < WRITE_TRANSACTION_ATTEMPTS; attempt += 1) {
		try {
			return await database.transaction(operation);
		} catch (error) {
			if (!isDatabaseLocked(error) || attempt === WRITE_TRANSACTION_ATTEMPTS - 1) throw error;
			await delay((attempt + 1) * 5);
		}
	}
	throw new Error('Write transaction retry limit was reached');
}

/** @param {() => Promise<any>} operation */
async function runSerializedWrite(operation) {
	const previousWrite = writeTail;
	/** @type {() => void} */
	let releaseWrite = () => {};
	writeTail = new Promise((resolve) => {
		releaseWrite = () => resolve(undefined);
	});
	await previousWrite;
	try {
		return await operation();
	} finally {
		releaseWrite();
	}
}

export {
	runSerializedWrite as runSerializedWinnerBoardWrite,
	runWriteTransaction as runWinnerBoardWriteTransaction
};

/** @param {SaveWinnerBoardStateInput} input */
function validateInputShape(input) {
	if (!Array.isArray(input.champions) || !Array.isArray(input.augmentIds))
		throw new Error('Winner board state is invalid');
	if (input.champions.length === 0) throw new Error('At least one champion is required');
	if (input.augmentIds.length > 3) throw new Error('At most three augments are allowed');
	assertUnique(input.augmentIds, 'Augment IDs must be unique');
	for (const { starLevel } of input.champions) {
		if (starLevel !== null && (!Number.isInteger(starLevel) || starLevel < 1 || starLevel > 3))
			throw new Error('Star level must be between 1 and 3');
	}
}

/** @param {any} transaction @param {string} tournamentId */
async function getActiveCatalogSnapshotId(transaction, tournamentId) {
	const [tournament] = await transaction
		.select({ activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId })
		.from(tournaments)
		.where(eq(tournaments.id, tournamentId))
		.limit(1);
	if (!tournament) throw new Error('Tournament was not found');
	if (!tournament.activeCatalogSnapshotId) throw new Error('Tournament has no active catalog');

	const [activeSnapshot] = await transaction
		.select({ id: catalogSnapshots.id })
		.from(catalogSnapshots)
		.where(
			and(
				eq(catalogSnapshots.id, tournament.activeCatalogSnapshotId),
				eq(catalogSnapshots.isAvailable, true)
			)
		)
		.limit(1);
	if (!activeSnapshot) throw new Error('Tournament has no active catalog');
	return activeSnapshot.id;
}

/**
 * @param {any} transaction
 * @param {{ tournamentId: string, winnerPlayerId: string, championIds: string[], augmentIds: string[] }} scope
 */
async function validateTournamentScope(transaction, scope) {
	const activeCatalogSnapshotId = await getActiveCatalogSnapshotId(transaction, scope.tournamentId);
	const [rosterEntry] = await transaction
		.select({ playerId: tournamentPlayers.playerId })
		.from(tournamentPlayers)
		.where(
			and(
				eq(tournamentPlayers.tournamentId, scope.tournamentId),
				eq(tournamentPlayers.playerId, scope.winnerPlayerId)
			)
		)
		.limit(1);
	if (!rosterEntry) throw new Error('Winner must belong to tournament roster');

	const uniqueChampionIds = [...new Set(scope.championIds)];
	const scopedChampions = await transaction
		.select({ id: catalogChampions.id })
		.from(catalogChampions)
		.where(
			and(
				eq(catalogChampions.catalogSnapshotId, activeCatalogSnapshotId),
				inArray(catalogChampions.id, uniqueChampionIds)
			)
		);
	if (scopedChampions.length !== uniqueChampionIds.length)
		throw new Error('Champion does not belong to active catalog');

	if (scope.augmentIds.length > 0) {
		const scopedAugments = await transaction
			.select({ id: catalogAugments.id })
			.from(catalogAugments)
			.where(
				and(
					eq(catalogAugments.catalogSnapshotId, activeCatalogSnapshotId),
					inArray(catalogAugments.id, scope.augmentIds)
				)
			);
		if (scopedAugments.length !== scope.augmentIds.length)
			throw new Error('Augment does not belong to active catalog');
	}
}

/** @param {SaveWinnerBoardStateInput} input */
function validationScope(input) {
	return {
		tournamentId: input.tournamentId,
		winnerPlayerId: input.winnerPlayerId,
		championIds: input.champions.map((item) => item.catalogChampionId),
		augmentIds: input.augmentIds
	};
}

/**
 * The editable singleton intentionally joins current player and catalog rows.
 * Publications never use this read path.
 *
 * @param {any} database
 * @returns {Promise<WinnerBoardStateView | null>}
 */
export async function getWinnerBoardState(database) {
	const [state] = await database
		.select({
			id: winnerBoardState.id,
			title: winnerBoardState.title,
			tournamentId: winnerBoardState.tournamentId,
			updatedAt: winnerBoardState.updatedAt,
			winnerId: players.id,
			winnerDisplayName: players.displayName,
			winnerRiotId: players.riotId,
			winnerImagePath: players.imagePath
		})
		.from(winnerBoardState)
		.innerJoin(players, eq(winnerBoardState.winnerPlayerId, players.id))
		.where(eq(winnerBoardState.id, CURRENT_STATE_ID))
		.limit(1);
	if (!state) return null;

	const champions = await database
		.select({
			id: catalogChampions.id,
			displayName: catalogChampions.displayName,
			iconPath: catalogChampions.iconPath,
			starLevel: winnerBoardStateChampions.starLevel,
			displayOrder: winnerBoardStateChampions.displayOrder
		})
		.from(winnerBoardStateChampions)
		.innerJoin(
			catalogChampions,
			eq(winnerBoardStateChampions.catalogChampionId, catalogChampions.id)
		)
		.where(eq(winnerBoardStateChampions.winnerBoardStateId, CURRENT_STATE_ID))
		.orderBy(asc(winnerBoardStateChampions.displayOrder));
	const augments = await database
		.select({
			id: catalogAugments.id,
			displayName: catalogAugments.displayName,
			iconPath: catalogAugments.iconPath,
			displayOrder: winnerBoardStateAugments.displayOrder
		})
		.from(winnerBoardStateAugments)
		.innerJoin(catalogAugments, eq(winnerBoardStateAugments.catalogAugmentId, catalogAugments.id))
		.where(eq(winnerBoardStateAugments.winnerBoardStateId, CURRENT_STATE_ID))
		.orderBy(asc(winnerBoardStateAugments.displayOrder));

	return {
		id: state.id,
		title: state.title,
		tournamentId: state.tournamentId,
		updatedAt: state.updatedAt,
		winner: {
			id: state.winnerId,
			displayName: state.winnerDisplayName,
			riotId: state.winnerRiotId,
			imagePath: state.winnerImagePath
		},
		champions,
		augments
	};
}

/** @param {WinnerBoardStateView} state */
function inputFromState(state) {
	return {
		tournamentId: state.tournamentId,
		winnerPlayerId: state.winner.id,
		title: state.title,
		champions: state.champions.map((champion) => ({
			catalogChampionId: champion.id,
			starLevel: champion.starLevel
		})),
		augmentIds: state.augments.map((augment) => augment.id)
	};
}

/**
 * @param {any} transaction
 * @param {SaveWinnerBoardStateInput} input
 * @returns {Promise<WinnerBoardStateView>}
 */
async function replaceState(transaction, input) {
	const now = new Date();
	const sourceTftMatchSnapshotId = input.sourceSnapshot
		? await insertTftMatchSnapshot(transaction, input.sourceSnapshot)
		: null;
	await validateTournamentScope(transaction, validationScope(input));
	await transaction.delete(winnerBoardState).where(eq(winnerBoardState.id, CURRENT_STATE_ID));
	await transaction.insert(winnerBoardState).values({
		id: CURRENT_STATE_ID,
		tournamentId: input.tournamentId,
		winnerPlayerId: input.winnerPlayerId,
		title: input.title,
		sourceTftMatchSnapshotId,
		createdAt: now,
		updatedAt: now
	});
	await transaction.insert(winnerBoardStateChampions).values(
		input.champions.map(({ catalogChampionId, starLevel }, displayOrder) => ({
			id: randomUUID(),
			winnerBoardStateId: CURRENT_STATE_ID,
			catalogChampionId,
			starLevel,
			displayOrder
		}))
	);
	if (input.augmentIds.length > 0) {
		await transaction.insert(winnerBoardStateAugments).values(
			input.augmentIds.map((catalogAugmentId, displayOrder) => ({
				id: randomUUID(),
				winnerBoardStateId: CURRENT_STATE_ID,
				catalogAugmentId,
				displayOrder
			}))
		);
	}

	const state = await getWinnerBoardState(transaction);
	if (!state) throw new Error('Winner board state was not found');
	return state;
}

/** @param {unknown} value */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function isNullableString(value) {
	return value === null || typeof value === 'string';
}

/** @param {string} publicationId @param {unknown} value */
function isControlledPublicationUrl(publicationId, value) {
	if (value === null) return true;
	if (typeof value !== 'string') return false;
	const prefix = `/media/publications/${publicationId}/`;
	if (!value.startsWith(prefix)) return false;
	const filename = value.slice(prefix.length);
	return !filename.includes('/') && isPublicationMediaFilename(publicationId, filename);
}

/**
 * Parse and validate the immutable JSON boundary used by both inserts and reads.
 *
 * @param {unknown} json
 * @returns {WinnerBoardPublicationPayload}
 */
function parsePublicationPayload(json) {
	try {
		const value = typeof json === 'string' ? JSON.parse(json) : json;
		if (
			!isRecord(value) ||
			typeof value.id !== 'string' ||
			!isPublicationId(value.id) ||
			typeof value.title !== 'string' ||
			typeof value.tournamentId !== 'string' ||
			!isRecord(value.winner) ||
			typeof value.winner.id !== 'string' ||
			typeof value.winner.displayName !== 'string' ||
			!isNullableString(value.winner.riotId) ||
			!isControlledPublicationUrl(value.id, value.winner.imagePath) ||
			!Array.isArray(value.champions) ||
			value.champions.length === 0 ||
			!Array.isArray(value.augments) ||
			value.augments.length > 3
		)
			throw new Error(INVALID_PUBLICATION_PAYLOAD);

		for (const [displayOrder, champion] of value.champions.entries()) {
			if (
				!isRecord(champion) ||
				typeof champion.id !== 'string' ||
				typeof champion.displayName !== 'string' ||
				!isControlledPublicationUrl(value.id, champion.iconPath) ||
				champion.displayOrder !== displayOrder ||
				(champion.starLevel !== null &&
					(!Number.isInteger(champion.starLevel) ||
						champion.starLevel < 1 ||
						champion.starLevel > 3))
			)
				throw new Error(INVALID_PUBLICATION_PAYLOAD);
		}
		const augmentIds = [];
		for (const [displayOrder, augment] of value.augments.entries()) {
			if (
				!isRecord(augment) ||
				typeof augment.id !== 'string' ||
				typeof augment.displayName !== 'string' ||
				!isControlledPublicationUrl(value.id, augment.iconPath) ||
				augment.displayOrder !== displayOrder
			)
				throw new Error(INVALID_PUBLICATION_PAYLOAD);
			augmentIds.push(augment.id);
		}
		if (new Set(augmentIds).size !== augmentIds.length)
			throw new Error(INVALID_PUBLICATION_PAYLOAD);
		return /** @type {WinnerBoardPublicationPayload} */ (value);
	} catch {
		throw new Error(INVALID_PUBLICATION_PAYLOAD);
	}
}

/** @param {unknown} json @param {string} publicationId @param {string} mediaDirectory */
function parsePublicationRow(json, publicationId, mediaDirectory) {
	const payload = parsePublicationPayload(json);
	if (payload.id !== publicationId || mediaDirectory !== `publications/${publicationId}`)
		throw new Error(INVALID_PUBLICATION_PAYLOAD);
	return payload;
}

/**
 * @param {string} publicationId
 * @param {WinnerBoardStateView} source
 * @param {{ winnerImageUrl: string | null, championImageUrls: Array<string | null>, augmentImageUrls: Array<string | null> }} media
 */
function buildPublicationPayload(publicationId, source, media) {
	return parsePublicationPayload({
		id: publicationId,
		title: source.title,
		tournamentId: source.tournamentId,
		winner: {
			id: source.winner.id,
			displayName: source.winner.displayName,
			riotId: source.winner.riotId,
			imagePath: media.winnerImageUrl
		},
		champions: source.champions.map((champion, displayOrder) => ({
			id: champion.id,
			displayName: champion.displayName,
			iconPath: media.championImageUrls[displayOrder],
			starLevel: champion.starLevel,
			displayOrder
		})),
		augments: source.augments.map((augment, displayOrder) => ({
			id: augment.id,
			displayName: augment.displayName,
			iconPath: media.augmentImageUrls[displayOrder],
			displayOrder
		}))
	});
}

/** @param {any} transaction @param {Date} now */
async function ensureGraphicState(transaction, now) {
	await transaction
		.insert(graphicState)
		.values({ id: LIVE_STATE_ID, publishedPublicationId: null, version: 0, updatedAt: now })
		.onConflictDoNothing();
}

/** @param {any} database */
async function currentGraphicState(database) {
	const [state] = await database
		.select({
			publishedPublicationId: graphicState.publishedPublicationId,
			version: graphicState.version
		})
		.from(graphicState)
		.where(eq(graphicState.id, LIVE_STATE_ID))
		.limit(1);
	return state ?? null;
}

/** @param {any} database @param {string} publicationId @param {WinnerBoardStateView} source */
async function preparePublication(database, publicationId, source) {
	const media = await preparePublicationMedia({
		mediaRoot: MEDIA_ROOT,
		publicationId,
		winnerImagePath: source.winner.imagePath,
		championIconPaths: source.champions.map((champion) => champion.iconPath),
		augmentIconPaths: source.augments.map((augment) => augment.iconPath)
	});
	try {
		const payload = buildPublicationPayload(publicationId, source, media);
		return {
			media,
			payload,
			payloadJson: JSON.stringify(payload)
		};
	} catch (error) {
		await discardIfUnreferenced(database, media);
		throw error;
	}
}

/**
 * @param {any} transaction
 * @param {{ id: string, sourceStateUpdatedAt: Date, media: { relativeDirectory: string }, payloadJson: string }} publication
 */
async function insertPublicationAndAdvance(transaction, publication) {
	const now = new Date();
	await ensureGraphicState(transaction, now);
	const state = await currentGraphicState(transaction);
	if (!state) throw new Error('Graphic state was not found');
	const nextVersion = state.version + 1;
	parsePublicationRow(publication.payloadJson, publication.id, publication.media.relativeDirectory);
	await transaction.insert(winnerBoardPublications).values({
		id: publication.id,
		sourceStateUpdatedAt: publication.sourceStateUpdatedAt,
		graphicVersion: nextVersion,
		renderPayloadJson: publication.payloadJson,
		mediaDirectory: publication.media.relativeDirectory,
		createdAt: now
	});
	await transaction
		.update(graphicState)
		.set({
			publishedPublicationId: publication.id,
			version: sql`${graphicState.version} + 1`,
			updatedAt: now
		})
		.where(eq(graphicState.id, LIVE_STATE_ID));
}

/**
 * Remove only a newly prepared directory that did not become durable. If the
 * reference check itself fails, leave the directory in place rather than risk
 * deleting committed publication media.
 *
 * @param {any} database
 * @param {{ relativeDirectory: string }} media
 */
async function discardIfUnreferenced(database, media) {
	try {
		const [publication] = await database
			.select({ id: winnerBoardPublications.id })
			.from(winnerBoardPublications)
			.where(eq(winnerBoardPublications.mediaDirectory, media.relativeDirectory))
			.limit(1);
		if (publication) return;
	} catch {
		return;
	}
	try {
		await discardPublicationMedia({
			mediaRoot: MEDIA_ROOT,
			relativeDirectory: media.relativeDirectory
		});
	} catch {
		// Preserve the original repository failure while containing cleanup to the
		// publication helper's validated directory boundary.
	}
}

/**
 * Replace the installation-wide editable singleton. A live save also creates
 * and points to a new immutable publication in the same serialized write.
 *
 * @param {any} database
 * @param {SaveWinnerBoardStateInput} input
 * @returns {Promise<WinnerBoardStateView>}
 */
export async function saveWinnerBoardState(database, input) {
	validateInputShape(input);
	return runSerializedWrite(async () => {
		const liveState = await currentGraphicState(database);
		if (!liveState?.publishedPublicationId) {
			return runWriteTransaction(database, (transaction) => replaceState(transaction, input));
		}

		await validateTournamentScope(database, validationScope(input));
		const source = await stateViewForInput(database, input);
		const publicationId = randomUUID();
		const prepared = await preparePublication(database, publicationId, source);
		try {
			return await runWriteTransaction(database, async (transaction) => {
				const state = await currentGraphicState(transaction);
				if (!state?.publishedPublicationId) throw new Error('Winner board is no longer live');
				const saved = await replaceState(transaction, input);
				await insertPublicationAndAdvance(transaction, {
					id: publicationId,
					sourceStateUpdatedAt: saved.updatedAt,
					media: prepared.media,
					payloadJson: prepared.payloadJson
				});
				return saved;
			});
		} catch (error) {
			await discardIfUnreferenced(database, prepared.media);
			throw error;
		}
	});
}

/**
 * Build a current display snapshot for a not-yet-persisted replacement.
 * Scope validation must run before this function.
 *
 * @param {any} database
 * @param {SaveWinnerBoardStateInput} input
 * @returns {Promise<WinnerBoardStateView>}
 */
async function stateViewForInput(database, input) {
	const [winner] = await database
		.select({
			id: players.id,
			displayName: players.displayName,
			riotId: players.riotId,
			imagePath: players.imagePath
		})
		.from(players)
		.where(eq(players.id, input.winnerPlayerId))
		.limit(1);
	if (!winner) throw new Error('Winner was not found');

	/** @type {Array<{ id: string, displayName: string, iconPath: string | null }>} */
	const championRows = await database
		.select({
			id: catalogChampions.id,
			displayName: catalogChampions.displayName,
			iconPath: catalogChampions.iconPath
		})
		.from(catalogChampions)
		.where(
			inArray(
				catalogChampions.id,
				input.champions.map((item) => item.catalogChampionId)
			)
		);
	const championById = new Map(championRows.map((champion) => [champion.id, champion]));
	const champions = input.champions.map((item, displayOrder) => {
		const champion = championById.get(item.catalogChampionId);
		if (!champion) throw new Error('Champion does not belong to active catalog');
		return { ...champion, starLevel: item.starLevel, displayOrder };
	});

	/** @type {Array<{ id: string, displayName: string, iconPath: string | null }>} */
	let augmentRows = [];
	if (input.augmentIds.length > 0) {
		augmentRows = await database
			.select({
				id: catalogAugments.id,
				displayName: catalogAugments.displayName,
				iconPath: catalogAugments.iconPath
			})
			.from(catalogAugments)
			.where(inArray(catalogAugments.id, input.augmentIds));
	}
	const augmentById = new Map(augmentRows.map((augment) => [augment.id, augment]));
	const augments = input.augmentIds.map((id, displayOrder) => {
		const augment = augmentById.get(id);
		if (!augment) throw new Error('Augment does not belong to active catalog');
		return { ...augment, displayOrder };
	});

	return {
		id: CURRENT_STATE_ID,
		title: input.title,
		tournamentId: input.tournamentId,
		updatedAt: new Date(),
		winner,
		champions,
		augments
	};
}

/**
 * @param {any} database
 * @param {boolean} live
 * @returns {Promise<WinnerBoardPublicationPayload | boolean>}
 */
export async function setWinnerBoardLive(database, live) {
	if (!live) {
		return runSerializedWrite(() =>
			runWriteTransaction(database, async (transaction) => {
				const state = await currentGraphicState(transaction);
				if (!state?.publishedPublicationId) return false;
				await transaction
					.update(graphicState)
					.set({
						publishedPublicationId: null,
						version: sql`${graphicState.version} + 1`,
						updatedAt: new Date()
					})
					.where(eq(graphicState.id, LIVE_STATE_ID));
				return true;
			})
		);
	}

	return runSerializedWrite(async () => {
		const source = await getWinnerBoardState(database);
		if (!source) throw new Error('Winner board state was not found');
		const storedInput = inputFromState(source);
		validateInputShape(storedInput);
		await validateTournamentScope(database, validationScope(storedInput));

		const publicationId = randomUUID();
		const prepared = await preparePublication(database, publicationId, source);
		try {
			await runWriteTransaction(database, async (transaction) => {
				const current = await getWinnerBoardState(transaction);
				if (!current || current.updatedAt.getTime() !== source.updatedAt.getTime())
					throw new Error('Winner board state changed while publishing');
				const currentInput = inputFromState(current);
				validateInputShape(currentInput);
				await validateTournamentScope(transaction, validationScope(currentInput));
				await insertPublicationAndAdvance(transaction, {
					id: publicationId,
					sourceStateUpdatedAt: current.updatedAt,
					media: prepared.media,
					payloadJson: prepared.payloadJson
				});
			});
			return prepared.payload;
		} catch (error) {
			await discardIfUnreferenced(database, prepared.media);
			throw error;
		}
	});
}

/**
 * Remove the editable singleton. A currently live graphic is hidden and bumps
 * its version in the same transaction; a hidden reset does neither.
 *
 * @param {any} transaction
 * @returns {Promise<boolean>}
 */
export async function resetWinnerBoardStateInTransaction(transaction) {
	const [current] = await transaction
		.select({ id: winnerBoardState.id })
		.from(winnerBoardState)
		.where(eq(winnerBoardState.id, CURRENT_STATE_ID))
		.limit(1);
	const state = await currentGraphicState(transaction);
	if (current)
		await transaction.delete(winnerBoardState).where(eq(winnerBoardState.id, CURRENT_STATE_ID));
	if (state?.publishedPublicationId) {
		await transaction
			.update(graphicState)
			.set({
				publishedPublicationId: null,
				version: sql`${graphicState.version} + 1`,
				updatedAt: new Date()
			})
			.where(eq(graphicState.id, LIVE_STATE_ID));
	}
	return Boolean(current);
}

/** @param {any} database @returns {Promise<boolean>} */
export async function resetWinnerBoardState(database) {
	return runSerializedWrite(() =>
		runWriteTransaction(database, resetWinnerBoardStateInTransaction)
	);
}

/**
 * Read only the publication referenced by graphic_state. The immutable payload
 * is the full rendering source; mutable player/catalog tables are not joined.
 *
 * @param {any} database
 * @returns {Promise<WinnerBoardPublicationPayload | null>}
 */
export async function getPublishedWinnerBoard(database) {
	const [publication] = await database
		.select({
			id: winnerBoardPublications.id,
			renderPayloadJson: winnerBoardPublications.renderPayloadJson,
			mediaDirectory: winnerBoardPublications.mediaDirectory
		})
		.from(graphicState)
		.innerJoin(
			winnerBoardPublications,
			eq(graphicState.publishedPublicationId, winnerBoardPublications.id)
		)
		.where(eq(graphicState.id, LIVE_STATE_ID))
		.limit(1);
	if (!publication) return null;
	return parsePublicationRow(
		publication.renderPayloadJson,
		publication.id,
		publication.mediaDirectory
	);
}

/** @param {any} database */
export async function getGraphicVersion(database) {
	const state = await currentGraphicState(database);
	return state?.version ?? 0;
}
