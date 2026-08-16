import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	env: { RIOT_API_KEY: 'private-key' },
	getTftMatchSettings: vi.fn(),
	requireTftMatchApiConfig: vi.fn(),
	createRuntimeTftMatchGateway: vi.fn(),
	discoverTftMatchHistory: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/tft-matches/settings-repository.js', () => ({
	getTftMatchSettings: mocks.getTftMatchSettings
}));
vi.mock('$lib/server/tft-matches/config.js', async (importOriginal) => ({
	...(await importOriginal()),
	requireTftMatchApiConfig: mocks.requireTftMatchApiConfig
}));
vi.mock('$lib/server/tft-matches/gateway.js', async (importOriginal) => ({
	...(await importOriginal()),
	createRuntimeTftMatchGateway: mocks.createRuntimeTftMatchGateway
}));
vi.mock('$lib/server/tft-matches/service.js', async (importOriginal) => ({
	...(await importOriginal()),
	discoverTftMatchHistory: mocks.discoverTftMatchHistory
}));

import { TftMatchConfigurationError } from '$lib/server/tft-matches/config.js';
import { TftMatchGatewayError } from '$lib/server/tft-matches/gateway.js';
import { POST } from './+server.js';

/** @param {FormData} form @param {boolean} [authenticated] */
function eventFor(form, authenticated = true) {
	const request = new Request('https://broadcast.example/admin/graphics/tft-matches', {
		method: 'POST',
		body: form
	});
	return /** @type {any} */ ({
		locals: authenticated ? { user: { id: 'operator-1' } } : {},
		request,
		url: new URL(request.url)
	});
}

describe('POST /admin/graphics/tft-matches', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getTftMatchSettings.mockResolvedValue({ region: 'VN2' });
		mocks.requireTftMatchApiConfig.mockReturnValue({ region: 'VN2' });
		mocks.createRuntimeTftMatchGateway.mockReturnValue({ fetchRecentMatches: vi.fn() });
	});

	test('requires an admin before reading the request body', async () => {
		await expect(POST(eventFor(new FormData(), false))).rejects.toMatchObject({
			status: 303,
			location: '/login?next=%2Fadmin%2Fgraphics%2Ftft-matches'
		});
		expect(mocks.getTftMatchSettings).not.toHaveBeenCalled();
	});

	test.each([
		['tournamentId', '', 'player-1'],
		['playerId', 'tournament-1', '']
	])('rejects an empty %s', async (_field, tournamentId, playerId) => {
		const form = new FormData();
		form.set('tournamentId', tournamentId);
		form.set('playerId', playerId);
		await expect(POST(eventFor(form))).rejects.toMatchObject({ status: 400 });
		expect(mocks.getTftMatchSettings).not.toHaveBeenCalled();
	});

	test('uses the persisted region and ignores request-owned Riot identifiers', async () => {
		const dto = { token: 'safe-token', selectedPlayer: { id: 'player-1' }, matches: [] };
		mocks.discoverTftMatchHistory.mockResolvedValue(dto);
		const gateway = { fetchRecentMatches: vi.fn() };
		mocks.createRuntimeTftMatchGateway.mockReturnValue(gateway);
		const form = new FormData();
		form.set('tournamentId', 'tournament-1');
		form.set('playerId', 'player-1');
		form.set('region', 'NA1');
		form.set('riotId', 'leaked#value');
		form.set('puuid', 'client-puuid');
		form.set('matchId', 'client-match');

		const response = await POST(eventFor(form));

		expect(mocks.requireTftMatchApiConfig).toHaveBeenCalledWith({
			environment: mocks.env,
			region: 'VN2'
		});
		expect(mocks.discoverTftMatchHistory).toHaveBeenCalledWith({
			database: {},
			tournamentId: 'tournament-1',
			playerId: 'player-1',
			config: { region: 'VN2' },
			gateway
		});
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		await expect(response.json()).resolves.toEqual(dto);
	});

	test('returns a safe unavailable response when configuration is missing', async () => {
		mocks.requireTftMatchApiConfig.mockImplementation(() => {
			throw new TftMatchConfigurationError('A Riot API key is required to fetch TFT matches.');
		});
		const form = new FormData();
		form.set('tournamentId', 'tournament-1');
		form.set('playerId', 'player-1');

		await expect(POST(eventFor(form))).rejects.toMatchObject({
			status: 503,
			body: { message: 'A Riot API key is required to fetch TFT matches.' }
		});
	});

	test.each([
		['auth', 403, 503, 'The Riot API key is unavailable or invalid.'],
		['not_found', 404, 404, "No Riot account was found for this player's Riot ID."],
		['rate_limit', 429, 429, 'Riot is temporarily limiting requests. Please try again shortly.'],
		['service', 503, 503, 'Riot is temporarily unavailable. Please try again.'],
		['timeout', null, 503, 'Riot is temporarily unavailable. Please try again.']
	])('maps %s gateway failures safely', async (category, upstreamStatus, status, message) => {
		mocks.discoverTftMatchHistory.mockRejectedValue(
			new TftMatchGatewayError(
				/** @type {any} */ (category),
				upstreamStatus,
				message,
				new Error('private-key https://riot.example internal stack')
			)
		);
		const form = new FormData();
		form.set('tournamentId', 'tournament-1');
		form.set('playerId', 'player-1');

		await expect(POST(eventFor(form))).rejects.toMatchObject({ status, body: { message } });
	});

	test('returns a generic response for unexpected failures', async () => {
		mocks.discoverTftMatchHistory.mockRejectedValue(new Error('private database value'));
		const form = new FormData();
		form.set('tournamentId', 'tournament-1');
		form.set('playerId', 'player-1');

		await expect(POST(eventFor(form))).rejects.toMatchObject({
			status: 503,
			body: { message: 'TFT match history is temporarily unavailable. Please try again.' }
		});
	});
});
