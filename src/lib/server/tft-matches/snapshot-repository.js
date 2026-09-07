import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { catalogSnapshots } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tftMatchSnapshots } from '../db/schema/tft-matches.js';
import { tournamentPlayers, tournaments } from '../db/schema/tournaments.js';
import { parseCanonicalTftMatchSnapshot } from './contract.js';

/**
 * @typedef {{
 *   snapshot: import('./contract.js').CanonicalTftMatchSnapshot,
 *   tournamentId: string,
 *   selectedPlayerId: string,
 *   selectedPuuid: string,
 *   activeCatalogSnapshotId: string,
 *   riotGameName: string,
 *   riotTagline: string,
 *   region: string
 * }} TftMatchSnapshotSource
 */

/**
 * @param {any} transaction
 * @param {TftMatchSnapshotSource} source
 * @param {{ id?: string, savedAt?: Date }} [dependencies]
 */
export async function insertTftMatchSnapshot(transaction, source, dependencies = {}) {
	const snapshot = parseCanonicalTftMatchSnapshot(source.snapshot);
	const [binding] = await transaction
		.select({
			tournamentId: tournaments.id,
			activeCatalogSnapshotId: tournaments.activeCatalogSnapshotId,
			selectedPlayerId: players.id,
			riotGameName: players.riotGameName,
			riotTagline: players.riotTagline
		})
		.from(tournamentPlayers)
		.innerJoin(tournaments, eq(tournaments.id, tournamentPlayers.tournamentId))
		.innerJoin(players, eq(players.id, tournamentPlayers.playerId))
		.innerJoin(
			catalogSnapshots,
			and(
				eq(catalogSnapshots.id, tournaments.activeCatalogSnapshotId),
				eq(catalogSnapshots.isAvailable, true)
			)
		)
		.where(
			and(
				eq(tournamentPlayers.tournamentId, source.tournamentId),
				eq(tournamentPlayers.playerId, source.selectedPlayerId)
			)
		)
		.limit(1);

	if (
		!binding ||
		binding.activeCatalogSnapshotId !== source.activeCatalogSnapshotId ||
		binding.riotGameName?.trim() !== source.riotGameName ||
		binding.riotTagline?.trim() !== source.riotTagline ||
		snapshot.source.region !== source.region ||
		!snapshot.source.matchId ||
		!snapshot.participants.some((participant) => participant.puuid === source.selectedPuuid)
	) {
		throw new Error('TFT match snapshot bindings changed before save');
	}

	const id = dependencies.id ?? randomUUID();
	await transaction.insert(tftMatchSnapshots).values({
		id,
		riotMatchId: snapshot.source.matchId,
		region: snapshot.source.region,
		tournamentId: binding.tournamentId,
		selectedPlayerId: binding.selectedPlayerId,
		activeCatalogSnapshotId: binding.activeCatalogSnapshotId,
		contractVersion: snapshot.contractVersion,
		payloadJson: JSON.stringify(snapshot),
		fetchedAt: new Date(snapshot.source.fetchedAt),
		savedAt: dependencies.savedAt ?? new Date()
	});
	return id;
}
