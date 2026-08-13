import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	requireTftMatchApiConfig: vi.fn(),
	createRuntimeTftMatchGateway: vi.fn(),
	discoverTftMatchHistory: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: { RIOT_API_KEY: 'private-key', RIOT_REGION: 'VN2' }
}));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/tft-matches/config.js', () => ({
	requireTftMatchApiConfig: mocks.requireTftMatchApiConfig
}));
vi.mock('$lib/server/tft-matches/gateway.js', () => ({
	createRuntimeTftMatchGateway: mocks.createRuntimeTftMatchGateway
}));
vi.mock('$lib/server/tft-matches/discovery.js', () => ({
	discoverTftMatchHistory: mocks.discoverTftMatchHistory,
	TftMatchDiscoveryError: class TftMatchDiscoveryError extends Error {
		/** @param {number} status @param {string} operatorMessage */
		constructor(status, operatorMessage) {
			super(operatorMessage);
			this.status = status;
			this.operatorMessage = operatorMessage;
		}
	}
}));

import { POST } from './+server.js';

/** @param {{ user?: { id: string } | null, form?: FormData }} [input] */
function event({ user = { id: 'operator-1' }, form = new FormData() } = {}) {
	const request = new Request('https://broadcast.example/admin/graphics/tft-matches', {
		method: 'POST',
		body: form
	});
	return /** @type {any} */ ({ locals: user ? { user } : {}, request, url: new URL(request.url) });
}

describe('TFT match discovery endpoint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireTftMatchApiConfig.mockReturnValue({ region: 'VN2' });
		mocks.createRuntimeTftMatchGateway.mockReturnValue({ id: 'gateway' });
	});

	test('rejects an unauthenticated request before private config or discovery', async () => {
		await expect(POST(event({ user: null }))).rejects.toEqual(
			expect.objectContaining({ status: 303 })
		);
		expect(mocks.requireTftMatchApiConfig).not.toHaveBeenCalled();
		expect(mocks.discoverTftMatchHistory).not.toHaveBeenCalled();
	});

	test('uses only local tournament and roster player IDs and returns no-store safe discovery data', async () => {
		mocks.discoverTftMatchHistory.mockResolvedValue({
			token: 'opaque-token',
			selectedPlayer: { id: 'player-1', displayName: 'Selected' },
			matches: [
				{
					available: true,
					matchId: 'VN2_1',
					placement: 2,
					champions: [],
					omittedUnitCount: 1
				}
			]
		});
		const form = new FormData();
		form.set('tournamentId', 'tournament-1');
		form.set('playerId', 'player-1');
		form.set('riotId', 'attacker#TAG');
		form.set('puuid', 'attacker-puuid');
		form.set('matchId', 'VN2_attacker');
		form.set('region', 'KR');

		const response = await POST(event({ form }));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(await response.json()).toEqual(expect.objectContaining({ token: 'opaque-token' }));
		expect(mocks.discoverTftMatchHistory).toHaveBeenCalledWith({
			database: {},
			tournamentId: 'tournament-1',
			playerId: 'player-1',
			config: { region: 'VN2' },
			gateway: { id: 'gateway' }
		});
	});
});
