import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
	catalogAugments,
	catalogChampions,
	catalogSnapshots
} from '$lib/server/db/schema/catalog.js';
import { playerImportPreviews } from '$lib/server/db/schema/imports.js';
import { players } from '$lib/server/db/schema/players.js';
import { tournamentPlayers, tournaments } from '$lib/server/db/schema/tournaments.js';
import { winnerBoards } from '$lib/server/db/schema/winner-boards.js';
import {
	getPublishedWinnerBoard,
	getWinnerBoardView
} from '$lib/server/winner-boards/repository.js';
import { runDestructiveMaintenance } from '$lib/server/winner-boards/maintenance.js';

/** @param {any} database */
async function allTournaments(database) {
	return database.select().from(tournaments).orderBy(asc(tournaments.name), asc(tournaments.id));
}

/** @param {any} database @param {string | null} tournamentId */
async function getSelectedTournament(database, tournamentId) {
	const tournamentsList = await allTournaments(database);
	if (tournamentsList.length === 0)
		return { tournaments: tournamentsList, selectedTournament: null };

	const selectedTournament =
		(tournamentId &&
			tournamentsList.find(
				(/** @type {{ id: string }} */ tournament) => tournament.id === tournamentId
			)) ??
		tournamentsList[0];
	return { tournaments: tournamentsList, selectedTournament };
}

/** @param {any} database @param {string} tournamentId */
async function getRoster(database, tournamentId) {
	return database
		.select({
			playerId: tournamentPlayers.playerId,
			displayOrder: tournamentPlayers.displayOrder,
			notes: tournamentPlayers.notes,
			id: players.id,
			riotId: players.riotId,
			riotIdKey: players.riotIdKey,
			riotGameName: players.riotGameName,
			riotTagline: players.riotTagline,
			fullName: players.fullName,
			displayName: players.displayName,
			imagePath: players.imagePath,
			createdAt: players.createdAt,
			updatedAt: players.updatedAt
		})
		.from(tournamentPlayers)
		.innerJoin(players, eq(tournamentPlayers.playerId, players.id))
		.where(eq(tournamentPlayers.tournamentId, tournamentId))
		.orderBy(asc(tournamentPlayers.displayOrder), asc(players.displayName), asc(players.id));
}

/** @param {any} database @param {string | null} activeCatalogSnapshotId */
async function getActiveCatalogAssets(database, activeCatalogSnapshotId) {
	if (!activeCatalogSnapshotId) {
		return { snapshot: null, champions: [], augments: [] };
	}

	const [snapshot] = await database
		.select()
		.from(catalogSnapshots)
		.where(
			and(eq(catalogSnapshots.id, activeCatalogSnapshotId), eq(catalogSnapshots.isAvailable, true))
		)
		.limit(1);
	if (!snapshot) return { snapshot: null, champions: [], augments: [] };

	const champions = await database
		.select()
		.from(catalogChampions)
		.where(eq(catalogChampions.catalogSnapshotId, snapshot.id))
		.orderBy(asc(catalogChampions.displayName), asc(catalogChampions.id));
	const augments = await database
		.select()
		.from(catalogAugments)
		.where(eq(catalogAugments.catalogSnapshotId, snapshot.id))
		.orderBy(asc(catalogAugments.displayName), asc(catalogAugments.id));

	return { snapshot, champions, augments };
}

/** @param {any} database @param {string} tournamentId */
async function getTournamentDrafts(database, tournamentId) {
	const rows = await database
		.select({ id: winnerBoards.id })
		.from(winnerBoards)
		.where(and(eq(winnerBoards.tournamentId, tournamentId), eq(winnerBoards.status, 'draft')))
		.orderBy(desc(winnerBoards.updatedAt), asc(winnerBoards.id));
	const views = await Promise.all(
		rows.map((/** @type {{ id: string }} */ { id }) => getWinnerBoardView(database, id))
	);
	return views.filter(Boolean);
}

