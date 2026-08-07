import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { acquireCatalogSync } from '$lib/server/catalog/catalog-lock.js';
import { syncAndActivateCatalog } from '$lib/server/catalog/catalog-sync.js';
import { db } from '$lib/server/db';

const MEDIA_ROOT = env.MEDIA_ROOT ?? 'media';
const encoder = new TextEncoder();

/** @param {unknown} value */
function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @param {unknown} caught */
function operatorMessage(caught) {
	if (!(caught instanceof Error)) return 'Catalog synchronization failed.';
	if (caught.name === 'AbortError') return 'Catalog synchronization was cancelled.';
	const allowed = [
		'Tournament not found',
		'Catalog patch must be',
		'Catalog locale must',
		'size limit',
		'unsafe path',
		'not allowed'
	];
	return allowed.some((value) => caught.message.includes(value))
		? caught.message
		: 'Catalog synchronization failed; the prior snapshot remains active.';
}

/** @type {import('./$types').RequestHandler} */
export async function POST(event) {
	requireAdmin(event);
	const form = await event.request.formData();
	const tournamentId = text(form.get('tournamentId'));
	if (!tournamentId) error(400, 'Tournament must be selected');
	const release = acquireCatalogSync(tournamentId);
	if (!release) error(409, 'A catalog sync is already running.');
	const patch = text(form.get('patch')) || 'latest';
	const locale = text(form.get('locale')) || 'vi_vn';
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
					send({ type: 'error', message: operatorMessage(caught) });
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
