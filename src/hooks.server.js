import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

/** @type {import('@sveltejs/kit').Handle} */ const handleBetterAuth = async ({
	event,
	resolve
}) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export /** @type {import('@sveltejs/kit').Handle} */ const handle = handleBetterAuth;
