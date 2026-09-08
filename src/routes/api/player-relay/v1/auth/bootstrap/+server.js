import { json } from '@sveltejs/kit';
import { bootstrapPassword } from '$lib/server/player-relay/receiver.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
	let input;
	try {
		input = await request.json();
	} catch {
		return json({ code: 'invalid_password' }, { status: 400 });
	}
	const result = await bootstrapPassword(input?.password);
	if (result.status === 'initialized') return json({ status: 'initialized' }, { status: 201 });
	if (result.status === 'already_initialized')
		return json({ code: 'already_initialized' }, { status: 409 });
	return json(
		{ code: result.status === 'invalid' ? 'invalid_password' : 'temporarily_unavailable' },
		{ status: result.status === 'invalid' ? 400 : 503 }
	);
}
