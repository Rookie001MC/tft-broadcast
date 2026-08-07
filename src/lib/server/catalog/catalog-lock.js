const activeCatalogSyncs = new Set();

/** @param {string} tournamentId */
export function acquireCatalogSync(tournamentId) {
	if (activeCatalogSyncs.has(tournamentId)) return null;
	activeCatalogSyncs.add(tournamentId);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeCatalogSyncs.delete(tournamentId);
	};
}
