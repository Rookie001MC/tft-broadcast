import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const contractsDirectory = dirname(fileURLToPath(import.meta.url));
const examplesDirectory = join(contractsDirectory, 'examples');

/**
 * Reads a JSON document as UTF-8 and requires its document root to be an object.
 *
 * @param {string} filePath
 */
async function readJsonObject(filePath) {
	const value = JSON.parse(await readFile(filePath, 'utf8'));
	assert.ok(isObject(value), `${filePath} must contain a JSON object`);
	return value;
}

/** @param {unknown} value */
function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function jsonType(value) {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	if (Number.isInteger(value)) return 'integer';
	return typeof value;
}

/**
 * This is intentionally a small JSON Schema interpreter rather than a full validator.
 * It implements exactly the Draft 2020-12 keywords used by these contract schemas.
 *
 * @param {unknown} value
 * @param {Record<string, unknown>} schema
 * @param {Record<string, unknown>} rootSchema
 * @param {string} [valuePath]
 * @returns {string[]}
 */
function validateSchema(value, schema, rootSchema, valuePath = '$') {
	if (typeof schema.$ref === 'string') {
		const reference = resolveInternalReference(schema.$ref, rootSchema);
		return validateSchema(value, reference, rootSchema, valuePath);
	}

	const errors = [];
	if ('const' in schema && !deepEqual(value, schema.const)) {
		errors.push(`${valuePath} must equal ${JSON.stringify(schema.const)}`);
	}

	if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(value, option))) {
		errors.push(`${valuePath} must be one of ${JSON.stringify(schema.enum)}`);
	}

	if (schema.type !== undefined) {
		const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (!expectedTypes.some((expectedType) => matchesType(value, expectedType))) {
			errors.push(`${valuePath} must have type ${expectedTypes.join(' or ')}; got ${jsonType(value)}`);
			return errors;
		}
	}

	if (typeof value === 'string') {
		const length = Array.from(value).length;
		if (typeof schema.minLength === 'number' && length < schema.minLength) {
			errors.push(`${valuePath} must contain at least ${schema.minLength} characters`);
		}
		if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
			errors.push(`${valuePath} must contain at most ${schema.maxLength} characters`);
		}
		if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
			errors.push(`${valuePath} must match ${schema.pattern}`);
		}
	}

	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) {
			errors.push(`${valuePath} must be at least ${schema.minimum}`);
		}
		if (typeof schema.maximum === 'number' && value > schema.maximum) {
			errors.push(`${valuePath} must be at most ${schema.maximum}`);
		}
	}

	if (isObject(value)) {
		const required = Array.isArray(schema.required) ? schema.required : [];
		for (const propertyName of required) {
			if (!(propertyName in value)) errors.push(`${valuePath}.${propertyName} is required`);
		}

		const properties = isObject(schema.properties) ? schema.properties : {};
		for (const [propertyName, propertyValue] of Object.entries(value)) {
			const propertySchema = properties[propertyName];
			if (propertySchema === undefined) {
				if (schema.additionalProperties === false) {
					errors.push(`${valuePath}.${propertyName} is not allowed`);
				}
				continue;
			}

			assert.ok(isObject(propertySchema), `${valuePath}.${propertyName} has an invalid schema`);
			errors.push(...validateSchema(propertyValue, propertySchema, rootSchema, `${valuePath}.${propertyName}`));
		}
	}

	return errors;
}

/**
 * @param {unknown} value
 * @param {unknown} expectedType
 */
