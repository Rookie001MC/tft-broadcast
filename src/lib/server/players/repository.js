import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { players } from '$lib/server/db/schema/players.js';
import { normalizeRiotId } from '$lib/server/import/riot-id.js';
import {
	assertManagedPlayerImagePath,
	deleteManagedPlayerImage,
	writeManagedPlayerImage
} from '$lib/server/media/player-images.js';
import { runDestructiveMaintenance } from '$lib/server/winner-boards/maintenance.js';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';

/** @param {unknown} value */
function optionalText(value) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {Record<string, unknown>} input */
function normalizedPlayerInput(input) {
	const fullName = optionalText(input.fullName);
	const displayName = optionalText(input.displayName);
	if (!fullName || !displayName) throw new Error('Full name and display name are required');

	const suppliedRiotId = optionalText(input.riotId);
	const suppliedGameName = optionalText(input.riotGameName);
	const suppliedTagline = optionalText(input.riotTagline);
	if (Boolean(suppliedGameName) !== Boolean(suppliedTagline))
		throw new Error('Riot game name and tagline must be provided together');
	const fromRiotId = suppliedRiotId ? normalizeRiotId(suppliedRiotId) : null;
	const fromParts =
		suppliedGameName && suppliedTagline
			? normalizeRiotId(`${suppliedGameName}#${suppliedTagline}`)
			: null;
	if (fromRiotId && fromParts && fromRiotId.riotIdKey !== fromParts.riotIdKey)
		throw new Error('Riot ID does not match its game name and tagline');
	const identity = fromRiotId ?? fromParts;
	return {
		fullName,
		displayName,
		riotId: identity?.riotId ?? null,
		riotIdKey: identity?.riotIdKey ?? null,
		riotGameName: identity?.gameName ?? null,
		riotTagline: identity?.tagline ?? null
	};
}

/** @param {string} mediaRoot @param {string | null | undefined} relativePath */
async function deletePriorManagedImage(mediaRoot, relativePath) {
	if (!relativePath) return;
	try {
		assertManagedPlayerImagePath(relativePath);
	} catch {
		return;
	}
	await deleteManagedPlayerImage({ mediaRoot, relativePath });
}

/** @param {any} database @param {{ fullName: string, displayName: string, riotId?: string | null }} input */
export async function createPlayer(database, input) {
	const normalized = normalizedPlayerInput(input);

	const now = new Date();
	const [created] = await database
		.insert(players)
		.values({
			id: randomUUID(),
			...normalized,
			imagePath: null,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return created ?? null;
}

/**
 * @param {any} database
 * @param {{ playerId: string, fullName: string, displayName: string, riotId?: string | null, riotGameName?: string | null, riotTagline?: string | null }} input
 */
export async function updatePlayer(database, input) {
	const normalized = normalizedPlayerInput(input);
	const [updated] = await database
		.update(players)
		.set({ ...normalized, updatedAt: new Date() })
		.where(eq(players.id, input.playerId))
		.returning();
	if (!updated) throw new Error('Player was not found');
	return updated;
}

/**
 * @param {any} database
 * @param {{ playerId: string, mediaRoot?: string, bytes: Uint8Array, mime: string }} input
 */
export async function replacePlayerImage(database, input) {
	const mediaRoot = input.mediaRoot ?? MEDIA_ROOT;
	const [existing] = await database
		.select()
		.from(players)
		.where(eq(players.id, input.playerId))
		.limit(1);
	if (!existing) throw new Error('Player was not found');

	const stagedPath = await writeManagedPlayerImage({
		mediaRoot,
		playerId: existing.id,
		bytes: input.bytes,
		mime: input.mime
	});
	let result;
	try {
		result = await database.transaction(async (/** @type {any} */ transaction) => {
			const [current] = await transaction
				.select({ id: players.id, imagePath: players.imagePath })
				.from(players)
				.where(eq(players.id, input.playerId))
				.limit(1);
			if (!current) throw new Error('Player was not found');
			const [stored] = await transaction
				.update(players)
				.set({ imagePath: stagedPath, updatedAt: new Date() })
				.where(eq(players.id, input.playerId))
				.returning();
			if (!stored) throw new Error('Player was not found');
			return { stored, previousImagePath: current.imagePath };
		});
	} catch (error) {
		await deleteManagedPlayerImage({ mediaRoot, relativePath: stagedPath });
		throw error;
	}
	await deletePriorManagedImage(mediaRoot, result.previousImagePath);
	return result.stored;
}

/** @param {any} database @param {{ playerId: string, mediaRoot?: string }} input */
export async function removePlayerImage(database, input) {
	const mediaRoot = input.mediaRoot ?? MEDIA_ROOT;
	const result = await database.transaction(async (/** @type {any} */ transaction) => {
		const [existing] = await transaction
			.select()
			.from(players)
			.where(eq(players.id, input.playerId))
			.limit(1);
		if (!existing) throw new Error('Player was not found');
		const [updated] = await transaction
			.update(players)
			.set({ imagePath: null, updatedAt: new Date() })
			.where(eq(players.id, input.playerId))
			.returning();
		return { existing, updated };
	});
	await deletePriorManagedImage(mediaRoot, result.existing.imagePath);
	return result.updated;
}

/**
 * @param {any} database
 * @param {{ playerId: string, confirmReset?: boolean, mediaRoot?: string }} input
 */
export async function deletePlayer(database, input) {
	const outcome = await runDestructiveMaintenance(database, {
		target: { kind: 'player', id: input.playerId },
		confirmReset: input.confirmReset === true,
		operation: async (transaction) => {
			const [existing] = await transaction
				.select()
				.from(players)
				.where(eq(players.id, input.playerId))
				.limit(1);
			if (!existing) throw new Error('Player was not found');
			await transaction.delete(players).where(eq(players.id, input.playerId));
			return existing;
		}
	});
	if (outcome.kind === 'reset_required') return outcome;
	await deletePriorManagedImage(input.mediaRoot ?? MEDIA_ROOT, outcome.value.imagePath);
	return { deleted: true, reset: outcome.reset };
}
