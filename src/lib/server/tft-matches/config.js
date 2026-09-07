import { Constants } from 'twisted';

import { TftMatchRegionError, parseTftPlatformRegion } from './regions.js';

export class TftMatchConfigurationError extends Error {
	/** @param {string} operatorMessage */
	constructor(operatorMessage) {
		super(operatorMessage);
		this.name = 'TftMatchConfigurationError';
		this.operatorMessage = operatorMessage;
	}
}

/**
 * @param {{ environment: Record<string, string | undefined>, region: unknown }} input
 */
export function requireTftMatchApiConfig(input) {
	let region;
	try {
		region = parseTftPlatformRegion(input.region);
	} catch (error) {
		if (error instanceof TftMatchRegionError) {
			throw new TftMatchConfigurationError('Select a supported TFT platform region in Settings.');
		}
		throw error;
	}

	const apiKey = input.environment.RIOT_API_KEY?.trim() ?? '';
	if (!apiKey) {
		throw new TftMatchConfigurationError('A Riot API key is required to fetch TFT matches.');
	}

	try {
		const typedRegion = /** @type {Parameters<typeof Constants.regionToRegionGroup>[0]} */ (region);
		return {
			apiKey,
			region,
			accountRegionGroup: Constants.regionToRegionGroupForAccountAPI(typedRegion),
			matchRegionGroup: Constants.regionToRegionGroup(typedRegion)
		};
	} catch {
		throw new TftMatchConfigurationError('The selected TFT platform region is unavailable.');
	}
}

/**
 * @param {{ environment: Record<string, string | undefined>, region: unknown }} input
 * @returns {import('$lib/tft-match.js').TftMatchApiAvailability}
 */
export function getTftMatchApiAvailability(input) {
	let safeRegion = null;
	try {
		safeRegion = parseTftPlatformRegion(input.region);
	} catch (error) {
		if (!(error instanceof TftMatchRegionError)) throw error;
	}

	try {
		requireTftMatchApiConfig(input);
		return { enabled: true, region: safeRegion, reason: null };
	} catch (error) {
		if (!(error instanceof TftMatchConfigurationError)) throw error;
		return { enabled: false, region: safeRegion, reason: error.operatorMessage };
	}
}
