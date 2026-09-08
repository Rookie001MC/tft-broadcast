import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema/players.js';
import { normalizeRiotId } from '$lib/server/import/riot-id.js';

/** @param {any} data */
export async function winnerPortrait(data) {
	const winner = data?.players?.find((/** @type {any} */ player) => player.ffaStanding === 1);
	if (!winner) return '';
	let identity;
	try {
		identity = normalizeRiotId(`${winner.riotIdGameName}#${winner.riotIdTagLine}`);
	} catch {
		return '';
	}
	const [player] = await db
		.select({ id: players.id, imagePath: players.imagePath, updatedAt: players.updatedAt })
		.from(players)
		.where(eq(players.riotIdKey, identity.riotIdKey))
		.limit(1);
	return player?.imagePath
		? `/media/player-images/${player.id}?v=${player.updatedAt.getTime()}`
		: '';
}
