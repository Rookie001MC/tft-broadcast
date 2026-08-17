let historyCallCount = 0;

export function createFakeTftMatchGateway() {
	return {
		/** @param {{ gameName: string, tagline: string }} input */
		async fetchRecentMatches(input) {
			historyCallCount += 1;
			const selectedPuuid = `e2e:${input.gameName}:${input.tagline}`;
			const participants = Array.from({ length: 8 }, (_, index) => {
				const placement = index + 1;
				const selected = placement === 4;
				return {
					puuid: selected ? selectedPuuid : `e2e-opponent-${placement}`,
					riotIdGameName: selected ? input.gameName : `Opponent ${placement}`,
					riotIdTagline: selected ? input.tagline : 'E2E',
					placement,
					level: selected ? 9 : 8,
					units: selected
						? [
								{ character_id: 'TFT16_TestChampion', tier: 2 },
								{ character_id: 'TFT16_TestChampion', tier: 1 }
							]
						: [{ character_id: 'TFT16_TestChampion', tier: 1 }]
				};
			});
			return {
				puuid: selectedPuuid,
				matches: [
					{
						matchId: 'VN2_E2E_MATCH_1',
						error: null,
						payload: {
							metadata: {
								data_version: '6',
								match_id: 'VN2_E2E_MATCH_1',
								participants: participants.map((participant) => participant.puuid)
							},
							info: {
								endOfGameResult: 'GameComplete',
								game_datetime: 1786842000000,
								game_length: 1800,
								game_version: 'Version 16.15 E2E',
								queueId: 1100,
								tft_game_type: 'standard',
								tft_set_core_name: 'TFTSet16',
								tft_set_number: 16,
								participants
							}
						}
					}
				]
			};
		}
	};
}

export function resetFakeTftMatchGatewayCounter() {
	historyCallCount = 0;
}

export function readFakeTftMatchGatewayCounter() {
	return historyCallCount;
}
