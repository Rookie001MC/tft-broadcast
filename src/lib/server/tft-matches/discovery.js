import { and, eq } from 'drizzle-orm';
import { catalogChampions, catalogSnapshots } from '$lib/server/db/schema/catalog.js';
import { players } from '$lib/server/db/schema/players.js';
import { tournamentPlayers, tournaments } from '$lib/server/db/schema/tournaments.js';
import { getTftMatchPreviewBatch, storeTftMatchPreviewBatch } from './cache.js';
import {
	normalizeTftMatch,
	parseCanonicalTftMatchSnapshot,
	previewRowFromSnapshot,
	TftMatchContractError
} from './contract.js';

const PREVIEW_REFETCH_MESSAGE = 'This API preview is no longer available. Fetch it again.';

export class TftMatchDiscoveryError extends Error {
	/** @param {number} status @param {string} operatorMessage */
	constructor(status, operatorMessage) {
		super(operatorMessage);
		this.name = 'TftMatchDiscoveryError';
		this.status = status;
		this.operatorMessage = operatorMessage;
	}
}

export class TftMatchPreviewConflictError extends TftMatchDiscoveryError {
	constructor() {
		super(409, PREVIEW_REFETCH_MESSAGE);
		this.name = 'TftMatchPreviewConflictError';
	}
}

/** @param {unknown} value */
function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @param {any} database @param {{ tournamentId: string, playerId: string }} input */
export async function loadTftMatchDiscoveryContext(database, input) {
	const [membership] = await database
		.select({
			tournamentId: tournaments.id,
			activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId,
			playerId: players.id,
			displayName: players.displayName,
			riotGameName: players.riotGameName,
			riotTagline: players.riotTagline
		})
		.from(tournamentPlayers)
		.innerJoin(players, eq(tournamentPlayers.playerId, players.id))
		.innerJoin(tournaments, eq(tournamentPlayers.tournamentId, tournaments.id))
		.where(
			and(
				eq(tournamentPlayers.tournamentId, input.tournamentId),
				eq(tournamentPlayers.playerId, input.playerId)
			)
		)
		.limit(1);
	if (!membership) return null;
	const catalogSnapshotId = text(membership.activeCatalogSnapshotId);
	if (!catalogSnapshotId)
		throw new TftMatchDiscoveryError(422, 'An active catalog is required to fetch TFT matches.');
	const [snapshot] = await database
		.select({ id: catalogSnapshots.id })
		.from(catalogSnapshots)
		.where(and(eq(catalogSnapshots.id, catalogSnapshotId), eq(catalogSnapshots.isAvailable, true)))
		.limit(1);
	if (!snapshot)
		throw new TftMatchDiscoveryError(
			422,
			'The active catalog is unavailable. Refresh the catalog first.'
		);
	const champions = await database
		.select({
			id: catalogChampions.id,
			externalId: catalogChampions.externalId,
			displayName: catalogChampions.displayName,
			iconPath: catalogChampions.iconPath,
			isExcluded: catalogChampions.isExcluded
		})
		.from(catalogChampions)
		.where(eq(catalogChampions.catalogSnapshotId, snapshot.id));
	return {
		tournamentId: membership.tournamentId,
		player: {
			id: membership.playerId,
			displayName: membership.displayName,
			riotGameName: membership.riotGameName,
			riotTagline: membership.riotTagline
		},
		activeCatalog: { id: snapshot.id, champions }
	};
}

/** @param {unknown} error */
function safeDetailFailure(error) {
	if (error instanceof TftMatchContractError) return error.operatorMessage;
	return 'This match could not be prepared. Try another match or fetch again.';
}

/**
 * @param {{ database: any, tournamentId: string, playerId: string, config: { region: string }, gateway: any, now?: Date | number, loadContext?: (database: any, input: { tournamentId: string, playerId: string }) => Promise<any> }} input
 */
