import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import {
	isPublicationId,
	isPublicationMediaFilename,
	readPublicationMedia
} from '$lib/server/winner-boards/publication-media.js';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';
const NOT_FOUND_MESSAGE = 'Publication media was not found';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params }) {
	if (
		!isPublicationId(params.publicationId) ||
		!isPublicationMediaFilename(params.publicationId, params.filename)
	) {
		error(404, NOT_FOUND_MESSAGE);
	}

	let asset;
	try {
		asset = await readPublicationMedia({
			mediaRoot: MEDIA_ROOT,
			publicationId: params.publicationId,
			filename: params.filename
		});
	} catch {
		error(404, NOT_FOUND_MESSAGE);
	}

	return new Response(new Blob([asset.bytes], { type: asset.mime }), {
		headers: {
			'Content-Type': asset.mime,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
}
