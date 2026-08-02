const GAME_NAME = /^[A-Za-z0-9]{3,16}$/;
const TAGLINE = /^[A-Za-z0-9]{3,5}$/;

/**
 * Normalize a Riot ID without changing its display casing.
 *
 * Game Names and taglines follow the local Riot ID format document: each is
 * alphanumeric, with lengths of 3-16 and 3-5 respectively.
 *
 * @param {string} raw
 */
export function normalizeRiotId(raw) {
	if (typeof raw !== 'string') throw new Error('Riot ID must be a string');

	const segments = raw.split('#');
	if (segments.length !== 2) throw new Error('Riot ID must contain exactly one #');

	const [gameName, tagline] = segments.map((segment) => segment.trim());
	if (!GAME_NAME.test(gameName)) {
		throw new Error('Riot ID game name must be 3-16 alphanumeric characters');
	}
	if (!TAGLINE.test(tagline)) {
		throw new Error('Riot ID tagline must be 3-5 alphanumeric characters');
	}

	const riotId = `${gameName}#${tagline}`;
	return {
		riotId,
		riotIdKey: riotId.toLocaleLowerCase('en-US'),
		gameName,
		tagline,
		imageKey: `${gameName}_${tagline}`.toLocaleLowerCase('en-US')
	};
}
