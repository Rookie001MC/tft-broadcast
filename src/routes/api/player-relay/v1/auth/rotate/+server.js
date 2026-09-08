import { json } from '@sveltejs/kit';
import { rotatePassword } from '$lib/server/player-relay/receiver.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	let input;
	try {
		input = await request.json();
	} catch {
		return json({ code: 'invalid_password' }, { status: 400 });
	}
	const result = await rotatePassword(request, input?.password);
	if (result.status === 'rotated') return json({ status: 'rotated' });
	if (result.status === 'authentication_failed')
		return json({ code: 'authentication_required' }, { status: 401 });
	return json(
		{ code: result.status === 'invalid' ? 'invalid_password' : 'temporarily_unavailable' },
		{ status: result.status === 'invalid' ? 400 : 503 }
	);
}
