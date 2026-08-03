import { randomUUID } from 'node:crypto';
import { players } from '$lib/server/db/schema/players.js';
import { normalizeRiotId } from '$lib/server/import/riot-id.js';

/** @param {any} database @param {{ fullName: string, displayName: string, riotId?: string | null }} input */
export async function createPlayer(database, input) {
	const fullName = input.fullName.trim();
	const displayName = input.displayName.trim();
	if (!fullName || !displayName) throw new Error('Full name and display name are required');

	let riotId = null;
	let riotIdKey = null;
	let riotGameName = null;
	let riotTagline = null;
	if (typeof input.riotId === 'string' && input.riotId.trim()) {
		const normalized = normalizeRiotId(input.riotId);
		riotId = normalized.riotId;
		riotIdKey = normalized.riotIdKey;
		riotGameName = normalized.gameName;
		riotTagline = normalized.tagline;
	}

	const now = new Date();
	const [created] = await database
		.insert(players)
		.values({
			id: randomUUID(),
			riotId,
			riotIdKey,
			riotGameName,
			riotTagline,
			fullName,
			displayName,
			imagePath: null,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return created ?? null;
}
