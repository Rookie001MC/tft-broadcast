import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';

import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import {
	requireTftMatchApiConfig,
	TftMatchConfigurationError
} from '$lib/server/tft-matches/config.js';
import {
	createRuntimeTftMatchGateway,
	TftMatchGatewayError
} from '$lib/server/tft-matches/gateway.js';
import {
	discoverTftMatchHistory,
	TftMatchPreviewConflictError
} from '$lib/server/tft-matches/service.js';
import { getTftMatchSettings } from '$lib/server/tft-matches/settings-repository.js';

const TEMPORARY_MESSAGE = 'TFT match history is temporarily unavailable. Please try again.';
const SAFE_DISCOVERY_MESSAGES = new Set([
	'Select a player from this tournament roster.',
	'This player needs a complete Riot ID.',
	'This tournament needs an active catalog.',
	'The active catalog is unavailable.'
]);

/** @param {FormDataEntryValue | null} value */
function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @param {TftMatchGatewayError} caught */
function gatewayStatus(caught) {
	if (caught.category === 'not_found') return 404;
	if (caught.category === 'rate_limit') return 429;
	return 503;
}

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	requireAdmin(event);
	const form = await event.request.formData();
	const tournamentId = text(form.get('tournamentId'));
	const playerId = text(form.get('playerId'));
	if (!tournamentId || !playerId) error(400, 'A tournament and roster player are required.');

	try {
		const { region } = await getTftMatchSettings(db);
		const config = requireTftMatchApiConfig({ environment: env, region });
		const gateway = createRuntimeTftMatchGateway(config);
		const result = await discoverTftMatchHistory({
			database: db,
			tournamentId,
			playerId,
			config,
			gateway
		});
		return json(result, {
			headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
		});
	} catch (caught) {
		if (caught instanceof TftMatchConfigurationError) error(503, caught.operatorMessage);
		if (caught instanceof TftMatchGatewayError) {
			error(gatewayStatus(caught), caught.operatorMessage);
		}
		if (caught instanceof TftMatchPreviewConflictError) error(409, caught.operatorMessage);
		if (caught instanceof Error && SAFE_DISCOVERY_MESSAGES.has(caught.message)) {
			error(422, caught.message);
		}
		error(503, TEMPORARY_MESSAGE);
	}
}
