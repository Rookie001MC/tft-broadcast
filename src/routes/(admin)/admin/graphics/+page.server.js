import {
	actionFailure,
	requireTournamentId,
	text,
	toStringValues
} from '$lib/server/admin/form-helpers.js';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { loadAdminData } from '$lib/server/admin/load.js';
import { requireAdmin } from '$lib/server/auth/guards.js';
import { db } from '$lib/server/db';
import { loadTournamentAdminData } from '$lib/server/tournaments/repository.js';
import {
	getTftMatchApiAvailability,
	requireTftMatchApiConfig,
	TftMatchConfigurationError
} from '$lib/server/tft-matches/config.js';
import { deleteTftMatchPreviewBatch } from '$lib/server/tft-matches/preview-cache.js';
import {
	resolveTftMatchPreviewForSave,
	TftMatchPreviewConflictError
} from '$lib/server/tft-matches/service.js';
import { getTftMatchSettings } from '$lib/server/tft-matches/settings-repository.js';
import {
	getWinnerBoardState,
	resetWinnerBoardState,
	saveWinnerBoardState,
	setWinnerBoardLive
} from '$lib/server/winner-boards/repository.js';

/** @type {import('./$types').PageServerLoad} */
export async function load(event) {
	const [adminData, savedBoard, tftMatchSettings] = await Promise.all([
		loadAdminData(event),
		getWinnerBoardState(db),
		getTftMatchSettings(db)
	]);
	return {
		tournaments: adminData.tournaments,
		selectedTournament: adminData.selectedTournament,
		roster: adminData.roster,
		activeCatalog: adminData.activeCatalog,
		tftMatchApi: getTftMatchApiAvailability({
			environment: env,
			region: tftMatchSettings.region
		}),
		savedBoard,
		livePublicationId: adminData.liveBoard?.id ?? null
	};
}

/** @satisfies {import('./$types').Actions} */
export const actions = {
	saveBoard: async (event) => {
		requireAdmin(event);
		try {
			const { form, tournamentId } = await requireTournamentId(event);
			const tftPreviewToken = text(form.get('tftPreviewToken'));
			const tftMatchId = text(form.get('tftMatchId'));
			if (Boolean(tftPreviewToken) !== Boolean(tftMatchId)) {
				return actionFailure(
					'saveBoard',
					new Error('This TFT match preview expired. Fetch the match again.'),
					409
				);
			}
			const championIdValues = form.getAll('championIds');
			const championStarLevelValues = form.getAll('championStarLevels');
			if (championIdValues.length !== championStarLevelValues.length)
				throw new Error('Champion instance fields are misaligned');
			const champions = championIdValues.map((rawChampionId, index) => {
				const catalogChampionId = text(rawChampionId);
				const rawStarLevel = championStarLevelValues[index];
				if (!catalogChampionId || typeof rawStarLevel !== 'string')
					throw new Error('Champion instance fields are invalid');
				const normalizedStarLevel = rawStarLevel.trim();
				const starLevel = normalizedStarLevel === '' ? null : Number(normalizedStarLevel);
				if (starLevel !== null && (!Number.isInteger(starLevel) || starLevel < 1 || starLevel > 3))
					throw new Error('Star level must be between 1 and 3');
				return { catalogChampionId, starLevel };
			});
			let sourceSnapshot;
			if (tftPreviewToken && tftMatchId) {
				try {
					const { region } = await getTftMatchSettings(db);
					const config = requireTftMatchApiConfig({ environment: env, region });
					sourceSnapshot = await resolveTftMatchPreviewForSave({
						database: db,
						token: tftPreviewToken,
						matchId: tftMatchId,
						tournamentId,
						config
					});
				} catch (caught) {
					if (
						caught instanceof TftMatchPreviewConflictError ||
						caught instanceof TftMatchConfigurationError
					) {
						return actionFailure(
							'saveBoard',
							new Error('This TFT match preview expired. Fetch the match again.'),
							409
						);
					}
					throw caught;
				}
			}
			const boardInput = {
				tournamentId,
				winnerPlayerId: text(form.get('winnerPlayerId')),
				title: text(form.get('title')),
				champions,
				augmentIds: toStringValues(form.getAll('augmentIds'))
			};
			const board = await saveWinnerBoardState(
				db,
				sourceSnapshot ? { ...boardInput, sourceSnapshot } : boardInput
			);
			if (tftPreviewToken) deleteTftMatchPreviewBatch(tftPreviewToken);
			return { action: 'saveBoard', board };
		} catch {
			return actionFailure('saveBoard', new Error('Winner board details are invalid.'), 422);
		}
	},
	setLive: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const live = await setWinnerBoardLive(db, text(form.get('enabled')) === 'true');
			return { action: 'setLive', live };
		} catch {
			return actionFailure('setLive', new Error('Live status could not be changed.'), 409);
		}
	},
	resetBoard: async (event) => {
		requireAdmin(event);
		try {
			const form = await event.request.formData();
			const nextTournamentId = text(form.get('nextTournamentId')) || null;
			const result = await resetWinnerBoardState(db);
			return {
				action: 'resetBoard',
				...(nextTournamentId ? { nextTournamentId } : {}),
				result
			};
		} catch {
			return actionFailure('resetBoard', new Error('Winner board could not be reset.'), 409);
		}
	},
	resetAndSelectTournament: async (event) => {
		requireAdmin(event);
		const form = await event.request.formData();
		const nextTournamentId = text(form.get('nextTournamentId'));
		if (!nextTournamentId) {
			return actionFailure(
				'resetAndSelectTournament',
				new Error('A target tournament is required.'),
				400
			);
		}
		try {
			const { selectedTournament } = await loadTournamentAdminData(db, nextTournamentId);
			if (selectedTournament?.id !== nextTournamentId) {
				return actionFailure(
					'resetAndSelectTournament',
					new Error('The target tournament is no longer available.'),
					400
				);
			}
			await resetWinnerBoardState(db);
		} catch {
			return actionFailure(
				'resetAndSelectTournament',
				new Error('Winner board could not be reset.'),
				409
			);
		}
		redirect(303, `/admin/graphics?tournament=${encodeURIComponent(nextTournamentId)}`);
	}
};
