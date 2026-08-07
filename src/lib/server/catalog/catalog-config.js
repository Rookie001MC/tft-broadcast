const GIB = 1024 * 1024 * 1024;

export const DEFAULT_MAX_ARCHIVE_BYTES = 4 * GIB;
export const DEFAULT_MAX_EXTRACTED_BYTES = 16 * GIB;

/** @param {unknown} value @param {string} name @param {number} fallback */
function gibibytes(value, name, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
	const bytes = parsed * GIB;
	if (!Number.isSafeInteger(bytes)) throw new Error(`${name} is too large`);
	return bytes;
}

/** @param {Record<string, string | undefined>} [environment] */
export function catalogArchiveLimits(environment = {}) {
	return {
		maxArchiveBytes: gibibytes(
			environment.CATALOG_MAX_ARCHIVE_GIB,
			'CATALOG_MAX_ARCHIVE_GIB',
			DEFAULT_MAX_ARCHIVE_BYTES
		),
		maxExtractedBytes: gibibytes(
			environment.CATALOG_MAX_EXTRACTED_GIB,
			'CATALOG_MAX_EXTRACTED_GIB',
			DEFAULT_MAX_EXTRACTED_BYTES
		)
	};
}
