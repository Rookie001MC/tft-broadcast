/**
 * Client-safe winner-board view shared by the admin preview and broadcast graphic.
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   tournamentId: string,
 *   status: 'draft' | 'published' | 'hidden',
 *   updatedAt: Date,
 *   publishedAt: Date | null,
 *   winner: { id: string, displayName: string, riotId: string | null, imagePath: string | null },
 *   champions: Array<{ id: string, displayName: string, iconPath: string | null, starLevel: number | null, displayOrder: number }>,
 *   augments: Array<{ id: string, displayName: string, iconPath: string | null, displayOrder: number }>
 * }} WinnerBoardView
 */

export {};
