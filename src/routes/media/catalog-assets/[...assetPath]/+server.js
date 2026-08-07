import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { readManagedCatalogAsset } from '$lib/server/catalog/catalog-media.js';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params }) {
	let asset;
	try {
		asset = await readManagedCatalogAsset(MEDIA_ROOT, params.assetPath);
	} catch (caught) {
		if (caught instanceof Error && caught.message === 'Unsupported catalog image')
			error(415, caught.message);
		error(404, 'Catalog image was not found');
	}
	return new Response(new Blob([asset.bytes], { type: asset.mime }), {
		headers: {
			'Content-Type': asset.mime,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	});
}
