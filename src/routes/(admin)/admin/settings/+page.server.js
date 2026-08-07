import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { requireAdmin } from '$lib/server/auth/guards.js';

/** @satisfies {import('./$types').Actions} */
export const actions = {
	logout: async (event) => {
		requireAdmin(event);
		await auth.api.signOut({ headers: event.request.headers });
		redirect(303, '/login');
	}
};
