import { json } from '@sveltejs/kit';
import { isAuthorized, receiveCapture } from '$lib/server/player-relay/receiver.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	if (!isAuthorized(request)) return json({ code: 'authentication_required' }, { status: 401 });
	try {
		const result = await receiveCapture(request);
		return json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
	} catch {
		return json({ code: 'temporarily_unavailable' }, { status: 503 });
	}
}