export async function discoverTftMatchHistory(input) {
	const loadContext = input.loadContext ?? loadTftMatchDiscoveryContext;
	const context = await loadContext(input.database, {
		tournamentId: input.tournamentId,
		playerId: input.playerId
	});
	if (!context)
		throw new TftMatchDiscoveryError(404, 'The selected player is not on this tournament roster.');
	const gameName = text(context.player?.riotGameName);
	const tagline = text(context.player?.riotTagline);
	if (!gameName || !tagline)
		throw new TftMatchDiscoveryError(
			422,
			'The selected player needs a complete Riot ID before fetching matches.'
		);
	const eligibleCatalog = context.activeCatalog?.champions?.filter(
		/** @param {any} champion */ (champion) => !champion.isExcluded
	);
	if (!Array.isArray(eligibleCatalog))
		throw new TftMatchDiscoveryError(
			422,
			'The active catalog is unavailable. Refresh the catalog first.'
		);
	const history = await input.gateway.fetchRecentMatches({ gameName, tagline });
	const puuid = text(history?.puuid);
	if (!puuid)
		throw new TftMatchDiscoveryError(
			503,
			'Riot match data is temporarily unavailable. Please try again.'
		);
	const successful = [];
	const unavailable = [];
	/** @type {Record<string, import('$lib/tft-match.js').CanonicalTftMatchSnapshot>} */
	const snapshots = {};
	for (const detail of Array.isArray(history?.matches) ? history.matches.slice(0, 10) : []) {
		const matchId = text(detail?.matchId);
		if (!matchId) continue;
		if (detail.error || !detail.payload) {
			unavailable.push({
				matchId,
				available: false,
				reason: text(detail.error) || safeDetailFailure(null)
			});
			continue;
		}
		try {
			const snapshot = normalizeTftMatch({
				payload: detail.payload,
				requestedMatchId: matchId,
				selectedPuuid: puuid,
				region: input.config.region,
				catalogChampions: eligibleCatalog,
				fetchedAt: typeof input.now === 'number' ? new Date(input.now) : (input.now ?? new Date())
			});
			snapshots[matchId] = snapshot;
			const { selectedPuuid: _selectedPuuid, ...preview } = /** @type {any} */ (
				previewRowFromSnapshot(snapshot, puuid)
			);
			successful.push({ available: true, ...preview });
		} catch (error) {
			unavailable.push({ matchId, available: false, reason: safeDetailFailure(error) });
		}
	}
	successful.sort((left, right) => right.completedAt.localeCompare(left.completedAt));
	const token = storeTftMatchPreviewBatch(
		{
			tournamentId: context.tournamentId,
			activeCatalogSnapshotId: context.activeCatalog.id,
			playerId: context.player.id,
			riotGameName: gameName,
			riotTagline: tagline,
			selectedPuuid: puuid,
			region: input.config.region,
			snapshots
		},
		{ now: input.now }
	);
	return {
		token,
		selectedPlayer: { id: context.player.id, displayName: context.player.displayName },
		matches: [...successful, ...unavailable]
	};
}

/**
 * @param {{ database: any, token: string, matchId: string, tournamentId: string, config: { region: string }, now?: Date | number, loadContext?: (database: any, input: { tournamentId: string, playerId: string }) => Promise<any> }} input
 */
export async function resolveTftMatchPreviewForSave(input) {
	const batch = getTftMatchPreviewBatch(text(input.token), { now: input.now });
	if (!batch || batch.tournamentId !== input.tournamentId || batch.region !== input.config.region)
		throw new TftMatchPreviewConflictError();
	const loadContext = input.loadContext ?? loadTftMatchDiscoveryContext;
	const context = await loadContext(input.database, {
		tournamentId: input.tournamentId,
		playerId: batch.playerId
	});
	if (
		!context ||
		context.activeCatalog?.id !== batch.activeCatalogSnapshotId ||
		text(context.player?.riotGameName) !== batch.riotGameName ||
		text(context.player?.riotTagline) !== batch.riotTagline
	)
		throw new TftMatchPreviewConflictError();
	try {
		const snapshot = parseCanonicalTftMatchSnapshot(batch.snapshots?.[text(input.matchId)]);
		if (
			snapshot.matchId !== input.matchId ||
			snapshot.region !== batch.region ||
			!snapshot.participants.some((participant) => participant.puuid === batch.selectedPuuid)
		)
			throw new Error('invalid preview binding');
		return snapshot;
	} catch {
		throw new TftMatchPreviewConflictError();
	}
}
