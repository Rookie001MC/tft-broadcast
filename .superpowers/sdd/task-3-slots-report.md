# Task 3 — Private TFT Match Discovery Report

## Delivered scope

- Added private Riot configuration parsing from `$env/dynamic/private` with safe, browser-serializable availability only: `{ enabled, region, reason }`.
- Added a Twisted-only gateway. It resolves the roster player's account, lists only the ten newest match IDs, fetches details sequentially, and records individual detail failures as safe unavailable rows.
- Added an injectable same-process gateway factory at `Symbol.for('tft-match-v1.gateway-factory')`. The factory receives routing metadata only; it is consulted before creating either Twisted client and never receives the key.
- Added a bounded, process-local preview cache using cryptographically random opaque tokens, cloning on ingress/egress, a strict 15-minute TTL, lazy expiry, and a maximum of 32 batches.
- Added roster-bound discovery and Save-time cache resolution. Discovery uses only the supplied tournament/player IDs to obtain the server-owned Riot identity and active eligible catalog. It passes only non-excluded catalog champions into the Task 1 normalizer.
- Browser discovery data contains no key, raw payload, PUUID, or unrelated participants. Successful rows include only selected-player match metadata, champion slots, and `omittedUnitCount`.
- Added protected `POST /admin/graphics/tft-matches` with `no-store` and `nosniff` headers. It authorizes before reading the form and ignores submitted Riot identity, PUUID, match ID, and region fields.
- Updated Graphics page load with safe API availability and Save to resolve an optional token/match pair. It passes the authoritative canonical snapshot as `sourceSnapshot` to the existing save input and deletes the cache batch only after a successful save. A missing, expired, partial, or stale preview returns HTTP 409 with: `This API preview is no longer available. Fetch it again.`

## Tests added

- `config.test.js`: missing/invalid safe config, region normalization/routing groups, no key leakage.
- `gateway.test.js`: account/list/detail call shape, ten-ID cap, sequential details, safe detail failure, factory precedence and key exclusion.
- `cache.test.js`: exact 15-minute expiry, defensive cloning, explicit post-save deletion.
- `discovery.test.js`: roster-owned identity, selected-only safe DTO, active catalog mapping, expiry conflict, outsider rejection.
- Endpoint authorization/input sanitization/no-store response test.
- Existing admin action test for token resolution, canonical source handoff, and delete-after-save ordering.

## TDD evidence

- Initial tests were executed before implementation and failed because `config.js`, `gateway.js`, `cache.js`, `discovery.js`, and the endpoint did not exist.
- The focused suite was rerun after each implementation slice and passes with 81 tests.

## Verification

```text
pnpm exec vitest run --project server src/lib/server/tft-matches "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js" "src/routes/(admin)/admin/admin-actions.test.js"
7 files passed, 81 tests passed
```

```text
pnpm exec prettier --check <all Task 3 files>
pass
```

`pnpm check` still fails with 59 existing diagnostics in only these previously committed files:

- `src/lib/server/tft-matches/contract.test.js` (Task 1 test typing)
- `src/lib/server/winner-boards/publication-media.test.js`
- `src/lib/server/winner-boards/repository.test.js`

After the Task 3 JSDoc fixes, `pnpm check` reports no diagnostics in the files introduced or changed by this task.

## Deferred scope

No UI was added, and no durable TFT snapshot schema/repository was added. Those remain Task 4 work. `sourceSnapshot` is intentionally passed through the existing save boundary now for Task 4 to persist atomically.
