# TFT Player Relay v1 receiver contract

> **Status: PROPOSED and unreviewed.** This is a client/receiver integration
> proposal, not a final protocol and not evidence that a production receiver
> implements these routes. Receiver owners must review and explicitly agree to
> it (or version any changes) before a desktop client sends production data.

The relay sends a durable observation of the local TFT end-of-game (EOG) JSON.
It does **not** decide whether that observation is a valid tournament result or
publish graphics. A successful delivery means only that the receiver has
durably accepted an observation.

Schemas and examples in this directory are normative for JSON shape. This
README defines the HTTP, semantic-validation, and durability rules that JSON
Schema cannot express.

## Transport

All routes are relative to the configured receiver origin. The initial desktop
default is `http://127.0.0.1:5173`; `127.0.0.1` means the Player PC, not a
separate venue server. A LAN/VLAN deployment must configure that server's
reachable address and listening port. HTTPS, when selected, uses normal TLS
certificate validation.

The client must not follow redirects and must treat a redirect response as an
endpoint/protocol error. It sends UTF-8 JSON, bounds response bodies to 64 KiB,
and never logs bearer tokens or raw result payloads.

### `GET /api/player-relay/v1/handshake`

Use this to validate a configured destination before submitting observations.

Required request headers:

| Header | Exact value / rule |
| --- | --- |
| `Authorization` | `Bearer <device-token>` |
| `Accept` | `application/json` |

On `200 OK`, return an `application/json` body conforming to
[`handshake.schema.json`](./handshake.schema.json). A successful web page,
HTML body, redirect, or a JSON body with the wrong protocol version is not a
successful handshake.

`serverId` and `eventId` are non-empty strings of at most 128 characters. They
identify the receiver-owned destination scope; they are not proof that any
later capture belongs to a current match. `maxPayloadBytes` is an integer from
1 through 33,554,432. The sender uses the lower of this value and its own
protocol maximum for the outer encoded request body.

### `POST /api/player-relay/v1/captures`

Submit one immutable capture envelope, conforming to
[`capture.schema.json`](./capture.schema.json), per request.

Required request headers:

| Header | Exact value / rule |
| --- | --- |
| `Authorization` | `Bearer <device-token>` |
| `Content-Type` | `application/json; charset=utf-8` |
| `Accept` | `application/json` |
| `Idempotency-Key` | Exactly the envelope's lowercase `captureId` string |

The receiver must reject a missing or unequal `Idempotency-Key` as an invalid
envelope. The sender preserves the entire original envelope, including the
capture ID and this header, for every retry.

## Capture envelope

`capture.schema.json` permits no unknown top-level or nested object fields.
The table below adds the required semantic meaning and byte limits.

| Field | JSON type and limit | Meaning |
| --- | --- | --- |
| `protocolVersion` | integer; exactly `1` | Contract version. |
| `captureId` | lowercase UUID string | Random, durable identity for this capture; never changes on retry. |
| `installationId` | lowercase UUID string | Random persistent identity of the desktop installation, not a hardware fingerprint. |
| `sequence` | decimal string matching `^[1-9][0-9]{0,18}$` | Monotonically increasing, installation-local sequence. It is not a global result order. |
| `capturedAt` | UTC timestamp string | When this local observation was read, not the game-end time. |
| `appVersion` | non-empty string, max 64 characters | Packaged relay version. |
| `observationKind` | `"event"` or `"recovery"` | Whether an LCU event or a startup/reconnect/resume read found it. |
| `sourcePlatform` | string (1–64 characters) or `null` | LCU-derived platform only; `null` means unavailable/unknown and must not be guessed. |
| `gameId` | non-empty string, max 128 characters | Original game identity represented as text, without numeric coercion. |
| `localPlayer` | object | All three members are required: `puuid`, `gameName`, and `tagLine`; each is a string up to 256/100/100 characters respectively, or `null`. |
| `context` | exact `{ serverId, eventId }` object or `null` | Receiver scope captured after a verified handshake. Both members are non-empty strings up to 128 characters. `null` means unverified/unknown context. |
| `payloadSha256` | 64 lowercase hexadecimal characters | SHA-256 of the UTF-8 bytes of `payloadJson`, as defined below. |
| `payloadJson` | string | Exact original EOG JSON text. It must contain at least two characters and encode to at most 4,194,304 UTF-8 bytes. |

All timestamps use the schema's strict UTC representation:
`YYYY-MM-DDTHH:MM:SS[.1-to-7-digits]Z`. `capturedAt` is assigned by the relay
when it observes data. `receivedAt`, in an acknowledgment, is assigned by the
receiver after durable acceptance; neither field asserts when the game ended.
Both sides must also parse the value as a real UTC calendar instant; matching
the schema's lexical pattern alone is insufficient.

The receiver additionally limits the complete UTF-8-encoded HTTP request body
to its handshake `maxPayloadBytes`, never above 33,554,432 bytes (32 MiB).
It must enforce both the decoded `payloadJson` 4 MiB limit and this escaped,
outer-envelope size limit. A JSON Schema string-length check alone is not a
UTF-8 byte-limit check.

### Hash calculation

Treat `payloadJson` as opaque text. Compute:

```text
payloadSha256 = lowercase-hex(SHA-256(UTF-8 bytes of payloadJson))
```

Do not parse, normalize, reformat, or reserialize the inner JSON before
hashing. Whitespace, key ordering, escape spelling, and line endings are part
of the byte sequence. The receiver must recompute the hash from the received
string and reject a mismatch even when the envelope otherwise validates. The
valid example's expected hash is
`1cf3cbd9d426040f4d91547b5804a23985255b036f3f60b36a6fb25fa021df96`.

