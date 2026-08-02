import { redirect } from '@sveltejs/kit';
import { user } from '$lib/server/db/schema/auth.js';

/** @param {string} pathname */
export function isAdminPath(pathname) {
	return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** @param {any} database */
export async function hasAnyUser(database) {
	const rows = await database.select({ id: user.id }).from(user).limit(1);
	return rows.length > 0;
}

/** @param {{ locals: App.Locals, url: URL }} event */
export function requireAdmin(event) {
	if (!event.locals.user) {
		const next = encodeURIComponent(event.url.pathname + event.url.search);
		redirect(303, `/login?next=${next}`);
	}
}
