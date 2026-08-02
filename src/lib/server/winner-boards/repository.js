import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { catalogAugments, catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import {
	graphicState,
	winnerBoardAugments,
	winnerBoardChampions,
	winnerBoards
} from '../db/schema/winner-boards.js';

const LIVE_STATE_ID = 'live';

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   tournamentId: string,
 *   publishedAt: Date | null,
 *   winner: { id: string, displayName: string, riotId: string | null, imagePath: string | null },
 *   champions: Array<{ id: string, displayName: string, iconPath: string | null, starLevel: number | null, displayOrder: number }>,
 *   augments: Array<{ id: string, displayName: string, iconPath: string | null, displayOrder: number }>
 * }} WinnerBoardView
 */

/**
 * @typedef {{
 *   boardId: string | null,
 *   tournamentId: string,
 *   winnerPlayerId: string,
 *   title: string,
 *   champions: Array<{ catalogChampionId: string, starLevel: number | null }>,
 *   augmentIds: string[]
 * }} SaveDraftWinnerBoardInput
 */

/** @param {string[]} values @param {string} message */
function assertUnique(values, message) {
	if (new Set(values).size !== values.length) throw new Error(message);
}

/** @param {SaveDraftWinnerBoardInput} input */
function validateInputShape(input) {
	if (input.champions.length === 0) throw new Error('At least one champion is required');
	assertUnique(
		input.champions.map(({ catalogChampionId }) => catalogChampionId),
		'Champion IDs must be unique'
	);
	assertUnique(input.augmentIds, 'Augment IDs must be unique');
	for (const { starLevel } of input.champions) {
		if (starLevel !== null && (!Number.isInteger(starLevel) || starLevel < 1 || starLevel > 3))
			throw new Error('Star level must be between 1 and 3');
	}
}

/**
 * @param {any} database
 * @param {string} boardId
 * @returns {Promise<WinnerBoardView | null>}
 */
async function getWinnerBoardView(database, boardId) {
	const [board] = await database
		.select({
			id: winnerBoards.id,
			title: winnerBoards.title,
			tournamentId: winnerBoards.tournamentId,
			publishedAt: winnerBoards.publishedAt,
			winnerId: players.id,
			winnerDisplayName: players.displayName,
			winnerRiotId: players.riotId,
			winnerImagePath: players.imagePath
		})
		.from(winnerBoards)
		.innerJoin(players, eq(winnerBoards.winnerPlayerId, players.id))
		.where(eq(winnerBoards.id, boardId))
		.limit(1);
	if (!board) return null;

	const champions = await database
		.select({
			id: catalogChampions.id,
			displayName: catalogChampions.displayName,
			iconPath: catalogChampions.iconPath,
			starLevel: winnerBoardChampions.starLevel,
			displayOrder: winnerBoardChampions.displayOrder
		})
		.from(winnerBoardChampions)
		.innerJoin(catalogChampions, eq(winnerBoardChampions.catalogChampionId, catalogChampions.id))
		.where(eq(winnerBoardChampions.winnerBoardId, boardId))
		.orderBy(asc(winnerBoardChampions.displayOrder));
	const augments = await database
		.select({
			id: catalogAugments.id,
			displayName: catalogAugments.displayName,
			iconPath: catalogAugments.iconPath,
			displayOrder: winnerBoardAugments.displayOrder
		})
		.from(winnerBoardAugments)
		.innerJoin(catalogAugments, eq(winnerBoardAugments.catalogAugmentId, catalogAugments.id))
		.where(eq(winnerBoardAugments.winnerBoardId, boardId))
		.orderBy(asc(winnerBoardAugments.displayOrder));

	return {
		id: board.id,
		title: board.title,
		tournamentId: board.tournamentId,
		publishedAt: board.publishedAt,
		winner: {
			id: board.winnerId,
			displayName: board.winnerDisplayName,
			riotId: board.winnerRiotId,
			imagePath: board.winnerImagePath
		},
		champions,
		augments
	};
}