## Acknowledgments and failures

Only these success responses are durable acknowledgments:

| HTTP status | Body | Sender action |
| --- | --- | --- |
| `201 Created` | `acknowledgment.schema.json`, matching capture ID, `status: "stored"` | Mark that immutable capture acknowledged. |
| `200 OK` | `acknowledgment.schema.json`, matching capture ID, `status: "duplicate"` | Mark it acknowledged; the receiver already durably holds the same capture. |

`receivedAt` is a strict UTC timestamp and records the receiver's durable
acceptance/duplicate receipt time. `200` with `stored`, `201` with `duplicate`,
an ID mismatch, a malformed body, an HTML body, `202 Accepted`, or any other
2xx status is **not** an acknowledgment. A lost acknowledgment is handled by
replaying the same immutable request.

Non-success responses use `application/json` and conform to
[`error.schema.json`](./error.schema.json). They must not disclose tokens,
LCU credentials, or raw player payloads.

| HTTP status | Error code | Retryability and required receiver behavior |
| --- | --- | --- |
| `400 Bad Request` or `422 Unprocessable Content` | `invalid_envelope` | `retryable: false`; do not persist an invalid payload as accepted. |
| `401 Unauthorized` or `403 Forbidden` | `expired_token` or `token_revoked` | `retryable: false`; pause delivery until the token is corrected. |
| `409 Conflict` | `id_content_conflict` | `retryable: false`; same idempotency identity was submitted with different content. |
| `413 Content Too Large` | `payload_too_large` | `retryable: false`; report the safe limit error. |
| `426 Upgrade Required` (or the agreed incompatible-version response) | `unsupported_protocol` | `retryable: false`; do not silently downgrade. |
| `429 Too Many Requests` | `rate_limited` | `retryable: true`; include a bounded retry delay. |
| `500`, `502`, `503`, or `504` | `temporary_unavailable` | `retryable: true`; include a bounded retry delay when known. |

For a retryable response, `retryAfterSeconds`, when present, is an integer from
1 to 300; the receiver should also send a delta-seconds `Retry-After` header
with the same bounded value. The sender honors a value no greater than 300
seconds and otherwise applies its bounded exponential backoff. Network errors,
timeouts, and `408` are retryable without an error body. `404`, redirects,
malformed errors, and unexpected response shapes are endpoint/protocol errors,
not acknowledgments and not tight-loop retry candidates.

The supplied `capture-bad-hash.json` and `acknowledgment-mismatched-id.json`
are semantic-rejection vectors: each can pass its structural schema but must be
rejected by the receiver or sender respectively.

## Device-token boundary

The receiver owns device-token issuance, expiration, rotation, and revocation.
A device token is a narrow ingestion credential mapped to an allowed receiver
server/event scope. The desktop relay stores it only in user-bound protected
storage and sends it only in the `Authorization` header. Tokens must be
revocable independently of an installation's already stored observations.

Web operator accounts and roles are a separate security domain. A web session,
admin role, or graphics-publishing permission must not imply permission to
ingest captures, and a device token must not create a web session or gain web
operator privileges. The receiver should audit issuance/revocation with safe
token identifiers rather than recording token values.

## Receiver implementation checklist

Before calling this proposal implemented, the receiver owner must verify all
of the following:

- Authenticate and authorize the device token before accepting a capture, and
  bind it to receiver-owned server/event scope.
- In one durable transaction, validate the envelope, UTF-8 hash and both size
  limits; apply deduplication by receiver/device scope plus `captureId`; store
  the immutable envelope or an equivalent durable receipt; and commit before
  returning `201` or `200`.
- On replay of identical content and identity, return the matching duplicate
  acknowledgment. On the same idempotency identity with different content,
  retain the original record and return `409 id_content_conflict`; never
  overwrite it.
- Treat captures from different Player PCs/installations as separate
  observations. Do not deduplicate by `gameId` alone. Reconcile overlapping,
  changed, or platform-ambiguous observations receiver-side, without deleting
  either source observation or auto-publishing graphics.
- Keep `recovery` observations and `context: null` captures safe: do not infer
  that they belong to the currently active event/match. Queue them for
  receiver-owned reconciliation, review, or a documented retention policy.
- Treat stale timestamps and unknown source platform/player fields as data
  quality signals, not grounds to substitute a current player or event. Never
  rewrite a capture's original identity/context.
- Make failure bodies safe and bounded, rate-limit without losing the ability
  to replay, and keep all response data free of secrets and raw EOG content.
- Exercise commit-then-connection-drop, duplicate replay, conflicting
  idempotency IDs, two-PC overlapping observations, stale recovery data, and
  revoked/expired-token cases against durable storage.

## Validation

From this directory, run the dependency-free validator. It applies the Draft
2020-12 keywords used by these schemas, verifies the UTF-8 hash vector, and
checks the semantic-rejection vectors:

```powershell
node validate-examples.mjs
```

Then run the receiver's semantic checks with these required outcomes:

- `examples/semantic-rejections/capture-bad-hash.json` structurally validates
  but receives `400` or `422 invalid_envelope` because its recomputed hash is
  different.
- An acknowledgment using
  `examples/semantic-rejections/acknowledgment-mismatched-id.json` is rejected
  by the client because it does not equal the request capture ID.
- Replaying `capture-request.json` unchanged produces one `201 stored` and
  later `200 duplicate`; changing its body while retaining the same
  `captureId`/`Idempotency-Key` produces `409 id_content_conflict`.
