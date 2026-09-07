import { and, eq } from 'drizzle-orm';

import { catalogChampions, catalogSnapshots } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import {
	TftMatchContractError,
	normalizeTftMatch,
	parseCanonicalTftMatchSnapshot,
	previewRowFromSnapshot
} from './contract.js';
import { getTftMatchPreviewBatch, storeTftMatchPreviewBatch } from './preview-cache.js';

const FETCH_AGAIN_MESSAGE = 'This TFT match preview expired. Fetch the match again.';

export class TftMatchPreviewConflictError extends Error {
	constructor() {
		super(FETCH_AGAIN_MESSAGE);
		this.name = 'TftMatchPreviewConflictError';
		this.status = 409;
		this.operatorMessage = FETCH_AGAIN_MESSAGE;
	}
}

/** @param {any} database @param {string} tournamentId @param {string} playerId */
async function loadRosterContext(database, tournamentId, playerId) {
	const [context] = await database
		.select({
			tournamentId: tournaments.id,
			activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId,
			selectedPlayerId: players.id,
			displayName: players.displayName,
			riotId: players.riotId,
			riotGameName: players.riotGameName,
			riotTagline: players.riotTagline
		})
		.from(tournamentPlayers)
		.innerJoin(tournaments, eq(tournaments.id, tournamentPlayers.tournamentId))
		.innerJoin(players, eq(players.id, tournamentPlayers.playerId))
		.where(
			and(
				eq(tournamentPlayers.tournamentId, tournamentId),
				eq(tournamentPlayers.playerId, playerId)
			)
		)
		.limit(1);
	return context ?? null;
}

/** @param {any} database @param {string} snapshotId */
async function loadCatalogChampions(database, snapshotId) {
	const [snapshot] = await database
		.select({ id: catalogSnapshots.id })
		.from(catalogSnapshots)
		.where(and(eq(catalogSnapshots.id, snapshotId), eq(catalogSnapshots.isAvailable, true)))
		.limit(1);
	if (!snapshot) return null;
	return database
		.select({
			id: catalogChampions.id,
			externalId: catalogChampions.externalId,
			displayName: catalogChampions.displayName,
			iconPath: catalogChampions.iconPath,
			isExcluded: catalogChampions.isExcluded
		})
		.from(catalogChampions)
		.where(eq(catalogChampions.catalogSnapshotId, snapshotId));
}

/**
 * @param {{
 *   database: any,
 *   tournamentId: string,
 *   playerId: string,
 *   config: { region: string },
 *   gateway: { fetchRecentMatches(input: { gameName: string, tagline: string }): Promise<any> },
 *   now?: Date
 * }} input
 * @returns {Promise<import('$lib/tft-match.js').TftMatchDiscoveryResponse>}
 */
export async function discoverTftMatchHistory(input) {
	const context = await loadRosterContext(input.database, input.tournamentId, input.playerId);
	if (!context) throw new Error('Select a player from this tournament roster.');
	const riotGameName = context.riotGameName?.trim() ?? '';
	const riotTagline = context.riotTagline?.trim() ?? '';
	if (!riotGameName || !riotTagline) throw new Error('This player needs a complete Riot ID.');
	if (!context.activeCatalogSnapshotId) throw new Error('This tournament needs an active catalog.');
	const champions = await loadCatalogChampions(input.database, context.activeCatalogSnapshotId);
	if (!champions) throw new Error('The active catalog is unavailable.');

	const fetchedAt = (input.now ?? new Date()).toISOString();
	const history = await input.gateway.fetchRecentMatches({
		gameName: riotGameName,
		tagline: riotTagline
	});
	/** @type {Record<string, import('./contract.js').CanonicalTftMatchSnapshot>} */
	const snapshots = {};
	/** @type {Array<Extract<import('$lib/tft-match.js').TftMatchPreviewRow, { available: true }>>} */
	const successfulRows = [];
	/** @type {Array<{ matchId: string, reason: string }>} */
	const failures = [];
	for (const match of history.matches.slice(0, 10)) {
		if (match.error || match.payload === null) {
			failures.push({
				matchId: match.matchId,
				reason: match.error ?? 'This match is unavailable.'
			});
			continue;
		}
		try {
			const snapshot = normalizeTftMatch({
				payload: match.payload,
				requestedMatchId: match.matchId,
				selectedPuuid: history.puuid,
				region: input.config.region,
				catalogChampions: champions,
				fetchedAt
			});
			snapshots[match.matchId] = snapshot;
			const preview = previewRowFromSnapshot(snapshot, history.puuid);
			if (!preview.available) throw new TftMatchContractError(preview.reason);
			successfulRows.push(preview);
		} catch (error) {
			failures.push({
				matchId: match.matchId,
				reason:
					error instanceof TftMatchContractError
						? error.operatorMessage
						: 'This match response could not be used.'
			});
		}
	}
	successfulRows.sort(
		(left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt)
	);
	const unavailableRows = failures.map((failure) => ({
		available: /** @type {const} */ (false),
		matchId: failure.matchId,
		reason: failure.reason
	}));
	const selectedPlayer = {
		id: context.selectedPlayerId,
		displayName: context.displayName,
		riotId: context.riotId ?? `${riotGameName}#${riotTagline}`
	};
	const batch = {
		region: input.config.region,
		tournamentId: context.tournamentId,
		selectedPlayerId: context.selectedPlayerId,
		activeCatalogSnapshotId: context.activeCatalogSnapshotId,
		riotGameName,
		riotTagline,
		selectedPuuid: history.puuid,
		selectedPlayer,
		snapshots,
		failures
	};
	const token = storeTftMatchPreviewBatch(batch, { now: input.now });
	return { token, selectedPlayer, matches: [...successfulRows, ...unavailableRows] };
}

/**
 * @param {{
 *   database: any,
 *   token: string,
 *   matchId: string,
 *   tournamentId: string,
 *   config: { region: string },
 *   now?: Date
 * }} input
 */
export async function resolveTftMatchPreviewForSave(input) {
	const batch = getTftMatchPreviewBatch(input.token, { now: input.now });
	if (!batch || batch.tournamentId !== input.tournamentId || batch.region !== input.config.region) {
		throw new TftMatchPreviewConflictError();
	}
	const context = await loadRosterContext(
		input.database,
		input.tournamentId,
		batch.selectedPlayerId
	);
	if (
		!context ||
		context.activeCatalogSnapshotId !== batch.activeCatalogSnapshotId ||
		context.riotGameName?.trim() !== batch.riotGameName ||
		context.riotTagline?.trim() !== batch.riotTagline
	) {
		throw new TftMatchPreviewConflictError();
	}
	const snapshotValue = batch.snapshots?.[input.matchId];
	if (!snapshotValue) throw new TftMatchPreviewConflictError();

	let snapshot;
	try {
		snapshot = parseCanonicalTftMatchSnapshot(snapshotValue);
	} catch {
		throw new TftMatchPreviewConflictError();
	}
	if (
		snapshot.source.matchId !== input.matchId ||
		snapshot.source.region !== input.config.region ||
		!snapshot.participants.some((participant) => participant.puuid === batch.selectedPuuid)
	) {
		throw new TftMatchPreviewConflictError();
	}

	return {
		snapshot,
		tournamentId: context.tournamentId,
		selectedPlayerId: context.selectedPlayerId,
		selectedPuuid: batch.selectedPuuid,
		activeCatalogSnapshotId: context.activeCatalogSnapshotId,
		riotGameName: batch.riotGameName,
		riotTagline: batch.riotTagline,
		region: batch.region
	};
}
