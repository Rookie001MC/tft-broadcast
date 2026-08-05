import { db } from '$lib/server/db';
import {
	getGraphicVersion,
	getPublishedWinnerBoard
} from '$lib/server/winner-boards/repository.js';

/** @type {import('./$types').PageServerLoad} */
export async function load() {
	const [board, version] = await Promise.all([getPublishedWinnerBoard(db), getGraphicVersion(db)]);
	return { board, version };
}
