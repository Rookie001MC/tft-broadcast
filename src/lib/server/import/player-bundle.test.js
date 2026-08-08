import { zipSync } from 'fflate';
import yauzl from 'yauzl';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { normalizeRiotId } from './riot-id.js';
import { inspectPlayerBundle } from './player-bundle.js';

const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;

const ONE_BY_ONE_PNG = Uint8Array.from([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
	0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1,
	255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

/** @param {Record<string, Uint8Array>} entries */
function bundle(entries) {
	return zipSync(entries);
}

/** @param {string[]} rows @param {string} [header] */
function csv(rows, header = 'full_name,display_name,riot_id') {
	return new TextEncoder().encode(`${header}\r\n${rows.join('\r\n')}\r\n`);
}

/** @param {Uint8Array} bytes @param {number} offset @param {number} value */
function writeUint32LE(bytes, offset, value) {
	bytes[offset] = value & 0xff;
	bytes[offset + 1] = (value >>> 8) & 0xff;
	bytes[offset + 2] = (value >>> 16) & 0xff;
	bytes[offset + 3] = (value >>> 24) & 0xff;
}

/** @param {Uint8Array} bytes @param {number} [index] */
function centralDirectoryOffset(bytes, index = 0) {
	let found = 0;
	for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
		if (
			bytes[offset] === 0x50 &&
			bytes[offset + 1] === 0x4b &&
			bytes[offset + 2] === 0x01 &&
			bytes[offset + 3] === 0x02
		) {
			if (found === index) return offset;
			found += 1;
		}
	}
	throw new Error('Central directory entry was not found');
}

/** @param {Uint8Array} bytes */
function setUnixSymlink(bytes) {
	const offset = centralDirectoryOffset(bytes);
	bytes[offset + 5] = 3;
	writeUint32LE(bytes, offset + 38, 0o120777 << 16);
	return bytes;
}

/** @param {Uint8Array} bytes @param {number} size @param {number} [index] */
function setDeclaredExpandedSize(bytes, size, index = 0) {
	const offset = centralDirectoryOffset(bytes, index);
	writeUint32LE(bytes, offset + 24, size);
	return bytes;
}

/** @param {Record<string, Uint8Array>} entries @param {number | number[]} declaredSizes */
function zipWithDeclaredSize(entries, declaredSizes) {
	const bytes = bundle(entries);
	const sizes = Array.isArray(declaredSizes)
		? declaredSizes
		: Array.from({ length: Object.keys(entries).length }, () => declaredSizes);
	for (const [index, size] of sizes.entries()) setDeclaredExpandedSize(bytes, size, index);
	return bytes;
}

/** @param {number} size */
function paddedPng(size) {
	const bytes = new Uint8Array(size);
	bytes.set(ONE_BY_ONE_PNG.subarray(0, Math.min(size, ONE_BY_ONE_PNG.length)));
	return bytes;
}

function trackZipLifecycle() {
	/** @type {Array<{ close: import('vitest').Mock, streams: Array<{ destroy: import('vitest').Mock }> }>} */
	const opened = [];
	const fromBuffer = yauzl.fromBuffer.bind(yauzl);
	vi.spyOn(yauzl, 'fromBuffer').mockImplementation((bytes, options, callback) => {
		fromBuffer(bytes, options, (error, zip) => {
			if (!zip) {
				callback(error, zip);
				return;
			}
			const close = vi.fn(zip.close.bind(zip));
			const streams = [];
			zip.close = close;
			const openReadStream = zip.openReadStream.bind(zip);
			zip.openReadStream = (entry, streamCallback) => {
				openReadStream(entry, (streamError, stream) => {
					if (stream) {
						const destroy = vi.spyOn(stream, 'destroy');
						streams.push({ destroy });
					}
					streamCallback(streamError, stream);
				});
			};
			opened.push({ close, streams });
			callback(error, zip);
		});
	});
	return opened;
}

afterEach(() => vi.restoreAllMocks());

describe('normalizeRiotId', () => {
	test('normalizes whitespace while preserving display casing', () => {
		expect(normalizeRiotId('  EarlGreyTeemo # sip  ')).toEqual({
			riotId: 'EarlGreyTeemo#sip',
			riotIdKey: 'earlgreyteemo#sip',
			gameName: 'EarlGreyTeemo',
			tagline: 'sip',
			imageKey: 'earlgreyteemo_sip'
		});
	});

	test.each(['NoTag', 'ab#tag', 'abcdefghijklmnopq#tag', 'Name#xy', 'Name#abcdef', 'Na-me#tag'])(
		'rejects invalid Riot ID %s',
		(riotId) => {
			expect(() => normalizeRiotId(riotId)).toThrow();
		}
	);
});

describe('inspectPlayerBundle', () => {
	test('parses quoted CRLF CSV rows and matches image files case-insensitively', async () => {
		const preview = await inspectPlayerBundle(
			bundle({
				'players.csv': csv(['"Nguyen, Van A","Display, A",EarlGreyTeemo#sip']),
				'player_images/earlgreyteemo_SIP.png': ONE_BY_ONE_PNG
			}),
			[]
		);

		expect(preview.errors).toEqual([]);
		expect(preview.rows).toEqual([
			expect.objectContaining({
				fullName: 'Nguyen, Van A',
				displayName: 'Display, A',
				riotId: 'EarlGreyTeemo#sip',
				action: 'create',
				image: expect.objectContaining({ path: 'player_images/earlgreyteemo_SIP.png' })
			})
		]);
	});

	test('reports duplicate Riot IDs and duplicate display names using lowercase keys', async () => {
		const preview = await inspectPlayerBundle(
			bundle({
				'players.csv': csv(['A,Same,PlayerOne#tag', 'B,same,playerone#TAG'])
			}),
			[]
		);

		expect(preview.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'duplicate_riot_id', key: 'playerone#tag' }),
				expect.objectContaining({ code: 'duplicate_display_name', key: 'same' })
			])
		);
		expect(preview.rows.map((row) => row.riotId)).toEqual(['PlayerOne#tag', 'playerone#TAG']);
	});

	test('reports optional split-field mismatch and missing required columns', async () => {
		const mismatch = await inspectPlayerBundle(
			bundle({
				'players.csv': csv(
					['A,Player,NameOne#tag,Other,tag'],
					'full_name,display_name,riot_id,riot_game_name,riot_tagline'
				)
			}),
			[]
		);
		expect(mismatch.errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'riot_id_mismatch' })])
		);

		const missing = await inspectPlayerBundle(
			bundle({ 'players.csv': csv(['A,Name'], 'full_name,display_name') }),
			[]
		);
		expect(missing.errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: 'missing_required_columns' })])
		);
	});

	test('detects missing required headers even when the CSV has no data rows', async () => {
		const preview = await inspectPlayerBundle(
			bundle({ 'players.csv': new TextEncoder().encode('full_name,display_name\r\n') }),
			[]
		);
		expect(preview.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'missing_required_columns', columns: ['riot_id'] })
			])
		);
	});

	test('marks matching existing Riot IDs for update', async () => {
		const preview = await inspectPlayerBundle(
			bundle({ 'players.csv': csv(['A,Name,PlayerOne#tag']) }),
			[{ id: 'player-1', riotIdKey: 'playerone#tag' }]
		);
		expect(preview.rows[0]).toMatchObject({ action: 'update', existingPlayerId: 'player-1' });
	});

	test('rejects unsafe ZIP paths', async () => {
		for (const name of ['/players.csv', '../players.csv']) {
			await expect(
				inspectPlayerBundle(bundle({ [name]: csv(['A,Name,PlayerOne#tag']) }), [])
			).rejects.toThrow('Unsafe ZIP entry path');
		}
	});

	test('rejects UNIX symlink ZIP entries', async () => {
		const bytes = setUnixSymlink(bundle({ 'players.csv': csv(['A,Name,PlayerOne#tag']) }));
		await expect(inspectPlayerBundle(bytes, [])).rejects.toThrow('ZIP symlinks are not supported');
	});

	test('rejects ZIPs with more than 500 entries', async () => {
		/** @type {Record<string, Uint8Array>} */
		const entries = { 'players.csv': csv(['A,Name,PlayerOne#tag']) };
		for (let index = 0; index < 500; index += 1)
			entries[`player_images/${index}.png`] = ONE_BY_ONE_PNG;
		await expect(inspectPlayerBundle(bundle(entries), [])).rejects.toThrow(
			'ZIP contains too many entries'
		);
	});

	test('rejects ZIPs whose declared expanded size exceeds 100 MiB', async () => {
		const bytes = setDeclaredExpandedSize(
			bundle({ 'players.csv': csv(['A,Name,PlayerOne#tag']) }),
			101 * 1024 * 1024
		);
		await expect(inspectPlayerBundle(bytes, [])).rejects.toThrow('ZIP expanded size is too large');
	});

	test('rejects without a buffered result and destroys the entry stream over 100 MiB', async () => {
		const opened = trackZipLifecycle();

		await expect(
			inspectPlayerBundle(
				zipWithDeclaredSize(
					{
						'players.csv': csv(['A,Name,PlayerOne#tag']),
						'player_images/playerone_tag.png': paddedPng(MAX_EXPANDED_BYTES + 1)
					},
					1
				),
				[]
			)
		).rejects.toThrow('ZIP expanded size is too large');

		const streamedZip = opened.find(({ streams }) => streams.length > 0);
		expect(streamedZip?.close).toHaveBeenCalledTimes(1);
		expect(streamedZip?.streams).toHaveLength(2);
		expect(streamedZip?.streams.at(-1)?.destroy).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'ZIP expanded size is too large' })
		);
	});

	test('rejects aggregate emitted bytes over 100 MiB and closes the active ZIP once', async () => {
		const opened = trackZipLifecycle();
		const csvBytes = csv(['A,Name,PlayerOne#tag']);
		const firstImageSize = 50 * 1024 * 1024;
		const secondImageSize = MAX_EXPANDED_BYTES - csvBytes.length - firstImageSize + 1;

		await expect(
			inspectPlayerBundle(
				zipWithDeclaredSize(
					{
						'players.csv': csvBytes,
						'player_images/first_tag.png': paddedPng(firstImageSize),
						'player_images/second_tag.png': paddedPng(secondImageSize)
					},
					1
				),
				[]
			)
		).rejects.toThrow('ZIP expanded size is too large');

		const streamedZip = opened.find(({ streams }) => streams.length > 0);
		expect(streamedZip?.close).toHaveBeenCalledTimes(1);
		expect(streamedZip?.streams.at(-1)?.destroy).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'ZIP expanded size is too large' })
		);
	});

	test('accepts content whose actual emitted total is exactly 100 MiB', async () => {
		const csvBytes = csv(['A,Name,PlayerOne#tag']);
		const preview = await inspectPlayerBundle(
			bundle({
				'players.csv': csvBytes,
				'player_images/playerone_tag.png': paddedPng(MAX_EXPANDED_BYTES - csvBytes.length)
			}),
			[]
		);

		expect(preview.rows).toHaveLength(1);
		expect(preview.rows[0]).toMatchObject({ riotId: 'PlayerOne#tag' });
	});

	test('reports unmatched, duplicate, and invalid image files without blocking valid CSV rows', async () => {
		const preview = await inspectPlayerBundle(
			bundle({
				'players.csv': csv(['A,Name,PlayerOne#tag']),
				'player_images/playerone_tag.png': ONE_BY_ONE_PNG,
				'player_images/PLAYERONE_TAG.PNG': ONE_BY_ONE_PNG,
				'player_images/extra_tag.png': ONE_BY_ONE_PNG,
				'player_images/bad.jpg': ONE_BY_ONE_PNG
			}),
			[]
		);

		expect(preview.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'duplicate_image', key: 'playerone_tag' }),
				expect.objectContaining({ code: 'unmatched_image', path: 'player_images/extra_tag.png' })
			])
		);
		expect(preview.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'image_type_mismatch', path: 'player_images/bad.jpg' })
			])
		);
	});

	test('keeps image validation errors when the CSV is malformed', async () => {
		const preview = await inspectPlayerBundle(
			bundle({
				'players.csv': new TextEncoder().encode('full_name,display_name,riot_id\r\nA,Name\r\n'),
				'player_images/playerone_tag.jpg': ONE_BY_ONE_PNG
			}),
			[]
		);

		expect(preview.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: 'invalid_csv' }),
				expect.objectContaining({
					code: 'image_type_mismatch',
					path: 'player_images/playerone_tag.jpg'
				})
			])
		);
	});
});
