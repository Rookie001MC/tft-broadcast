import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { hasAnyUser } from '$lib/server/auth/guards.js';
import { FIRST_OPERATOR_CLAIM_HEADER, releaseFirstOperatorClaim } from '$lib/server/auth/claims.js';

/** @type {import('./$types').PageServerLoad} */
export async function load() {
	if (await hasAnyUser(db)) redirect(303, '/login');
}

/** @satisfies {import('./$types').Actions} */
export const actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const rawName = form.get('name');
		const rawEmail = form.get('email');
		const rawPassword = form.get('password');
		const name = typeof rawName === 'string' ? rawName.trim() : '';
		const email = typeof rawEmail === 'string' ? rawEmail.trim() : '';
		const password = typeof rawPassword === 'string' ? rawPassword : '';

		if (!name || !email) return fail(400, { message: 'Name and email are required.' });
		if (password.length < 12) {
			return fail(400, { message: 'Password must be at least 12 characters.' });
		}

		if (await hasAnyUser(db)) redirect(303, '/login');
		const claimToken = crypto.randomUUID();
		const headers = new Headers(request.headers);
		headers.set(FIRST_OPERATOR_CLAIM_HEADER, claimToken);

		try {
			await auth.api.signUpEmail({
				headers,
				body: { name, email, password }
			});
		} catch {
			try {
				if (!(await hasAnyUser(db))) await releaseFirstOperatorClaim(db, claimToken);
			} catch {
				// A stranded pending claim stays fail-closed for explicit operator intervention.
			}
			return fail(400, { message: 'Unable to create the operator account.' });
		}

		redirect(303, '/admin');
	}
};
