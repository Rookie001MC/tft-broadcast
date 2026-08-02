import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { hasAnyUser } from '$lib/server/auth/guards.js';
import {
	FIRST_OPERATOR_CLAIM_HEADER,
	claimFirstOperator,
	completeFirstOperatorClaim,
	releaseFirstOperatorClaim
} from '$lib/server/auth/claims.js';

const CLAIM_TOKEN_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	emailAndPassword: { enabled: true },
	hooks: {
		before: createAuthMiddleware(async (context) => {
			if (context.path !== '/sign-up/email') return;

			const providedToken = context.headers?.get(FIRST_OPERATOR_CLAIM_HEADER);
			const claimToken =
				providedToken && CLAIM_TOKEN_PATTERN.test(providedToken)
					? providedToken
					: crypto.randomUUID();
			if (!(await claimFirstOperator(db, claimToken))) throw new APIError('FORBIDDEN');

			return { context: { firstOperatorClaimToken: claimToken } };
		}),
		after: createAuthMiddleware(async (context) => {
			if (context.path !== '/sign-up/email') return;
			const claimToken = /** @type {any} */ (context).firstOperatorClaimToken;
			if (typeof claimToken !== 'string') return;

			if (await hasAnyUser(db)) {
				await completeFirstOperatorClaim(db, claimToken);
			} else {
				await releaseFirstOperatorClaim(db, claimToken);
			}
		})
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
