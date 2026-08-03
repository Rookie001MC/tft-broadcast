import { requireAdmin } from '$lib/server/auth/guards.js';

/** @type {import('./$types').LayoutServerLoad} */
export function load(event) {
	requireAdmin(event);
	return { user: event.locals.user };
}
