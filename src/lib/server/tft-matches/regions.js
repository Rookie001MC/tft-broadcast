import { Constants } from 'twisted';

export class TftMatchRegionError extends Error {
	/** @param {string} message */
	constructor(message = 'Choose a supported TFT platform region.') {
		super(message);
		this.name = 'TftMatchRegionError';
	}
}

const regionEntries = Object.entries(Constants.Regions);
const supportedRegions = new Set(regionEntries.map(([, value]) => /** @type {string} */ (value)));

/** @param {string} name */
function labelFromName(name) {
	return name
		.split('_')
		.map((word) =>
			word.length <= 3 ? word : `${word.slice(0, 1)}${word.slice(1).toLocaleLowerCase('en-US')}`
		)
		.join(' ');
}

export function getTftPlatformRegionOptions() {
	return regionEntries.map(([name, value]) => ({
		value,
		label: `${labelFromName(name)} (${value})`
	}));
}

/** @param {unknown} value */
export function parseTftPlatformRegion(value) {
	if (typeof value !== 'string' || !supportedRegions.has(value)) throw new TftMatchRegionError();
	return value;
}
