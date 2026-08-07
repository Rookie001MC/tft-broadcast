import { fail } from '@sveltejs/kit';

/** @param {unknown} value */
export function text(value) {
	return typeof value === 'string' ? value.trim() : '';
}

/** @param {FormDataEntryValue[]} values */
export function toStringValues(values) {
	return values
		.filter((value) => typeof value === 'string' && value.trim())
		.map((value) => /** @type {string} */ (value).trim());
}

/** @param {string} action @param {unknown} error @param {number} [status] */
export function actionFailure(action, error, status = 400) {
	const message = error instanceof Error ? error.message : 'The requested action failed.';
	return fail(status, { action, message });
}

/** @param {{ request: Request, url: URL }} event */
export async function requireTournamentId(event) {
	const form = await event.request.formData();
	const rawTournamentId = form.get('tournamentId') ?? event.url.searchParams.get('tournament');
	const tournamentId = text(rawTournamentId);
	if (!tournamentId) throw new Error('Tournament must be selected');
	return { form, tournamentId };
}
