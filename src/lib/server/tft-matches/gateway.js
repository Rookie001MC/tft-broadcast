import { RiotApi, TftApi } from 'twisted';

export class TftMatchGatewayError extends Error {
	/** @param {string} category @param {number} status @param {string} operatorMessage */
	constructor(category, status, operatorMessage) {
		super(operatorMessage);
		this.name = 'TftMatchGatewayError';
		this.category = category;
		this.status = status;
		this.operatorMessage = operatorMessage;
	}
}

/** @param {unknown} error */
function gatewayError(error) {
	const caught = /** @type {any} */ (error);
	const status =
		typeof caught?.status === 'number'
			? caught.status
			: caught?.response?.status
				? Number(caught.response.status)
				: 503;
	if (status === 401 || status === 403)
		return new TftMatchGatewayError(
			'authentication',
			status,
			'The Riot API key is unavailable or invalid.'
		);
	if (status === 404)
		return new TftMatchGatewayError(
			'not_found',
			status,
			'Riot could not find the requested player or match.'
		);
	if (status === 429)
		return new TftMatchGatewayError(
			'rate_limited',
			status,
			'Riot is temporarily limiting requests. Please try again.'
		);
	return new TftMatchGatewayError(
		'temporary',
		status >= 500 ? status : 503,
		'Riot match data is temporarily unavailable. Please try again.'
	);
}

/** @param {unknown} response */
/** @param {unknown} response @returns {any} */
function unwrap(response) {
	if (!response || typeof response !== 'object' || !('response' in response))
		throw new TftMatchGatewayError(
			'temporary',
			503,
			'Riot match data is temporarily unavailable. Please try again.'
		);
	return response.response;
}

/**
 * @param {{ riotApi: any, tftApi: any, accountRegionGroup: string, matchRegionGroup: string }} input
 */
export function createTftMatchGateway(input) {
	return {
		/** @param {{ gameName: string, tagline: string }} player */
		async fetchRecentMatches(player) {
			let puuid;
			let matchIds;
			try {
				const account = unwrap(
					await input.riotApi.Account.getByRiotId(
						player.gameName,
						player.tagline,
						input.accountRegionGroup
					)
				);
				puuid = typeof account?.puuid === 'string' ? account.puuid.trim() : '';
				if (!puuid)
					throw new TftMatchGatewayError(
						'not_found',
						404,
						'Riot could not find the requested player or match.'
					);
				const listed = unwrap(
					await input.tftApi.Match.list(puuid, input.matchRegionGroup, { count: 10 })
				);
				if (!Array.isArray(listed))
					throw new TftMatchGatewayError(
						'temporary',
						503,
						'Riot match data is temporarily unavailable. Please try again.'
					);
				matchIds = listed
					.filter((matchId) => typeof matchId === 'string' && matchId.trim())
					.slice(0, 10);
			} catch (error) {
				if (error instanceof TftMatchGatewayError) throw error;
				throw gatewayError(error);
			}

			const matches = [];
			for (const matchId of matchIds) {
				try {
					matches.push({
						matchId,
						payload: unwrap(await input.tftApi.Match.get(matchId, input.matchRegionGroup)),
						error: null
					});
				} catch (error) {
					matches.push({ matchId, payload: null, error: gatewayError(error).operatorMessage });
				}
			}
			return { puuid, matches };
		}
	};
}

/** @param {{ apiKey: string, region: string, accountRegionGroup: string, matchRegionGroup: string }} config */
export function createRuntimeTftMatchGateway(config) {
	const runtime = /** @type {any} */ (globalThis);
	const factory = runtime[Symbol.for('tft-match-v1.gateway-factory')];
	if (typeof factory === 'function') {
		return factory({
			region: config.region,
			accountRegionGroup: config.accountRegionGroup,
			matchRegionGroup: config.matchRegionGroup
		});
	}
	return createTftMatchGateway({
		riotApi: new RiotApi(config.apiKey),
		tftApi: new TftApi(config.apiKey),
		accountRegionGroup: config.accountRegionGroup,
		matchRegionGroup: config.matchRegionGroup
	});
}
