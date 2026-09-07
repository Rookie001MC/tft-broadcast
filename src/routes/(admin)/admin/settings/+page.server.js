import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import { getTftPlatformRegionOptions } from '$lib/server/tft-matches/regions.js';
import {
	getTftMatchSettings,
	saveTftMatchRegion
} from '$lib/server/tft-matches/settings-repository.js';

/** @type {import('./$types').PageServerLoad} */
export async function load(event) {
	requireAdmin(event);
	return {
		user: event.locals.user,
		tftMatchSettings: await getTftMatchSettings(db),
		tftPlatformRegionOptions: getTftPlatformRegionOptions()
	};
}

/** @satisfies {import('./$types').Actions} */
export const actions = {
	saveTftRegion: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const tftMatchSettings = await saveTftMatchRegion(db, form.get('region'));
			return { action: 'saveTftRegion', tftMatchSettings };
		} catch {
			return fail(422, {
				action: 'saveTftRegion',
				message: 'Choose a supported TFT platform region.'
			});
		}
	},
	logout: async (event) => {
		requireAdmin(event);
		await auth.api.signOut({ headers: event.request.headers });
		redirect(303, '/login');
	}
};
