import { and, eq } from 'drizzle-orm';
import { user } from '$lib/server/db/schema/auth.js';
import { firstOperatorClaim } from '$lib/server/db/schema/setup.js';

export const FIRST_OPERATOR_CLAIM_HEADER = 'x-first-operator-claim';

const FIRST_OPERATOR_CLAIM_ID = 1;
const CLAIM_TRANSACTION_ATTEMPTS = 3;

/** @param {unknown} error */
function isDatabaseLocked(error) {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		(error.code.startsWith('SQLITE_BUSY') || error.code.startsWith('SQLITE_LOCKED'))
	);
}

/** @param {number} milliseconds */
function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * @param {any} database
 * @param {string} token
 * @param {Date} now
 */
async function attemptFirstOperatorClaim(database, token, now) {
	return database.transaction(async (/** @type {any} */ transaction) => {
		const users = await transaction.select({ id: user.id }).from(user).limit(1);
		if (users.length > 0) return false;

		const inserted = await transaction
			.insert(firstOperatorClaim)
			.values({
				id: FIRST_OPERATOR_CLAIM_ID,
				token,
				status: 'pending',
				claimedAt: now
			})
			.onConflictDoNothing()
			.returning({ id: firstOperatorClaim.id });

		return inserted.length === 1;
	});
}

/**
 * Atomically confirms that no user exists and acquires the singleton setup claim.
 * Existing pending and completed claims fail closed and are never replaced.
 *
 * @param {any} database
 * @param {string} token
 */
export async function claimFirstOperator(database, token) {
	const claimedAt = new Date();
	for (let attempt = 0; attempt < CLAIM_TRANSACTION_ATTEMPTS; attempt += 1) {
		try {
			return await attemptFirstOperatorClaim(database, token, claimedAt);
		} catch (error) {
			if (!isDatabaseLocked(error)) throw error;
			if (attempt === CLAIM_TRANSACTION_ATTEMPTS - 1) return false;
			await delay((attempt + 1) * 5);
		}
	}

	return false;
}

/**
 * @param {any} database
 * @param {string} token
 * @param {Date} [now]
 */
export async function completeFirstOperatorClaim(database, token, now = new Date()) {
	const completed = await database
		.update(firstOperatorClaim)
		.set({ status: 'complete', completedAt: now })
		.where(
			and(
				eq(firstOperatorClaim.id, FIRST_OPERATOR_CLAIM_ID),
				eq(firstOperatorClaim.token, token),
				eq(firstOperatorClaim.status, 'pending')
			)
		)
		.returning({ id: firstOperatorClaim.id });

	return completed.length === 1;
}

/**
 * @param {any} database
 * @param {string} token
 */
export async function releaseFirstOperatorClaim(database, token) {
	const released = await database
		.delete(firstOperatorClaim)
		.where(
			and(
				eq(firstOperatorClaim.id, FIRST_OPERATOR_CLAIM_ID),
				eq(firstOperatorClaim.token, token),
				eq(firstOperatorClaim.status, 'pending')
			)
		)
		.returning({ id: firstOperatorClaim.id });

	return released.length === 1;
}
