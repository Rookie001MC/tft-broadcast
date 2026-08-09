import Fuse from 'fuse.js';

const FUSE_OPTIONS = Object.freeze({
	includeMatches: true,
	includeScore: true,
	ignoreLocation: true,
	keys: [
		{ name: 'displayName', weight: 0.55 },
		{ name: 'externalId', weight: 0.25 },
		{ name: 'engineCompact', weight: 0.15 },
		{ name: 'initials', weight: 0.05 }
	]
});

const MAX_FUZZY_SCORE = 0.6;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCatalogSearchText(value) {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replaceAll('đ', 'd')
		.replaceAll('Đ', 'd')
		.toLocaleLowerCase('en-US')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Split an engine identifier while preserving version prefixes such as TFT15.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function catalogSearchTokens(value) {
	const groups = String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.match(/[\p{L}\p{N}]+/gu);

	return (groups ?? []).flatMap((group) => {
		if (/^tft\d+$/iu.test(group)) return [normalizeCatalogSearchText(group)];

		return normalizeCatalogSearchText(
			group
				.replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
				.replace(/(\p{L})(\d)/gu, '$1 $2')
				.replace(/(\d)(\p{L})/gu, '$1 $2')
		)
			.split(' ')
			.filter(Boolean);
	});
}

/**
 * @typedef {{ id?: unknown, externalId?: unknown, displayName?: unknown }} CatalogSearchResource
 * @typedef {{ resource: CatalogSearchResource, index: number, displayName: string, initials: string, externalId: string, engineTokens: string[], engineCompact: string }} CatalogSearchDocument
 */

/**
 * @param {CatalogSearchResource} resource
 * @param {number} index
 * @returns {CatalogSearchDocument}
 */
export function catalogSearchDocument(resource, index) {
	const displayName = normalizeCatalogSearchText(resource.displayName);
	const engineTokens = catalogSearchTokens(resource.externalId);

	return {
		resource,
		index,
		displayName,
		initials: displayName
			.split(' ')
			.filter(Boolean)
			.map((part) => part[0])
			.join(''),
		externalId: normalizeCatalogSearchText(resource.externalId),
		engineTokens,
		engineCompact: engineTokens.join('')
	};
}

/**
 * @typedef {{ documents: CatalogSearchDocument[], fuse: Fuse<{ index: number, displayName: string, initials: string, externalId: string, engineCompact: string }> }} CatalogSearchIndex
 */

/**
 * @param {readonly CatalogSearchResource[]} resources
 * @returns {CatalogSearchIndex}
 */
export function createCatalogSearchIndex(resources) {
	const documents = Array.from(resources, catalogSearchDocument);
	const fuseDocuments = documents.map(
		({ index, displayName, initials, externalId, engineCompact }) => ({
			index,
			displayName,
			initials,
			externalId,
			engineCompact
		})
	);

	return {
		documents,
		fuse: new Fuse(fuseDocuments, FUSE_OPTIONS)
	};
}

/**
 * @param {string[]} engineTokens
 * @param {string[]} queryTokens
 * @returns {boolean}
 */
function hasEngineTokenPrefix(engineTokens, queryTokens) {
	if (queryTokens.length === 0 || queryTokens.length > engineTokens.length) return false;

	for (let offset = 0; offset <= engineTokens.length - queryTokens.length; offset += 1) {
		if (queryTokens.every((token, index) => engineTokens[offset + index].startsWith(token))) {
			return true;
		}
	}

	return false;
}

/**
 * @param {CatalogSearchDocument[]} ranked
 * @returns {CatalogSearchResource[]}
 */
function uniqueResources(ranked) {
	const seenIds = new Set();
	const seenReferences = new Set();
	const resources = [];

	for (const document of ranked) {
		const { resource } = document;
		const hasId = resource.id !== null && resource.id !== undefined && resource.id !== '';
		if ((hasId && seenIds.has(resource.id)) || seenReferences.has(resource)) continue;
		if (hasId) seenIds.add(resource.id);
		seenReferences.add(resource);
		resources.push(resource);
	}

	return resources;
}

/**
 * @param {CatalogSearchDocument} document
 * @param {readonly { key?: string }[]} matches
 * @param {string} compactQuery
 * @returns {number}
 */
function fuzzyFieldTier(document, matches, compactQuery) {
	if (matches.some(({ key }) => key === 'displayName')) return 0;
	if (document.initials === compactQuery) return 2;
	if (matches.some(({ key }) => key === 'externalId' || key === 'engineCompact')) return 1;
	return 2;
}

/**
 * @param {readonly CatalogSearchResource[]} resources
 * @param {unknown} query
 * @returns {CatalogSearchResource[]}
 */
export function searchCatalogResources(resources, query) {
	const rawQuery = String(query ?? '');
	if (!rawQuery.trim()) return Array.from(resources);

	const normalizedQuery = normalizeCatalogSearchText(query);
	const queryTokens = catalogSearchTokens(query);
	if (!normalizedQuery || queryTokens.length === 0) return [];

	const compactQuery = queryTokens.join('');
	const { documents, fuse } = createCatalogSearchIndex(resources);
	const exact = [];
	const prefix = [];
	const directIndexes = new Set();

	for (const document of documents) {
		if (
			document.displayName === normalizedQuery ||
			document.externalId === normalizedQuery ||
			document.engineCompact === compactQuery
		) {
			exact.push(document);
			directIndexes.add(document.index);
		} else if (
			document.displayName.startsWith(normalizedQuery) ||
			document.externalId.startsWith(normalizedQuery) ||
			(compactQuery !== '' && document.engineCompact.startsWith(compactQuery)) ||
			hasEngineTokenPrefix(document.engineTokens, queryTokens)
		) {
			prefix.push(document);
			directIndexes.add(document.index);
		}
	}

	const fuzzy = fuse
		.search(normalizedQuery)
		.filter(({ item, score }) => !directIndexes.has(item.index) && (score ?? 1) <= MAX_FUZZY_SCORE)
		.sort((left, right) => {
			const leftTier = fuzzyFieldTier(documents[left.item.index], left.matches ?? [], compactQuery);
			const rightTier = fuzzyFieldTier(
				documents[right.item.index],
				right.matches ?? [],
				compactQuery
			);
			return (
				leftTier - rightTier ||
				(left.score ?? 1) - (right.score ?? 1) ||
				left.item.index - right.item.index
			);
		})
		.map(({ item }) => documents[item.index]);

	return uniqueResources([...exact, ...prefix, ...fuzzy]);
}
