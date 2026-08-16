import { eq } from 'drizzle-orm';

import { tftMatchSettings } from '../db/schema/tft-match-settings.js';
import { parseTftPlatformRegion } from './regions.js';

/** @param {any} database */
export async function getTftMatchSettings(database) {
	const [setting] = await database
		.select({ region: tftMatchSettings.region })
		.from(tftMatchSettings)
		.where(eq(tftMatchSettings.id, 1))
		.limit(1);
	return { region: setting?.region ?? null };
}

/**
 * @param {any} database
 * @param {unknown} region
 * @param {{ updatedAt?: Date }} [options]
 */
export async function saveTftMatchRegion(database, region, options = {}) {
	const parsedRegion = parseTftPlatformRegion(region);
	const updatedAt = options.updatedAt ?? new Date();
	await database
		.insert(tftMatchSettings)
		.values({ id: 1, region: parsedRegion, updatedAt })
		.onConflictDoUpdate({
			target: tftMatchSettings.id,
			set: { region: parsedRegion, updatedAt }
		});
	return { region: parsedRegion };
}
