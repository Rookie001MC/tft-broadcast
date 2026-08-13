import { randomUUID } from 'node:crypto';
import {
	tftMatchSnapshotParticipants,
	tftMatchSnapshots
} from '$lib/server/db/schema/tft-matches.js';
import { parseCanonicalTftMatchSnapshot } from './contract.js';

/**
 * Insert a validated immutable match snapshot using the caller's transaction.
 *
 * @param {any} transaction
 * @param {{ tournamentId: string, snapshot: unknown }} source
 * @param {{ id?: string, savedAt?: Date }} [overrides]
 */
export async function insertTftMatchSnapshot(transaction, source, overrides = {}) {
	const snapshot = parseCanonicalTftMatchSnapshot(source?.snapshot);
	if (typeof source?.tournamentId !== 'string' || !source.tournamentId.trim())
		throw new Error('TFT match snapshot tournament is invalid.');
	const id = overrides.id ?? randomUUID();
	const savedAt = overrides.savedAt ?? new Date();
	if (!(savedAt instanceof Date) || Number.isNaN(savedAt.getTime()))
		throw new Error('TFT match snapshot save timestamp is invalid.');

	await transaction.insert(tftMatchSnapshots).values({
		id,
		tournamentId: source.tournamentId,
		riotMatchId: snapshot.matchId,
		region: snapshot.region,
		queueId: snapshot.queueId,
		contractVersion: snapshot.contractVersion,
		completedAt: new Date(snapshot.completedAt),
		fetchedAt: new Date(snapshot.fetchedAt),
		savedAt
	});
	await transaction.insert(tftMatchSnapshotParticipants).values(
		snapshot.participants.map((participant) => ({
			id: randomUUID(),
			snapshotId: id,
			puuid: participant.puuid,
			placement: participant.placement,
			boardJson: JSON.stringify({
				champions: participant.champions,
				omittedUnitCount: participant.omittedUnitCount
			})
		}))
	);
	return id;
}