/**
 * Insert a new draft or replace an existing tournament-scoped draft and all
 * of its ordered children in one transaction.
 *
 * @param {any} database
 * @param {SaveDraftWinnerBoardInput} input
 * @returns {Promise<WinnerBoardView>}
 */
export async function saveDraftWinnerBoard(database, input) {
	validateInputShape(input);

	return database.transaction(async (/** @type {any} */ transaction) => {
		const [tournament] = await transaction
			.select({ activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId })
			.from(tournaments)
			.where(eq(tournaments.id, input.tournamentId))
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

		const [rosterEntry] = await transaction
			.select({ playerId: tournamentPlayers.playerId })
			.from(tournamentPlayers)
			.where(
				and(
					eq(tournamentPlayers.tournamentId, input.tournamentId),
					eq(tournamentPlayers.playerId, input.winnerPlayerId)
				)
			)
			.limit(1);
		if (!rosterEntry) throw new Error('Winner must belong to tournament roster');

		const championIds = input.champions.map(({ catalogChampionId }) => catalogChampionId);
		const scopedChampions = await transaction
			.select({ id: catalogChampions.id })
			.from(catalogChampions)
			.where(
				and(
					eq(catalogChampions.catalogSnapshotId, tournament.activeCatalogSnapshotId),
					inArray(catalogChampions.id, championIds)
				)
			);
		if (scopedChampions.length !== championIds.length)
			throw new Error('Champion does not belong to active catalog');

		if (input.augmentIds.length > 0) {
			const scopedAugments = await transaction
				.select({ id: catalogAugments.id })
				.from(catalogAugments)
				.where(
					and(
						eq(catalogAugments.catalogSnapshotId, tournament.activeCatalogSnapshotId),
						inArray(catalogAugments.id, input.augmentIds)
					)
				);
			if (scopedAugments.length !== input.augmentIds.length)
				throw new Error('Augment does not belong to active catalog');
		}

		const now = new Date();
		const boardId = input.boardId ?? randomUUID();
		if (input.boardId) {
			const [existing] = await transaction
				.select({ status: winnerBoards.status, tournamentId: winnerBoards.tournamentId })
				.from(winnerBoards)
				.where(eq(winnerBoards.id, input.boardId))
				.limit(1);
			if (!existing) throw new Error('Winner board was not found');
			if (existing.status === 'published')
				throw new Error('Published winner board cannot be edited');
			if (existing.tournamentId !== input.tournamentId)
				throw new Error('Winner board does not belong to tournament');

			await transaction
				.update(winnerBoards)
				.set({
					winnerPlayerId: input.winnerPlayerId,
					title: input.title,
					status: 'draft',
					updatedAt: now,
					publishedAt: null
				})
				.where(eq(winnerBoards.id, input.boardId));
			await transaction
				.delete(winnerBoardChampions)
				.where(eq(winnerBoardChampions.winnerBoardId, input.boardId));
			await transaction
				.delete(winnerBoardAugments)
				.where(eq(winnerBoardAugments.winnerBoardId, input.boardId));
		} else {
			await transaction.insert(winnerBoards).values({
				id: boardId,
				tournamentId: input.tournamentId,
				winnerPlayerId: input.winnerPlayerId,
				title: input.title,
				status: 'draft',
				createdAt: now,
				updatedAt: now,
				publishedAt: null
			});
		}

		await transaction.insert(winnerBoardChampions).values(
			input.champions.map(({ catalogChampionId, starLevel }, displayOrder) => ({
				id: randomUUID(),
				winnerBoardId: boardId,
				catalogChampionId,
				starLevel,
				displayOrder
			}))
		);
		if (input.augmentIds.length > 0) {
			await transaction.insert(winnerBoardAugments).values(
				input.augmentIds.map((catalogAugmentId, displayOrder) => ({
					id: randomUUID(),
					winnerBoardId: boardId,
					catalogAugmentId,
					displayOrder
				}))
			);
		}

		const view = await getWinnerBoardView(transaction, boardId);
		if (!view) throw new Error('Winner board was not found');
		return view;
	});
}

