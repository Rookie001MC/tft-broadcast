import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import { requireTftMatchApiConfig } from '$lib/server/tft-matches/config.js';
import { discoverTftMatchHistory } from '$lib/server/tft-matches/discovery.js';
import { createRuntimeTftMatchGateway } from '$lib/server/tft-matches/gateway.js';

/** @param {unknown} value */
function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	requireAdmin(event);
	const form = await event.request.formData();
	const tournamentId = text(form.get('tournamentId'));
	const playerId = text(form.get('playerId'));
	if (!tournamentId || !playerId)
		return json({ message: 'A tournament and roster player are required.' }, { status: 400 });
	try {
		const config = requireTftMatchApiConfig(env);
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
	} catch (error) {
		const caught = /** @type {any} */ (error);
		const status = typeof caught?.status === 'number' ? caught.status : 503;
		const message =
			typeof caught?.operatorMessage === 'string'
				? caught.operatorMessage
				: 'Riot match data is temporarily unavailable. Please try again.';
		return json(
			{ message },
			{ status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
		);
	}
}
