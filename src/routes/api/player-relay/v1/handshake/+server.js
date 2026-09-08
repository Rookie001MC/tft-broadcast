import { json } from '@sveltejs/kit';
import { handshake, isAuthorized } from '$lib/server/player-relay/receiver.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	if (!(await isAuthorized(request)))
		return json({ code: 'authentication_required' }, { status: 401 });
	try {
		return json(handshake(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ code: 'temporarily_unavailable' }, { status: 503 });
	}
}
