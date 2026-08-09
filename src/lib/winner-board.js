/**
 * Installation-wide editable winner-board state. Its identifiers continue to
 * resolve against the current tournament roster and active catalog snapshot.
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   tournamentId: string,
 *   updatedAt: Date,
 *   winner: { id: string, displayName: string, riotId: string | null, imagePath: string | null },
 *   champions: Array<{ id: string, displayName: string, iconPath: string | null, starLevel: number | null, displayOrder: number }>,
 *   augments: Array<{ id: string, displayName: string, iconPath: string | null, displayOrder: number }>
 * }} WinnerBoardStateView
 */

/**
 * Immutable rendering payload captured when the singleton is published. Image
 * fields contain only publication-scoped URLs (or null), never mutable sources.
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   tournamentId: string,
 *   winner: { id: string, displayName: string, riotId: string | null, imagePath: string | null },
 *   champions: Array<{ id: string, displayName: string, iconPath: string | null, starLevel: number | null, displayOrder: number }>,
 *   augments: Array<{ id: string, displayName: string, iconPath: string | null, displayOrder: number }>
 * }} WinnerBoardPublicationPayload
 */

/** @typedef {WinnerBoardStateView | WinnerBoardPublicationPayload} WinnerBoardView */

export {};
