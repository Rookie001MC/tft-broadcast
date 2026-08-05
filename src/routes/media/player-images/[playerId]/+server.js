import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema/players.js';
import { readManagedPlayerImage } from '$lib/server/media/player-images.js';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';
const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** @type {import('./$types').RequestHandler} */
export async function GET({ params }) {
	const [player] = await db
		.select({ imagePath: players.imagePath })
		.from(players)
		.where(eq(players.id, params.playerId))
		.limit(1);
	if (!player?.imagePath) error(404, 'Player image was not found');

	let bytes;
	try {
		bytes = await readManagedPlayerImage({ mediaRoot: MEDIA_ROOT, relativePath: player.imagePath });
	} catch {
		error(404, 'Player image was not found');
	}

	const detected = await fileTypeFromBuffer(bytes);
	if (!detected || !SUPPORTED_TYPES.has(detected.mime)) error(415, 'Unsupported player image');

	return new Response(new Blob([bytes], { type: detected.mime }), {
		headers: {
			'Content-Type': detected.mime,
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=60'
		}
	});
}
