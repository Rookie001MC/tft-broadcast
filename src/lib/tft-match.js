/** @typedef {{ id: string, externalId: string, displayName: string, iconPath: string | null, isExcluded?: boolean }} CatalogChampion */

/** @typedef {{ catalogChampionId: string, externalId: string, displayName: string, iconPath: string | null, starLevel: 1 | 2 | 3, displayOrder: number }} TftMatchChampion */

/** @typedef {{ puuid: string, placement: number, champions: TftMatchChampion[] }} TftMatchParticipant */

/** @typedef {{ contractVersion: 1, matchId: string, region: string, queueId: number, completedAt: string, fetchedAt: string, participants: TftMatchParticipant[] }} CanonicalTftMatchSnapshot */

export {};
