import { db } from '$lib/server/db';
import { getGraphicVersion } from '$lib/server/winner-boards/repository.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
	const version = await getGraphicVersion(db);
	const etag = `"gfx-${version}"`;
	const headers = { ETag: etag, 'Cache-Control': 'no-store' };

	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers });
	}

	return Response.json({ version }, { headers });
}
