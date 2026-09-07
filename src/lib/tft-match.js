/**
 * @typedef {{ enabled: boolean, region: string | null, reason: string | null }} TftMatchApiAvailability
 *
 * @typedef {{
 *   catalogChampionId: string,
 *   externalId: string,
 *   displayName: string,
 *   iconPath: string | null,
 *   starLevel: number,
 *   displayOrder: number
 * }} TftMatchPreviewChampion
 *
 * @typedef {{
 *   available: true,
 *   matchId: string,
 *   completedAt: string,
 *   placement: number,
 *   gameType: string,
 *   setNumber: number,
 *   setCoreName: string,
 *   champions: TftMatchPreviewChampion[]
 * } | {
 *   available: false,
 *   matchId: string,
 *   reason: string
 * }} TftMatchPreviewRow
 *
 * @typedef {{
 *   token: string,
 *   selectedPlayer: { id: string, displayName: string, riotId: string },
 *   matches: TftMatchPreviewRow[]
 * }} TftMatchDiscoveryResponse
 *
 * @typedef {{
 *   previewToken: string,
 *   matchId: string,
 *   winnerPlayerId: string,
 *   champions: TftMatchPreviewChampion[]
 * }} TftMatchComposerDraft
 */

export {};