function matchesType(value, expectedType) {
	return (
		(expectedType === 'object' && isObject(value)) ||
		(expectedType === 'array' && Array.isArray(value)) ||
		(expectedType === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
		(expectedType === 'number' && typeof value === 'number') ||
		(expectedType === 'string' && typeof value === 'string') ||
		(expectedType === 'boolean' && typeof value === 'boolean') ||
		(expectedType === 'null' && value === null)
	);
}

/**
 * @param {string} reference
 * @param {Record<string, unknown>} rootSchema
 */
function resolveInternalReference(reference, rootSchema) {
	assert.ok(reference.startsWith('#/'), `Only internal references are supported: ${reference}`);
	let target = /** @type {unknown} */ (rootSchema);
	for (const segment of reference.slice(2).split('/')) {
		assert.ok(isObject(target), `Reference does not resolve to an object: ${reference}`);
		target = target[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
	}
	assert.ok(isObject(target), `Reference does not resolve to a schema object: ${reference}`);
	return target;
}

/** @param {unknown} left @param {unknown} right */
function deepEqual(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {string} payloadJson */
function sha256Utf8(payloadJson) {
	return createHash('sha256').update(payloadJson, 'utf8').digest('hex');
}

/** @param {Record<string, unknown>} capture */
function captureIntegrityError(capture) {
	const { payloadJson, payloadSha256 } = capture;
	if (typeof payloadJson !== 'string') return 'payloadJson must be a string';
	if (typeof payloadSha256 !== 'string') return 'payloadSha256 must be a string';

	let payload;
	try {
		payload = JSON.parse(payloadJson);
	} catch {
		return 'payloadJson must be valid JSON';
	}
	if (!isObject(payload)) return 'payloadJson must be a JSON object';
	if (sha256Utf8(payloadJson) !== payloadSha256) return 'payloadSha256 must match the UTF-8 payloadJson bytes';
	return undefined;
}

/**
 * @param {Record<string, unknown>} acknowledgment
 * @param {Record<string, unknown>} capture
 */
function acknowledgmentIntegrityError(acknowledgment, capture) {
	return acknowledgment.captureId === capture.captureId
		? undefined
		: 'acknowledgment captureId must match the capture request captureId';
}

/** @param {string} directory */
async function listJsonFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(directory, entry.name);
			if (entry.isDirectory()) return listJsonFiles(entryPath);
			return entry.isFile() && entry.name.endsWith('.json') ? [entryPath] : [];
		})
	);
	return files.flat().sort();
}

/** @param {string} examplePath */
function schemaNameForExample(examplePath) {
	const pathFromExamples = relative(examplesDirectory, examplePath).replaceAll('\\', '/');
	if (pathFromExamples === 'capture-request.json' || pathFromExamples === 'semantic-rejections/capture-bad-hash.json') {
		return 'capture';
	}
	if (pathFromExamples === 'handshake-success.json') return 'handshake';
	if (pathFromExamples.startsWith('errors/')) return 'error';
	if (pathFromExamples.startsWith('acknowledgment-') || pathFromExamples.startsWith('semantic-rejections/acknowledgment-')) {
		return 'acknowledgment';
	}
	throw new Error(`No contract schema is mapped for example ${pathFromExamples}`);
}

const schemas = Object.fromEntries(
	await Promise.all(
		['capture', 'handshake', 'acknowledgment', 'error'].map(async (name) => [
			name,
			await readJsonObject(join(contractsDirectory, `${name}.schema.json`))
		])
	)
);
const examples = Object.fromEntries(
	await Promise.all(
		(await listJsonFiles(examplesDirectory)).map(async (examplePath) => [
			relative(examplesDirectory, examplePath).replaceAll('\\', '/'),
			await readJsonObject(examplePath)
		])
	)
);

for (const [exampleName, example] of Object.entries(examples)) {
	const schemaName = schemaNameForExample(join(examplesDirectory, exampleName));
	const errors = validateSchema(example, schemas[schemaName], schemas[schemaName]);
	assert.deepEqual(errors, [], `${exampleName} does not satisfy ${schemaName}.schema.json:\n${errors.join('\n')}`);
}

const capture = examples['capture-request.json'];
assert.equal(captureIntegrityError(capture), undefined, 'capture-request.json must have valid object JSON and a matching UTF-8 SHA-256');

for (const acknowledgmentName of ['acknowledgment-stored.json', 'acknowledgment-duplicate.json']) {
	assert.equal(
		acknowledgmentIntegrityError(examples[acknowledgmentName], capture),
		undefined,
		`${acknowledgmentName} must acknowledge the capture request ID`
	);
}

const badHash = examples['semantic-rejections/capture-bad-hash.json'];
assert.deepEqual(
	validateSchema(badHash, schemas.capture, schemas.capture),
	[],
	'capture-bad-hash.json should pass structural schema validation before its semantic rejection'
);
assert.equal(
	captureIntegrityError(badHash),
	'payloadSha256 must match the UTF-8 payloadJson bytes',
	'capture-bad-hash.json must be rejected for its payload hash'
);

const mismatchedAcknowledgment = examples['semantic-rejections/acknowledgment-mismatched-id.json'];
assert.deepEqual(
	validateSchema(mismatchedAcknowledgment, schemas.acknowledgment, schemas.acknowledgment),
	[],
	'acknowledgment-mismatched-id.json should pass structural schema validation before its semantic rejection'
);
assert.equal(
	acknowledgmentIntegrityError(mismatchedAcknowledgment, capture),
	'acknowledgment captureId must match the capture request captureId',
	'acknowledgment-mismatched-id.json must be rejected for its capture ID'
);

console.log(
	`Validated ${Object.keys(schemas).length} schemas and ${Object.keys(examples).length} examples, including payload integrity and acknowledgment correlation rejections.`
);