/** @param {any} database */
async function getImportPreviewState(database) {
	const [preview] = await database
		.select({
			token: playerImportPreviews.token,
			status: playerImportPreviews.status,
			expiresAt: playerImportPreviews.expiresAt,
			createdAt: playerImportPreviews.createdAt,
			previewJson: playerImportPreviews.previewJson
		})
		.from(playerImportPreviews)
		.orderBy(desc(playerImportPreviews.createdAt))
		.limit(1);
	if (!preview) return null;
	return {
		...preview,
		preview:
			typeof preview.previewJson === 'string'
				? JSON.parse(preview.previewJson)
				: preview.previewJson
	};
}

/** @param {any} database @param {string} tournamentId */
async function getTournamentRosters(database, tournamentId) {
	const roster = await getRoster(database, tournamentId);
	const playersForSelection = await database
		.select()
		.from(players)
		.orderBy(asc(players.displayName), asc(players.id));
	return { roster, playersForSelection };
}

/** @param {any} database @param {string | null} tournamentId */
export async function loadTournamentAdminData(database, tournamentId) {
	const { tournaments: all, selectedTournament } = await getSelectedTournament(
		database,
		tournamentId
	);
	if (!selectedTournament) {
		return {
			tournaments: all,
			selectedTournament: null,
			roster: [],
			players: [],
			activeCatalog: { snapshot: null, champions: [], augments: [] },
			drafts: [],
			liveBoard: await getPublishedWinnerBoard(database),
			importPreview: await getImportPreviewState(database)
		};
	}

	const [liveBoard, importPreview, rosterData, activeCatalog, drafts] = await Promise.all([
		getPublishedWinnerBoard(database),
		getImportPreviewState(database),
		getTournamentRosters(database, selectedTournament.id),
		getActiveCatalogAssets(database, selectedTournament.activeCatalogSnapshotId),
		getTournamentDrafts(database, selectedTournament.id)
	]);

	return {
		tournaments: all,
		selectedTournament,
		roster: rosterData.roster,
		players: rosterData.playersForSelection,
		activeCatalog,
		drafts,
		liveBoard,
		importPreview
	};
}

/** @param {string} value */
function slugify(value) {
	return value
		.trim()
		.toLocaleLowerCase('en-US')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64);
}

