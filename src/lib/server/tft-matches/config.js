import { Constants } from 'twisted';

export class TftMatchApiConfigError extends Error {
	/** @param {string} operatorMessage */
	constructor(operatorMessage) {
		super(operatorMessage);
		this.name = 'TftMatchApiConfigError';
		this.operatorMessage = operatorMessage;
	}
}

/** @param {unknown} value */
function trimmed(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @param {Record<string, string | undefined>} environment */
export function requireTftMatchApiConfig(environment) {
	const apiKey = trimmed(environment?.RIOT_API_KEY);
	if (!apiKey) throw new TftMatchApiConfigError('A Riot API key is required to fetch TFT matches.');
	const region = trimmed(environment?.RIOT_REGION).toUpperCase();
	if (!region)
		throw new TftMatchApiConfigError('A Riot platform region is required to fetch TFT matches.');
	const platformRegion = /** @type {any} */ (region);
	if (!Object.values(Constants.Regions).includes(platformRegion))
		throw new TftMatchApiConfigError('The configured Riot platform region is unsupported.');
	try {
		return {
			apiKey,
			region,
			accountRegionGroup: Constants.regionToRegionGroupForAccountAPI(platformRegion),
			matchRegionGroup: Constants.regionToRegionGroup(platformRegion)
		};
	} catch {
		throw new TftMatchApiConfigError('The configured Riot platform region is unsupported.');
	}
}

/** @param {Record<string, string | undefined>} environment */
export function getTftMatchApiAvailability(environment) {
	try {
		const config = requireTftMatchApiConfig(environment);
		return { enabled: true, region: config.region, reason: null };
	} catch (error) {
		if (error instanceof TftMatchApiConfigError)
			return { enabled: false, region: null, reason: error.operatorMessage };
		throw error;
	}
}