/** @param {any} transaction @param {Date} now */
async function ensureGraphicState(transaction, now) {
	await transaction
		.insert(graphicState)
		.values({ id: LIVE_STATE_ID, publishedWinnerBoardId: null, version: 0, updatedAt: now })
		.onConflictDoNothing();
}

/**
 * @param {any} database
 * @param {string} boardId
 * @returns {Promise<WinnerBoardView>}
 */
export async function publishWinnerBoard(database, boardId) {
	return database.transaction(async (/** @type {any} */ transaction) => {
		const now = new Date();
		await ensureGraphicState(transaction, now);
		const [state] = await transaction
			.select({ publishedWinnerBoardId: graphicState.publishedWinnerBoardId })
			.from(graphicState)
			.where(eq(graphicState.id, LIVE_STATE_ID))
			.limit(1);
		const [target] = await transaction
			.select({ status: winnerBoards.status })
			.from(winnerBoards)
			.where(eq(winnerBoards.id, boardId))
			.limit(1);
		if (!target) throw new Error('Winner board was not found');
		if (target.status !== 'draft') throw new Error('Only a draft winner board can be published');

		if (state?.publishedWinnerBoardId && state.publishedWinnerBoardId !== boardId) {
			await transaction
				.update(winnerBoards)
				.set({ status: 'hidden', updatedAt: now })
				.where(eq(winnerBoards.id, state.publishedWinnerBoardId));
		}
		await transaction
			.update(winnerBoards)
			.set({ status: 'published', publishedAt: now, updatedAt: now })
			.where(eq(winnerBoards.id, boardId));
		await transaction
			.update(graphicState)
			.set({
				publishedWinnerBoardId: boardId,
				version: sql`${graphicState.version} + 1`,
				updatedAt: now
			})
			.where(eq(graphicState.id, LIVE_STATE_ID));

		const view = await getWinnerBoardView(transaction, boardId);
		if (!view) throw new Error('Winner board was not found');
		return view;
	});
}

/**
 * @param {any} database
 * @returns {Promise<boolean>} true when a live board was hidden
 */
export async function hidePublishedBoard(database) {
	return database.transaction(async (/** @type {any} */ transaction) => {
		const now = new Date();
		await ensureGraphicState(transaction, now);
		const [state] = await transaction
			.select({ publishedWinnerBoardId: graphicState.publishedWinnerBoardId })
			.from(graphicState)
			.where(eq(graphicState.id, LIVE_STATE_ID))
			.limit(1);
		if (!state?.publishedWinnerBoardId) return false;

		await transaction
			.update(winnerBoards)
			.set({ status: 'hidden', updatedAt: now })
			.where(eq(winnerBoards.id, state.publishedWinnerBoardId));
		await transaction
			.update(graphicState)
			.set({
				publishedWinnerBoardId: null,
				version: sql`${graphicState.version} + 1`,
				updatedAt: now
			})
			.where(eq(graphicState.id, LIVE_STATE_ID));
		return true;
	});
}

/**
 * @param {any} database
 * @returns {Promise<WinnerBoardView | null>}
 */
export async function getPublishedWinnerBoard(database) {
	const [state] = await database
		.select({ publishedWinnerBoardId: graphicState.publishedWinnerBoardId })
		.from(graphicState)
		.where(eq(graphicState.id, LIVE_STATE_ID))
		.limit(1);
	if (!state?.publishedWinnerBoardId) return null;
	return getWinnerBoardView(database, state.publishedWinnerBoardId);
}

/** @param {any} database */
export async function getGraphicVersion(database) {
	const [state] = await database
		.select({ version: graphicState.version })
		.from(graphicState)
		.where(eq(graphicState.id, LIVE_STATE_ID))
		.limit(1);
	return state?.version ?? 0;
}
