import { describe, expect, test } from 'vitest';
import {
	catalogSearchDocument,
	catalogSearchTokens,
	createCatalogSearchIndex,
	normalizeCatalogSearchText,
	searchCatalogResources
} from './catalog-search.js';

/**
 * @param {string} id
 * @param {string} externalId
 * @param {string} displayName
 * @param {boolean} [isExcluded]
 */
function resource(id, externalId, displayName, isExcluded = false) {
	return Object.freeze({
		id,
		externalId,
		displayName,
		iconPath: null,
		tier: null,
		correctionId: null,
		isExcluded,
		provenanceJson: '{"source":"upstream"}'
	});
}

const champions = Object.freeze([
	resource('champ-prefix-early', 'TFT15_Champion_FoxPrime', 'Ahri Prime'),
	resource('champ-exact-engine', 'Ahri', 'Hồ Ly Chín Đuôi'),
	resource('champ-exact-display', 'TFT15_Champion_NineTails', 'Ahri'),
	resource('champ-prefix-late', 'TFT15_Champion_RadiantFox', 'Ahri Rực Rỡ'),
	resource('champ-fuzzy-display', 'TFT15_Champion_ArcaneFox', 'Arii'),
	resource('champ-fuzzy-engine', 'Arii', 'Nữ Hồ Ly'),
	resource('champ-initials', 'TFT15_Champion_RedLight', 'Ánh Hồng Rực Im'),
	resource('champ-vietnamese', 'TFT15_Champion-Ahri2', 'Đấu Trường Chân Lý', true),
	resource('champ-short-name', 'TFT15_Champion-Fighter3', 'Đấu Sĩ')
]);

const augments = Object.freeze([
	resource('augment-heart', 'TFT15_Augment-WarriorHeart2', 'Trái Tim Chiến Binh'),
	resource('augment-crown', 'TFT15_Augment_MageCrown', 'Vương Miện Pháp Sư'),
	resource('augment-hidden', 'TFT15_Augment-Teamwork3', 'Đồng Đội', true)
]);

describe('catalog search normalization', () => {
	test('normalizes case, accents, Vietnamese đ, and repeated whitespace', () => {
		expect(normalizeCatalogSearchText('  ÉLISE\tĐấu   Sĩ \n')).toBe('elise dau si');
		expect(normalizeCatalogSearchText(null)).toBe('');
	});

	test('builds plain normalized document fields without replacing the resource reference', () => {
		const document = catalogSearchDocument(champions[7], 7);

		expect(document).toMatchObject({
			resource: champions[7],
			index: 7,
			displayName: 'dau truong chan ly',
			initials: 'dtcl',
			externalId: 'tft15_champion-ahri2',
			engineTokens: ['tft15', 'champion', 'ahri', '2'],
			engineCompact: 'tft15championahri2'
		});
		expect(document.resource).toBe(champions[7]);
	});

	test('splits uppercase letter-number suffixes while preserving the TFT version token', () => {
		expect(catalogSearchTokens('TFT15_Champion-X2_ABC3')).toEqual([
			'tft15',
			'champion',
			'x',
			'2',
			'abc',
			'3'
		]);

		const uppercaseSuffix = resource('champ-uppercase-suffix', 'TFT15_Champion-X2', 'Sentinel');
		expect(searchCatalogResources([uppercaseSuffix], 'x 2')).toEqual([uppercaseSuffix]);
	});
});

describe('catalog search indexing', () => {
	test('creates isolated indexes from frozen source-ordered resources', () => {
		const championIndex = createCatalogSearchIndex(champions);
		const augmentIndex = createCatalogSearchIndex(augments);

		expect(championIndex).toBeDefined();
		expect(augmentIndex).toBeDefined();
		expect(championIndex).not.toBe(augmentIndex);
		expect(champions.map((item) => item.id)).toEqual([
			'champ-prefix-early',
			'champ-exact-engine',
			'champ-exact-display',
			'champ-prefix-late',
			'champ-fuzzy-display',
			'champ-fuzzy-engine',
			'champ-initials',
			'champ-vietnamese',
			'champ-short-name'
		]);
	});
});

describe('catalog search ranking and identity', () => {
	test('ranks exact display and engine matches before prefixes and fuzzy fields', () => {
		const rankingResources = champions.slice(0, 7);
		const result = searchCatalogResources(rankingResources, 'ahri');
		const expected = [
			champions[1],
			champions[2],
			champions[0],
			champions[3],
			champions[4],
			champions[5],
			champions[6]
		];

		expect(result).toHaveLength(expected.length);
		expected.forEach((item, index) => expect(result[index]).toBe(item));
	});

	test('uses source order to settle equal-ranking ties', () => {
		const result = searchCatalogResources(champions.slice(0, 4), 'ahri');

		expect(result[0]).toBe(champions[1]);
		expect(result[1]).toBe(champions[2]);
		expect(result[2]).toBe(champions[0]);
		expect(result[3]).toBe(champions[3]);
	});

	test('returns the original objects in source order for an empty query', () => {
		const result = searchCatalogResources(champions, ' \t ');

		expect(result).toHaveLength(champions.length);
		champions.forEach((item, index) => expect(result[index]).toBe(item));
	});

	test('returns no matches for a nonempty query without searchable tokens', () => {
		for (const query of ['-', '_', '!!!']) {
			expect(searchCatalogResources(champions, query)).toEqual([]);
		}
	});

	test('keeps independently-created champion and augment scopes isolated', () => {
		const augmentResult = searchCatalogResources(augments, 'warrior heart 2');
		const championResult = searchCatalogResources(champions, 'warrior heart 2');

		expect(augmentResult[0]).toBe(augments[0]);
		expect(augmentResult).not.toContain(champions[0]);
		expect(championResult).toEqual([]);
		expect(championResult).not.toContain(augments[0]);
	});
});

describe('catalog search typo and abbreviation tolerance', () => {
	test('finds a one-character display-name typo', () => {
		expect(searchCatalogResources(champions, 'dau sy')[0]).toBe(champions[8]);
	});

	test('finds an abbreviated punctuated engine ID without aliases', () => {
		expect(Object.hasOwn(champions[7], 'aliases')).toBe(false);
		expect(searchCatalogResources(champions, 'champ ahri2')[0]).toBe(champions[7]);
		expect(searchCatalogResources(champions, 'TFT15 Champion Ahri 2')[0]).toBe(champions[7]);
	});

	test('finds normalized display-name initials without aliases', () => {
		expect(Object.hasOwn(champions[7], 'aliases')).toBe(false);
		expect(searchCatalogResources(champions, 'dtcl')[0]).toBe(champions[7]);
	});

	test('returns a hidden resource when it remains in the caller-provided scope', () => {
		expect(champions[7].isExcluded).toBe(true);
		expect(searchCatalogResources(champions, 'dau truong chan ly')[0]).toBe(champions[7]);
	});
});
