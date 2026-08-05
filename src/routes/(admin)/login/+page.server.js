import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { db } from "$lib/server/db";
import { user } from "$lib/server/db/schema";
/** @type {import('./$types').PageServerLoad} */
export async function load({ locals }) {
	if (locals.user) redirect(303, '/admin');

	// Check if there's already a user in the database.
	// Redirect to Setup if no user is there yet.
	const users = await db.select().from(user)
	if (users.length === 0) {
		redirect(303, '/setup');
	}

}

/** @satisfies {import('./$types').Actions} */
export const actions = {
	default: async ({ request, url }) => {
		const form = await request.formData();
		const rawEmail = form.get('email');
		const rawPassword = form.get('password');
		const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
		const password = typeof rawPassword === 'string' ? rawPassword : '';
		const next = url.searchParams.get('next');
		const safeNext = next === '/admin' || next?.startsWith('/admin/') ? next : '/admin';

		try {
			await auth.api.signInEmail({
				headers: request.headers,
				body: { email, password }
			});
		} catch {
			return fail(400, { message: 'Email or password is incorrect.' });
		}

		redirect(303, safeNext);
	}
};
