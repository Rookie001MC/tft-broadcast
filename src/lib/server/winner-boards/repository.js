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
const WRITE_TRANSACTION_ATTEMPTS = 10;
let liveWriteTail = Promise.resolve();

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

/** @param {any} database @param {(transaction: any) => Promise<any>} operation */
async function runLiveWriteTransaction(database, operation) {
	const previousWrite = liveWriteTail;
	/** @type {() => void} */
	let releaseWrite = () => {};
	liveWriteTail = new Promise((resolve) => {
		releaseWrite = () => resolve(undefined);
	});
	await previousWrite;
	try {
		return await runWriteTransaction(database, operation);
	} finally {
		releaseWrite();
	}
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

	const scopedChampions = await transaction
		.select({ id: catalogChampions.id })
		.from(catalogChampions)
		.where(
			and(
				eq(catalogChampions.catalogSnapshotId, activeCatalogSnapshotId),
				inArray(catalogChampions.id, scope.championIds)
			)
		);
	if (scopedChampions.length !== scope.championIds.length)
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
		const championIds = input.champions.map(({ catalogChampionId }) => catalogChampionId);
		await validateTournamentScope(transaction, {
			tournamentId: input.tournamentId,
			winnerPlayerId: input.winnerPlayerId,
			championIds,
			augmentIds: input.augmentIds
		});

		const now = new Date();
		const boardId = input.boardId ?? randomUUID();
		if (input.boardId) {
			const [existing] = await transaction
				.select({ status: winnerBoards.status, tournamentId: winnerBoards.tournamentId })
				.from(winnerBoards)
				.where(eq(winnerBoards.id, input.boardId))
				.limit(1);
			if (!existing) throw new Error('Winner board was not found');
			if (existing.status !== 'draft') throw new Error('Published winner board cannot be edited');
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
	return runLiveWriteTransaction(database, async (/** @type {any} */ transaction) => {
		const now = new Date();
		const [target] = await transaction
			.select({
				status: winnerBoards.status,
				tournamentId: winnerBoards.tournamentId,
				winnerPlayerId: winnerBoards.winnerPlayerId
			})
			.from(winnerBoards)
			.where(eq(winnerBoards.id, boardId))
			.limit(1);
		if (!target) throw new Error('Winner board was not found');
		if (target.status !== 'draft') throw new Error('Only a draft winner board can be published');
		/** @type {Array<{ catalogChampionId: string, starLevel: number | null }>} */
		const storedChampions = await transaction
			.select({
				catalogChampionId: winnerBoardChampions.catalogChampionId,
				starLevel: winnerBoardChampions.starLevel
			})
			.from(winnerBoardChampions)
			.where(eq(winnerBoardChampions.winnerBoardId, boardId));
		/** @type {Array<{ catalogAugmentId: string }>} */
		const storedAugments = await transaction
			.select({ catalogAugmentId: winnerBoardAugments.catalogAugmentId })
			.from(winnerBoardAugments)
			.where(eq(winnerBoardAugments.winnerBoardId, boardId));
		validateInputShape({
			boardId,
			tournamentId: target.tournamentId,
			winnerPlayerId: target.winnerPlayerId,
			title: '',
			champions: storedChampions,
			augmentIds: storedAugments.map(({ catalogAugmentId }) => catalogAugmentId)
		});
		await validateTournamentScope(transaction, {
			tournamentId: target.tournamentId,
			winnerPlayerId: target.winnerPlayerId,
			championIds: storedChampions.map(({ catalogChampionId }) => catalogChampionId),
			augmentIds: storedAugments.map(({ catalogAugmentId }) => catalogAugmentId)
		});

		await ensureGraphicState(transaction, now);
		const [state] = await transaction
			.select({ publishedWinnerBoardId: graphicState.publishedWinnerBoardId })
			.from(graphicState)
			.where(eq(graphicState.id, LIVE_STATE_ID))
			.limit(1);

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
	return runLiveWriteTransaction(database, async (/** @type {any} */ transaction) => {
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
	/** @type {Array<Record<string, unknown>>} */
	const rows = await database.all(sql`
		SELECT
			wb.id AS id,
			wb.title AS title,
			wb.tournament_id AS tournamentId,
			wb.published_at AS publishedAt,
			p.id AS winnerId,
			p.display_name AS winnerDisplayName,
			p.riot_id AS winnerRiotId,
			p.image_path AS winnerImagePath,
			COALESCE((
				SELECT json_group_array(json_object(
					'id', ordered_champions.id,
					'displayName', ordered_champions.displayName,
					'iconPath', ordered_champions.iconPath,
					'starLevel', ordered_champions.starLevel,
					'displayOrder', ordered_champions.displayOrder
				))
				FROM (
					SELECT
						cc.id AS id,
						cc.display_name AS displayName,
						cc.icon_path AS iconPath,
						wbc.star_level AS starLevel,
						wbc.display_order AS displayOrder
					FROM winner_board_champions wbc
					JOIN catalog_champions cc ON cc.id = wbc.catalog_champion_id
					WHERE wbc.winner_board_id = wb.id
					ORDER BY wbc.display_order
				) ordered_champions
			), '[]') AS championsJson,
			COALESCE((
				SELECT json_group_array(json_object(
					'id', ordered_augments.id,
					'displayName', ordered_augments.displayName,
					'iconPath', ordered_augments.iconPath,
					'displayOrder', ordered_augments.displayOrder
				))
				FROM (
					SELECT
						ca.id AS id,
						ca.display_name AS displayName,
						ca.icon_path AS iconPath,
						wba.display_order AS displayOrder
					FROM winner_board_augments wba
					JOIN catalog_augments ca ON ca.id = wba.catalog_augment_id
					WHERE wba.winner_board_id = wb.id
					ORDER BY wba.display_order
				) ordered_augments
			), '[]') AS augmentsJson
		FROM graphic_state gs
		JOIN winner_boards wb ON wb.id = gs.published_winner_board_id
		JOIN players p ON p.id = wb.winner_player_id
		WHERE gs.id = ${LIVE_STATE_ID}
		LIMIT 1
	`);
	const [row] = rows;
	if (!row) return null;
	return {
		id: /** @type {string} */ (row.id),
		title: /** @type {string} */ (row.title),
		tournamentId: /** @type {string} */ (row.tournamentId),
		publishedAt:
			row.publishedAt === null ? null : new Date(/** @type {number} */ (row.publishedAt)),
		winner: {
			id: /** @type {string} */ (row.winnerId),
			displayName: /** @type {string} */ (row.winnerDisplayName),
			riotId: /** @type {string | null} */ (row.winnerRiotId),
			imagePath: /** @type {string | null} */ (row.winnerImagePath)
		},
		champions: JSON.parse(/** @type {string} */ (row.championsJson)),
		augments: JSON.parse(/** @type {string} */ (row.augmentsJson))
	};
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