/** @param {any} database @param {{ name: string }} input */
export async function createTournament(database, input) {
	const name = input.name.trim();
	if (!name) throw new Error('Tournament name is required');
	const now = new Date();
	const slug = slugify(name);
	if (!slug) throw new Error('Tournament slug is required');
	const [created] = await database
		.insert(tournaments)
		.values({
			id: randomUUID(),
			name,
			slug,
			activeCatalogSnapshotId: null,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return created ?? null;
}

/**
 * @param {any} database
 * @param {{ tournamentId: string, name: string, slug: string }} input
 */
export async function updateTournament(database, input) {
	const name = input.name.trim();
	if (!name) throw new Error('Tournament name is required');
	const slug = slugify(input.slug);
	if (!slug) throw new Error('Tournament slug is required');
	const [updated] = await database
		.update(tournaments)
		.set({ name, slug, updatedAt: new Date() })
		.where(eq(tournaments.id, input.tournamentId))
		.returning();
	if (!updated) throw new Error('Tournament was not found');
	return updated;
}

/**
 * @param {any} database
 * @param {{ tournamentId: string, confirmReset?: boolean }} input
 */
export async function deleteTournament(database, input) {
	const outcome = await runDestructiveMaintenance(database, {
		target: { kind: 'tournament', id: input.tournamentId },
		confirmReset: input.confirmReset === true,
		operation: async (transaction) => {
			const [existing] = await transaction
				.select({ id: tournaments.id })
				.from(tournaments)
				.where(eq(tournaments.id, input.tournamentId))
				.limit(1);
			if (!existing) throw new Error('Tournament was not found');
			await transaction.delete(tournaments).where(eq(tournaments.id, input.tournamentId));
			return existing;
		}
	});
	if (outcome.kind === 'reset_required') return outcome;
	return { deleted: true, reset: outcome.reset };
}

/** @param {any} database @param {{ tournamentId: string, playerIds: string[] }} input */
export async function addRosterPlayers(database, input) {
	if (input.playerIds.length === 0) return 0;
	const uniqueIds = [...new Set(input.playerIds)];
	return database.transaction(async (/** @type {any} */ transaction) => {
		const tournament = await transaction
			.select({ id: tournaments.id })
			.from(tournaments)
			.where(eq(tournaments.id, input.tournamentId))
			.limit(1);
		if (tournament.length === 0) throw new Error('Tournament was not found');

		const existingRoster = await transaction
			.select({ playerId: tournamentPlayers.playerId })
			.from(tournamentPlayers)
			.where(eq(tournamentPlayers.tournamentId, input.tournamentId))
			.orderBy(asc(tournamentPlayers.displayOrder), asc(tournamentPlayers.playerId));
		const existingIds = new Set(
			existingRoster.map((/** @type {{ playerId: string }} */ { playerId }) => playerId)
		);
		let nextOrder = existingRoster.length;
		let inserted = 0;
		for (const playerId of uniqueIds) {
			if (existingIds.has(playerId)) continue;
			const [player] = await transaction
				.select({ id: players.id })
				.from(players)
				.where(eq(players.id, playerId))
				.limit(1);
			if (!player) continue;
			await transaction.insert(tournamentPlayers).values({
				tournamentId: input.tournamentId,
				playerId,
				displayOrder: nextOrder,
				notes: null
			});
			existingIds.add(playerId);
			nextOrder += 1;
			inserted += 1;
		}
		return inserted;
	});
}

/** @param {any} database @param {{ tournamentId: string, playerId: string }} input */
export async function removeRosterPlayer(database, input) {
	return database.transaction(async (/** @type {any} */ transaction) => {
		const [existingTournament] = await transaction
			.select({ id: tournaments.id })
			.from(tournaments)
			.where(eq(tournaments.id, input.tournamentId))
			.limit(1);
		if (!existingTournament) throw new Error('Tournament was not found');
		await transaction
			.delete(tournamentPlayers)
			.where(
				and(
					eq(tournamentPlayers.tournamentId, input.tournamentId),
					eq(tournamentPlayers.playerId, input.playerId)
				)
			);
		const ordered = await transaction
			.select({ playerId: tournamentPlayers.playerId })
			.from(tournamentPlayers)
			.where(eq(tournamentPlayers.tournamentId, input.tournamentId))
			.orderBy(asc(tournamentPlayers.displayOrder), asc(tournamentPlayers.playerId));
		for (const [displayOrder, row] of ordered.entries()) {
			await transaction
				.update(tournamentPlayers)
				.set({ displayOrder })
				.where(
					and(
						eq(tournamentPlayers.tournamentId, input.tournamentId),
						eq(tournamentPlayers.playerId, row.playerId)
					)
				);
		}
		return true;
	});
}

/** @param {any} database @param {{ tournamentId: string, playerId: string, displayOrder: number }} input */
export async function moveRosterPlayer(database, input) {
	return database.transaction(async (/** @type {any} */ transaction) => {
		const [existingTournament] = await transaction
			.select({ id: tournaments.id })
			.from(tournaments)
			.where(eq(tournaments.id, input.tournamentId))
			.limit(1);
		if (!existingTournament) throw new Error('Tournament was not found');
		const roster = await transaction
			.select({
				playerId: tournamentPlayers.playerId,
				displayOrder: tournamentPlayers.displayOrder
			})
			.from(tournamentPlayers)
			.where(eq(tournamentPlayers.tournamentId, input.tournamentId))
			.orderBy(asc(tournamentPlayers.displayOrder), asc(tournamentPlayers.playerId));
		const currentIndex = roster.findIndex(
			(/** @type {{ playerId: string }} */ row) => row.playerId === input.playerId
		);
		if (currentIndex === -1) throw new Error('Roster player was not found');
		const boundedTarget = Math.max(0, Math.min(input.displayOrder, roster.length - 1));
		if (boundedTarget === currentIndex) return true;
		const [moved] = roster.splice(currentIndex, 1);
		roster.splice(boundedTarget, 0, moved);
		for (const [displayOrder, row] of roster.entries()) {
			await transaction
				.update(tournamentPlayers)
				.set({ displayOrder })
				.where(
					and(
						eq(tournamentPlayers.tournamentId, input.tournamentId),
						eq(tournamentPlayers.playerId, row.playerId)
					)
				);
		}
		return true;
	});
}
