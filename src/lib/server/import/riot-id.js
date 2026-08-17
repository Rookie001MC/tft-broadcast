const GAME_NAME = /^[\p{L}\p{N}\p{M} ]+$/u;
const TAGLINE = /^[A-Za-z0-9]{3,5}$/;

/** @param {string} value */
function characterLength(value) {
	return [...value].length;
}

/**
 * Normalize a Riot ID without changing its display casing.
 *
 * Game Names may contain Unicode letters, combining marks, numbers, and
 * spaces. Taglines remain 3-5 ASCII letters or numbers.
 *
 * @param {string} raw
 */
export function normalizeRiotId(raw) {
	if (typeof raw !== 'string') {
		throw new Error('Riot ID must be a string');
	}

	const segments = raw.split('#');

	if (segments.length !== 2) {
		throw new Error('Riot ID must contain exactly one #');
	}

	const [gameName, tagline] = segments.map((segment) =>
		segment.trim().normalize('NFC')
	);

	const gameNameLength = characterLength(gameName);

	if (
		gameNameLength < 3 ||
		gameNameLength > 16 ||
		!GAME_NAME.test(gameName)
	) {
		throw new Error(
			'Riot ID game name must be 3-16 letters, numbers, marks, or spaces'
		);
	}

	if (!TAGLINE.test(tagline)) {
		throw new Error(
			'Riot ID tagline must be 3-5 alphanumeric characters'
		);
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