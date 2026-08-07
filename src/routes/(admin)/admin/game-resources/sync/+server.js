import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { catalogArchiveLimits } from '$lib/server/catalog/catalog-config.js';
import { acquireCatalogSync } from '$lib/server/catalog/catalog-lock.js';
import {
	catalogOperatorMessage,
	syncAndActivateCatalog
} from '$lib/server/catalog/catalog-sync.js';
import { db } from '$lib/server/db';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';
const encoder = new TextEncoder();

/** @param {unknown} value */
function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	requireAdmin(event);
	const form = await event.request.formData();
	const tournamentId = text(form.get('tournamentId'));
	if (!tournamentId) error(400, 'Tournament must be selected');
	const patch = text(form.get('patch')) || 'latest';
	const locale = text(form.get('locale')) || 'vi_vn';
	let archiveLimits;
	try {
		archiveLimits = catalogArchiveLimits(env);
	} catch (caught) {
		error(500, catalogOperatorMessage(caught));
	}
	const release = acquireCatalogSync(tournamentId);
	if (!release) error(409, 'A catalog sync is already running.');
	const abortController = new AbortController();
	if (event.request.signal.aborted) abortController.abort(event.request.signal.reason);
	else
		event.request.signal.addEventListener(
			'abort',
			() => abortController.abort(event.request.signal.reason),
			{ once: true }
		);

	const body = new ReadableStream({
		start(controller) {
			/** @param {any} update */
			const send = (update) => {
				if (!abortController.signal.aborted)
					controller.enqueue(encoder.encode(`${JSON.stringify(update)}\n`));
			};
			void (async () => {
				try {
					const result = await syncAndActivateCatalog({
						db,
						tournamentId,
						patch,
						locale,
						mediaRoot: MEDIA_ROOT,
						archiveLimits,
						signal: abortController.signal,
						onProgress: send
					});
					send({
						type: 'complete',
						activated: result.activated,
						snapshotId: result.snapshotId,
						source: result.source,
						warning: result.warning
					});
				} catch (caught) {
					send({ type: 'error', message: catalogOperatorMessage(caught) });
				} finally {
					release();
					if (!abortController.signal.aborted) controller.close();
				}
			})();
		},
		cancel() {
			abortController.abort(new DOMException('Client disconnected', 'AbortError'));
		}
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'application/x-ndjson; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			'X-Accel-Buffering': 'no'
		}
	});
}
