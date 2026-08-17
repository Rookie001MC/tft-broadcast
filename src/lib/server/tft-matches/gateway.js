import { RiotApi, TftApi } from 'twisted';

const RUNTIME_GATEWAY_FACTORY = Symbol.for('tft-match-v1.gateway-factory');
const AUTH_MESSAGE = 'The Riot API key is unavailable or invalid.';
const ACCOUNT_NOT_FOUND_MESSAGE = "No Riot account was found for this player's Riot ID.";
const RATE_LIMIT_MESSAGE = 'Riot is temporarily limiting requests. Please try again shortly.';
const TEMPORARY_MESSAGE = 'Riot is temporarily unavailable. Please try again.';

export class TftMatchGatewayError extends Error {
	/**
	 * @param {'auth' | 'not_found' | 'rate_limit' | 'service' | 'timeout' | 'transport'} category
	 * @param {number | null} status
	 * @param {string} operatorMessage
	 * @param {unknown} [cause]
	 */
	constructor(category, status, operatorMessage, cause) {
		super(operatorMessage, cause === undefined ? undefined : { cause });
		this.name = 'TftMatchGatewayError';
		this.category = category;
		this.status = status;
		this.operatorMessage = operatorMessage;
	}
}

/** @param {unknown} error */
function errorStatus(error) {
	if (!error || typeof error !== 'object') return null;
	const record = /** @type {Record<string, any>} */ (error);
	for (const candidate of [
		record.status,
		record.statusCode,
		record.response?.status,
		record.error?.statusCode
	]) {
		if (typeof candidate === 'number') return candidate;
	}
	return null;
}

/** @param {unknown} error @param {boolean} [accountLookup] */
function translateGatewayError(error, accountLookup = false) {
	if (error instanceof TftMatchGatewayError) return error;
	const status = errorStatus(error);
	if (status === 401 || status === 403)
		return new TftMatchGatewayError('auth', status, AUTH_MESSAGE, error);
	if (accountLookup && status === 404)
		return new TftMatchGatewayError('not_found', status, ACCOUNT_NOT_FOUND_MESSAGE, error);
	if (status === 429)
		return new TftMatchGatewayError('rate_limit', status, RATE_LIMIT_MESSAGE, error);
	if (status !== null && status >= 500)
		return new TftMatchGatewayError('service', status, TEMPORARY_MESSAGE, error);
	if (error instanceof Error && error.name === 'AbortError')
		return new TftMatchGatewayError('timeout', status, TEMPORARY_MESSAGE, error);
	return new TftMatchGatewayError('transport', status, TEMPORARY_MESSAGE, error);
}

/** @param {unknown} value */
function requireResponse(value) {
	if (!value || typeof value !== 'object' || !('response' in value)) {
		throw new TftMatchGatewayError('transport', null, TEMPORARY_MESSAGE);
	}
	return value.response;
}

/**
 * @typedef {{
 *   puuid: string,
 *   matches: Array<
 *     | { matchId: string, payload: unknown, error: null }
 *     | { matchId: string, payload: null, error: string }
 *   >
 * }} TftGatewayHistory
 * @typedef {{
 *   fetchRecentMatches(input: { gameName: string, tagline: string }): Promise<TftGatewayHistory>
 * }} TftMatchGateway
 */

/**
 * @param {{
 *   riotApi: any,
 *   tftApi: any,
 *   accountRegionGroup: any,
 *   matchRegionGroup: any
 * }} dependencies
 * @returns {TftMatchGateway}
 */
export function createTftMatchGateway(dependencies) {
	return {
		async fetchRecentMatches({ gameName, tagline }) {
			let account;
			try {
				account = requireResponse(
					await dependencies.riotApi.Account.getByRiotId(
						gameName,
						tagline,
						dependencies.accountRegionGroup
					)
				);
			} catch (error) {
				throw translateGatewayError(error, true);
			}
			const accountRecord = /** @type {Record<string, unknown> | null} */ (
				account && typeof account === 'object' ? account : null
			);
			const puuid =
				accountRecord && typeof accountRecord.puuid === 'string' ? accountRecord.puuid.trim() : '';
			if (!puuid) throw new TftMatchGatewayError('transport', null, TEMPORARY_MESSAGE);

			let listedMatchIds;
			try {
				listedMatchIds = requireResponse(
					await dependencies.tftApi.Match.list(puuid, dependencies.matchRegionGroup, {
						count: 10
					})
				);
			} catch (error) {
				throw translateGatewayError(error);
			}
			if (
				!Array.isArray(listedMatchIds) ||
				!listedMatchIds.every((matchId) => typeof matchId === 'string' && matchId.trim())
			) {
				throw new TftMatchGatewayError('transport', null, TEMPORARY_MESSAGE);
			}

			const matches = [];
			for (const matchId of listedMatchIds.slice(0, 10)) {
				try {
					const payload = requireResponse(
						await dependencies.tftApi.Match.get(matchId, dependencies.matchRegionGroup)
					);
					matches.push({ matchId, payload, error: null });
				} catch (error) {
					matches.push({
						matchId,
						payload: null,
						error: translateGatewayError(error).operatorMessage
					});
				}
			}

			return { puuid, matches };
		}
	};
}

/**
 * @param {{ apiKey: string, region: string, accountRegionGroup: any, matchRegionGroup: any }} config
 * @returns {TftMatchGateway}
 */
export function createRuntimeTftMatchGateway(config) {
	const registry = /** @type {Record<symbol, unknown>} */ (/** @type {unknown} */ (globalThis));
	const factory = registry[RUNTIME_GATEWAY_FACTORY];
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
