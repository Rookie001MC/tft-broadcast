import { and, eq } from 'drizzle-orm';
import { catalogAugments, catalogChampions } from '../db/schema/catalog.js';
import { players } from '../db/schema/players.js';
import { tournaments } from '../db/schema/tournaments.js';
import {
	winnerBoardState,
	winnerBoardStateAugments,
	winnerBoardStateChampions
} from '../db/schema/winner-boards.js';
import {
	resetWinnerBoardStateInTransaction,
	runSerializedWinnerBoardWrite,
	runWinnerBoardWriteTransaction
} from './repository.js';

const CURRENT_STATE_ID = 'current';
const TARGET_KINDS = new Set(['player', 'tournament', 'champion', 'augment']);

/**
 * @typedef {{ kind: 'player' | 'tournament' | 'champion' | 'augment', id: string }} MaintenanceTarget
 */

/** @param {MaintenanceTarget} target */
function normalizeTarget(target) {
	if (!target || !TARGET_KINDS.has(target.kind)) throw new Error('Maintenance target is invalid');
	if (typeof target.id !== 'string' || !target.id.trim())
		throw new Error('Maintenance target ID is required');
	return { kind: target.kind, id: target.id.trim() };
}

/**
 * Inspect only the editable singleton and return a safe operator label. Immutable
 * publication payloads are intentionally outside this query boundary.
 *
 * @param {any} database
 * @param {MaintenanceTarget} rawTarget
 */
export async function inspectSavedStateDependency(database, rawTarget) {
	const target = normalizeTarget(rawTarget);
	if (target.kind === 'player') {
		const [dependency] = await database
			.select({ label: players.displayName })
			.from(winnerBoardState)
			.innerJoin(
				players,
				and(eq(players.id, target.id), eq(players.id, winnerBoardState.winnerPlayerId))
			)
			.where(eq(winnerBoardState.id, CURRENT_STATE_ID))
			.limit(1);
		return dependency ? { kind: target.kind, label: dependency.label } : null;
	}
	if (target.kind === 'tournament') {
		const [dependency] = await database
			.select({ label: tournaments.name })
			.from(winnerBoardState)
			.innerJoin(
				tournaments,
				and(eq(tournaments.id, target.id), eq(tournaments.id, winnerBoardState.tournamentId))
			)
			.where(eq(winnerBoardState.id, CURRENT_STATE_ID))
			.limit(1);
		return dependency ? { kind: target.kind, label: dependency.label } : null;
	}
	if (target.kind === 'champion') {
		const [dependency] = await database
			.select({ label: catalogChampions.displayName })
			.from(winnerBoardStateChampions)
			.innerJoin(
				catalogChampions,
				and(
					eq(catalogChampions.id, target.id),
					eq(catalogChampions.id, winnerBoardStateChampions.catalogChampionId)
				)
			)
			.where(eq(winnerBoardStateChampions.winnerBoardStateId, CURRENT_STATE_ID))
			.limit(1);
		return dependency ? { kind: target.kind, label: dependency.label } : null;
	}
	const [dependency] = await database
		.select({ label: catalogAugments.displayName })
		.from(winnerBoardStateAugments)
		.innerJoin(
			catalogAugments,
			and(
				eq(catalogAugments.id, target.id),
				eq(catalogAugments.id, winnerBoardStateAugments.catalogAugmentId)
			)
		)
		.where(eq(winnerBoardStateAugments.winnerBoardStateId, CURRENT_STATE_ID))
		.limit(1);
	return dependency ? { kind: target.kind, label: dependency.label } : null;
}

/**
 * Serialize a destructive mutation with Save/Live/Reset. The target dependency
 * is re-read after the write transaction opens; confirmation never substitutes
 * for that transaction-time check.
 *
 * @param {any} database
 * @param {{ target: MaintenanceTarget, confirmReset: boolean, operation: (transaction: any) => Promise<any> }} input
 */
export async function runDestructiveMaintenance(database, input) {
	const target = normalizeTarget(input.target);
	return runSerializedWinnerBoardWrite(() =>
		runWinnerBoardWriteTransaction(database, async (transaction) => {
			const dependency = await inspectSavedStateDependency(transaction, target);
			if (dependency && !input.confirmReset) {
				return { kind: 'reset_required', label: dependency.label };
			}
			if (dependency) await resetWinnerBoardStateInTransaction(transaction);
			const value = await input.operation(transaction);
			return {
				kind: dependency ? 'reset_complete' : 'not_required',
				reset: Boolean(dependency),
				value
			};
		})
	);
}

/**
 * @param {any} database
 * @param {{ target: MaintenanceTarget, operation: (transaction: any) => Promise<any> }} input
 */
export async function resetStateAndRun(database, input) {
	return runDestructiveMaintenance(database, { ...input, confirmReset: true });
}
