# TFT-MATCH-V1 Winner Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, Twisted-only workflow that loads one roster player's ten newest TFT matches, previews a champion-only board, populates the existing editable Winner composer without writing during browsing, and atomically persists the exact eight-player Riot snapshot only through the original Save action.

**Architecture:** Keep Riot access, response normalization, transient preview storage, and durable snapshot persistence in separate server modules. The browser receives safe projections behind an opaque 15-minute process-local token; it never supplies a Riot ID, PUUID, arbitrary match ID, or API key. The existing Winner repository remains the transaction and live-publication boundary, with an optional validated snapshot source inserted in the same transaction as the editable board.

**Tech Stack:** Svelte 5 runes, SvelteKit form actions and request handlers, JavaScript with JSDoc, Zod 4, Twisted 1.82, Drizzle ORM/SQLite, Vitest server and browser projects, Playwright, Skeleton/Tailwind styling.

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-11-tft-match-v1-winner-import-design.md` as authoritative.
- Use `RiotApi.Account.getByRiotId`, `TftApi.Match.list`, and `TftApi.Match.get`; do not call Riot with application-owned `fetch`.
- Read `RIOT_API_KEY` and `RIOT_REGION` only from `$env/dynamic/private`. Never return, log, cache, or interpolate the key into an error.
- Accept one configured platform region. Derive both routing groups with Twisted's region helpers.
- Request `count: 10` exactly. Do not pass `startTime`, `endTime`, or any backfill parameter.
- Fetch detail records sequentially. One failed detail produces one unavailable row and does not discard successful rows.
- Ignore augments and `win` everywhere in the Riot contract. Placement is authoritative.
- Browsing, closing the dialog, selecting a match, and **Use this board** must issue no SQLite writes.
- Keep the existing title and augment selections when importing. Replace only winner, champion order, champion star levels, and hidden preview source fields.
- Keep the original **Save board** action as the only persistence boundary. Keep existing Save-while-Live publication advancement unchanged.
- Cache entries live for 15 minutes, cap at 32 batches, use cryptographically random opaque tokens, and disappear only after successful API-backed Save or normal expiry/eviction.
- Persist the normalized eight-player champion snapshot exactly as reviewed, even when the operator edits the resulting Winner composer before Save.
- Preserve the user-supplied `examples/tft-match-v1.example.json` byte-for-byte and add it as a regression fixture.
- Run the Svelte MCP autofixer on every created or modified `.svelte` file until it returns no issues or suggestions.
- Preserve unrelated worktree changes. Stage only the files named in each task.

## File and Responsibility Map

### New shared and server modules

- `src/lib/tft-match.js`: browser-safe JSDoc DTOs for availability, match rows, discovery responses, and composer handoff.
- `src/lib/server/tft-matches/contract.js`: permissive Riot subset schema, strict canonical snapshot schema, normalization, catalog mapping, and preview projection.
- `src/lib/server/tft-matches/config.js`: private environment parsing, platform-region validation, routing-group derivation, and safe availability projection.
- `src/lib/server/tft-matches/gateway.js`: injected Twisted client boundary, sequential ten-match retrieval, safe Riot error translation, and the same-process test gateway factory seam.
- `src/lib/server/tft-matches/preview-cache.js`: bounded module-level cache and token lifecycle.
- `src/lib/server/tft-matches/service.js`: roster/catalog authorization, discovery orchestration, safe match rows, and Save-time cache binding validation.
- `src/lib/server/tft-matches/snapshot-repository.js`: canonical revalidation, in-transaction binding checks, and append-only snapshot insertion.
- `src/lib/server/db/schema/tft-matches.js`: `tft_match_snapshots` table.
- `src/routes/(admin)/admin/graphics/tft-matches/+server.js`: authenticated POST endpoint accepting only local tournament/player IDs.
- `src/lib/components/admin/TftMatchImportDialog.svelte`: full-screen four-stage modal workflow.
- `tests/fixtures/fake-tft-match-gateway.js`: deterministic eight-player Playwright gateway.

### New focused tests

- `src/lib/server/tft-matches/contract.test.js`
- `src/lib/server/tft-matches/config.test.js`
- `src/lib/server/tft-matches/gateway.test.js`
- `src/lib/server/tft-matches/preview-cache.test.js`
- `src/lib/server/tft-matches/service.test.js`
- `src/lib/server/tft-matches/snapshot-repository.test.js`
- `src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js`
- `src/lib/components/admin/TftMatchImportDialog.svelte.test.js`

### Existing files to modify

- `src/lib/server/db/schema/index.js`
- `src/lib/server/db/schema/winner-boards.js`
- `src/lib/server/db/schema/schema.test.js`
- `src/lib/server/winner-boards/repository.js`
- `src/lib/server/winner-boards/repository.test.js`
- `src/routes/(admin)/admin/graphics/+page.server.js`
- `src/routes/(admin)/admin/graphics/+page.svelte`
- `src/routes/(admin)/admin/admin-actions.test.js`
- `src/lib/components/admin/WinnerBoardComposer.svelte`
- `src/lib/components/admin/admin-components.svelte.test.js`
- `.prettierignore`
- `scripts/e2e-server.js`
- `scripts/playwright-global-setup.js`
- `playwright.config.js`
- `tests/manual-winner-graphics.test.js`
- `.env.example`
- `README.md`
- `docs/TODO.md`

### Generated migration files

- `drizzle/0003_tft_match_snapshots.sql`
- `drizzle/meta/0003_snapshot.json`
- `drizzle/meta/_journal.json`

## Contracts to Keep Consistent

### Browser-safe discovery DTO

`src/lib/tft-match.js` must define these JSDoc unions so the route, dialog, composer, and tests use one spelling:

```js
/**
 * @typedef {{ enabled: boolean, region: string | null, reason: string | null }} TftMatchApiAvailability
 *
 * @typedef {{
 *   catalogChampionId: string,
 *   externalId: string,
 *   displayName: string,
 *   iconPath: string | null,
 *   starLevel: number,
 *   displayOrder: number
 * }} TftMatchPreviewChampion
 *
 * @typedef {{
 *   available: true,
 *   matchId: string,
 *   completedAt: string,
 *   placement: number,
 *   gameType: string,
 *   setNumber: number,
 *   setCoreName: string,
 *   champions: TftMatchPreviewChampion[]
 * } | {
 *   available: false,
 *   matchId: string,
 *   reason: string
 * }} TftMatchPreviewRow
 *
 * @typedef {{
 *   token: string,
 *   selectedPlayer: { id: string, displayName: string, riotId: string },
 *   matches: TftMatchPreviewRow[]
 * }} TftMatchDiscoveryResponse
 *
 * @typedef {{
 *   previewToken: string,
 *   matchId: string,
 *   winnerPlayerId: string,
 *   champions: TftMatchPreviewChampion[]
 * }} TftMatchComposerDraft
 */

export {};
```

### Canonical persisted snapshot

`contract.js` must export a strict parser for this complete server-only shape. Participant Riot IDs are nullable because Riot supplies those fields only when available; partial or blank Riot ID pairs normalize to null rather than blocking an otherwise valid participant.

```js
/**
 * @typedef {{
 *   contractVersion: 1,
 *   source: {
 *     provider: 'riot',
 *     region: string,
 *     matchId: string,
 *     dataVersion: string,
 *     fetchedAt: string
 *   },
 *   match: {
 *     completedAt: string,
 *     durationSeconds: number,
 *     gameVersion: string,
 *     queueId: number,
 *     gameType: string,
 *     setNumber: number,
 *     setCoreName: string
 *   },
 *   participants: Array<{
 *     puuid: string,
 *     riotId: { gameName: string, tagline: string } | null,
 *     placement: number,
 *     level: number,
 *     champions: Array<{
 *       externalId: string,
 *       catalogChampionId: string,
 *       displayName: string,
 *       iconPath: string | null,
 *       starLevel: number,
 *       displayOrder: number
 *     }>
 *   }>
 * }} CanonicalTftMatchSnapshot
 */
```

Both timestamps are valid ISO-8601 instants. `participants` contains exactly eight entries sorted by placement, and every champion array preserves Riot unit order after explicitly excluded helpers are removed. No augment, trait, item, companion, mission, or `win` field belongs in this value.

### Gateway interface

The production and fake gateway must implement exactly one high-level method:

```js
/**
 * @typedef {{
 *   puuid: string,
 *   matches: Array<
 *     | { matchId: string, payload: unknown, error: null }
 *     | { matchId: string, payload: null, error: string }
 *   >
 * }} TftGatewayHistory
 *
 * @typedef {{
 *   fetchRecentMatches(input: { gameName: string, tagline: string }): Promise<TftGatewayHistory>
 * }} TftMatchGateway
 */
```

The real implementation must call account lookup once, list once with `{ count: 10 }`, then `Match.get` sequentially for `matchIds.slice(0, 10)`.

### Cache-to-Save source

`resolveTftMatchPreviewForSave` returns this server-only value; the browser never constructs it:

```js
{
	snapshot,
	tournamentId,
	selectedPlayerId,
	selectedPuuid,
	activeCatalogSnapshotId,
	riotGameName,
	riotTagline,
	region
}
```

`saveWinnerBoardState` gains one optional property:

```js
{
	tournamentId,
	winnerPlayerId,
	title,
	champions,
	augmentIds,
	sourceSnapshot // omitted for an ordinary manual Save
}
```

Omitting `sourceSnapshot` must store `NULL` in `winner_board_state.source_tft_match_snapshot_id` and must not insert a snapshot.

---

### Task 1: Lock the real response and canonical champion-only contract

**Files:**

- Create: `src/lib/tft-match.js`
- Create: `src/lib/server/tft-matches/contract.js`
- Create: `src/lib/server/tft-matches/contract.test.js`
- Modify: `.prettierignore`
- Use unchanged and stage: `examples/tft-match-v1.example.json`
- Reference only: `src/lib/openapi/riot-api/openapi-3.0.0.json`

**Interfaces:**

- `normalizeTftMatch({ payload, requestedMatchId, selectedPuuid, region, catalogChampions, fetchedAt })`
- `parseCanonicalTftMatchSnapshot(value)`
- `previewRowFromSnapshot(snapshot, selectedPuuid)`
- `TftMatchContractError` with `operatorMessage` and sorted `unresolvedExternalIds`
- `CANONICAL_TFT_MATCH_CONTRACT_VERSION = 1`

- [ ] **Step 1: Write failing real-fixture and rejection tests**

Load the example with `readFile(new URL('../../../../examples/tft-match-v1.example.json', import.meta.url), 'utf8')`. Build catalog rows from every unique `units[].character_id`; mark `TFT17_IvernMinion` and `TFT17_Summon` as `isExcluded: true`, and mark the remaining rows active.

Cover all of these assertions:

- absent `augments` and unknown extra fields are accepted;
- otherwise-identical payloads with only `queueId` and only `queue_id` are each accepted and normalize to the same canonical `queueId`;
- absent `endOfGameResult` is accepted, while a present value must equal `GameComplete`;
- missing, blank, or partial optional participant Riot-ID fields are accepted and normalize the participant's canonical `riotId` to `null`;
- the canonical value has `contractVersion: 1`, no augment property, exactly eight participants, and placements `[1,2,3,4,5,6,7,8]`;
- selecting the placement-four participant works even when several participants have `win: true`;
- every retained `character_id` maps by exact `externalId`, excluded helpers disappear, original unit order becomes contiguous `displayOrder`, and `tier` becomes `starLevel`;
- `metadata.match_id` must equal `requestedMatchId`;
- duplicate or empty PUUIDs, incomplete placement sets, duplicate retained champions, tiers outside 1–3, missing selected PUUID, malformed data version/timestamp/duration/version/queue/set/participant-level values, and unknown non-excluded champions throw `TftMatchContractError`;
- unresolved champion messages contain sorted external IDs and no raw response dump;
- an empty unit `character_id` throws, while a selected participant whose every well-formed unit is explicitly excluded remains contract-valid with an empty canonical champion array;
- `parseCanonicalTftMatchSnapshot` rejects a mutated canonical payload before persistence.

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run:

```powershell
pnpm exec vitest run --project server src/lib/server/tft-matches/contract.test.js
```

Expected: FAIL because `contract.js` and its exports do not exist.

- [ ] **Step 3: Implement the permissive raw schema and strict canonical schema**

Use Zod objects with `.passthrough()` at the raw response, info, participant, and unit levels. Consume only:

- `metadata.data_version`, `metadata.match_id`;
- `info.endOfGameResult`, `game_datetime`, `game_length`, `game_version`, `queueId` or `queue_id`, `tft_game_type`, `tft_set_core_name`, `tft_set_number`, `participants`;
- participant `puuid`, optional Riot ID pair, `placement`, `level`, and `units`;
- unit `character_id` and `tier`.

Normalize `queueId ?? queue_id` into one integer. Convert the millisecond `game_datetime` to an ISO `completedAt`; keep `fetchedAt` as an ISO string. Sort participants by placement. Never consult `win`.

The canonical schema must exactly represent the version-1 shape in the approved design and reject unknown canonical keys with `.strict()`. Freeze or clone the returned value so projections cannot mutate the cache's authoritative object.

- [ ] **Step 4: Implement exact catalog mapping**

Create one `Map` by `externalId`. For every unit:

- throw if `character_id` is empty or `tier` is not an integer from 1 through 3;
- omit the unit when the matching catalog row exists and `isExcluded === true`;
- collect the external ID when no catalog row exists;
- retain the catalog ID, external ID, display name, icon path, star level, and post-filter order for active rows.

After mapping one participant, reject duplicate retained catalog champion IDs. After mapping the match, reject any unresolved IDs together. Do not add an extra minimum-champion eligibility rule beyond the approved contract.

- [ ] **Step 5: Return only the safe browser projection**

`previewRowFromSnapshot` must find the participant by PUUID and return match metadata plus that participant's champion array. It must not include the other seven PUUIDs, raw Riot payload, API configuration, or augments.

- [ ] **Step 6: Run focused verification**

Add `/examples/tft-match-v1.example.json` to `.prettierignore`. The supplied response is an external regression artifact and must not be rewritten merely to satisfy repository formatting; other future examples remain subject to normal formatting.

Run:

```powershell
pnpm exec vitest run --project server src/lib/server/tft-matches/contract.test.js
pnpm exec prettier --check src/lib/tft-match.js src/lib/server/tft-matches/contract.js src/lib/server/tft-matches/contract.test.js
```

Expected: both commands PASS.

- [ ] **Step 7: Commit the contract and unchanged fixture**

```powershell
git add src/lib/tft-match.js src/lib/server/tft-matches/contract.js src/lib/server/tft-matches/contract.test.js examples/tft-match-v1.example.json .prettierignore
git commit -m "feat: normalize TFT match snapshots"
```

---

### Task 2: Add private configuration and the Twisted-only gateway

**Files:**

- Create: `src/lib/server/tft-matches/config.js`
- Create: `src/lib/server/tft-matches/config.test.js`
- Create: `src/lib/server/tft-matches/gateway.js`
- Create: `src/lib/server/tft-matches/gateway.test.js`

**Interfaces:**

- `requireTftMatchApiConfig(environment)` → `{ apiKey, region, accountRegionGroup, matchRegionGroup }`
- `getTftMatchApiAvailability(environment)` → browser-safe `TftMatchApiAvailability`
- `createTftMatchGateway({ riotApi, tftApi, accountRegionGroup, matchRegionGroup })`
- `createRuntimeTftMatchGateway(config)`
- `TftMatchGatewayError` with `category`, `status`, and `operatorMessage`
- Same-process injection symbol: `Symbol.for('tft-match-v1.gateway-factory')`

- [ ] **Step 1: Write failing configuration tests**

Assert that:

- a missing key disables only the API feature with `region: null` and a safe key-required reason;
- a missing or unsupported region produces a safe region-required reason;
- lowercase `vn2` normalizes to `VN2`;
- `Constants.regionToRegionGroup('VN2')` and `Constants.regionToRegionGroupForAccountAPI('VN2')` supply the returned groups;
- a platform enum value rejected by either routing helper is unavailable;
- availability JSON never contains the key.

- [ ] **Step 2: Write failing gateway tests with injected Twisted doubles**

Record every call and assert this exact sequence:

```text
Account.getByRiotId(gameName, tagline, accountRegionGroup)
Match.list(puuid, matchRegionGroup, { count: 10 })
Match.get(firstMatchId, matchRegionGroup)
Match.get(secondMatchId, matchRegionGroup)
```

Return more than ten IDs from the double and assert only the first ten are read. Use deferred detail promises and an in-flight counter to prove maximum detail concurrency is one. Assert no query object contains `startTime` or `endTime`, and assert `listWithDetails` is never used.

Make one detail call reject and prove later IDs are still fetched with the failed ID represented as `{ payload: null, error: safeMessage }`.

Cover safe translation for 401/403, 404 account lookup, 429, 5xx/503, an explicit timeout/`AbortError`, and a generic transport error. Timeout and transport failures may share the safe temporary-unavailability message. The safe message must not contain the fake key, request URL, response body, or stack.

Set `globalThis[Symbol.for('tft-match-v1.gateway-factory')]` to a test factory and assert `createRuntimeTftMatchGateway` returns that gateway without constructing `RiotApi` or `TftApi` and without passing `apiKey` to the factory. Restore the global symbol after the test.

- [ ] **Step 3: Run the tests and confirm missing exports**

```powershell
pnpm exec vitest run --project server src/lib/server/tft-matches/config.test.js src/lib/server/tft-matches/gateway.test.js
```

Expected: FAIL because the configuration and gateway modules do not exist.

- [ ] **Step 4: Implement configuration parsing**

Trim the key, uppercase the platform region, validate against `Object.values(Constants.Regions)`, then invoke both region helpers inside the same guarded function. Throw a typed configuration error with an operator-safe message. `getTftMatchApiAvailability` catches only that typed error and returns `{ enabled: false, region: null, reason }`; when valid, return `{ enabled: true, region, reason: null }` without spreading the private config.

- [ ] **Step 5: Implement the injected gateway**

Construct production clients only in `createRuntimeTftMatchGateway`:

```js
const riotApi = new RiotApi(config.apiKey);
const tftApi = new TftApi(config.apiKey);
```

Before constructing them, check `globalThis[Symbol.for('tft-match-v1.gateway-factory')]`. If it is a function, call it with a key-free object containing only `region`, `accountRegionGroup`, and `matchRegionGroup`. This seam is for same-process automated tests; production application routes expose no way to install or replace it.

`createTftMatchGateway` unwraps Twisted's `{ response }` DTOs, validates non-empty account PUUID and string match IDs, slices to ten, and awaits each detail inside a `for...of` loop. Account and list failures reject the whole operation; detail failures become per-row safe strings.

- [ ] **Step 6: Run focused verification**

```powershell
pnpm exec vitest run --project server src/lib/server/tft-matches/config.test.js src/lib/server/tft-matches/gateway.test.js
pnpm exec prettier --check src/lib/server/tft-matches/config.js src/lib/server/tft-matches/config.test.js src/lib/server/tft-matches/gateway.js src/lib/server/tft-matches/gateway.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit the private Riot boundary**

```powershell
git add src/lib/server/tft-matches/config.js src/lib/server/tft-matches/config.test.js src/lib/server/tft-matches/gateway.js src/lib/server/tft-matches/gateway.test.js
git commit -m "feat: add Twisted TFT match gateway"
```

---

### Task 3: Build the bounded preview cache and read-only discovery service

**Files:**

- Create: `src/lib/server/tft-matches/preview-cache.js`
- Create: `src/lib/server/tft-matches/preview-cache.test.js`
- Create: `src/lib/server/tft-matches/service.js`
- Create: `src/lib/server/tft-matches/service.test.js`

**Interfaces:**

- `storeTftMatchPreviewBatch(batch, { now, tokenFactory }?)` → token
- `getTftMatchPreviewBatch(token, { now }?)` → cloned batch or `null`
- `deleteTftMatchPreviewBatch(token)` → boolean
- `clearTftMatchPreviewCacheForTests()`
- `discoverTftMatchHistory({ database, tournamentId, playerId, config, gateway, now?: Date })`, defaulting `now` to `new Date()`
- `resolveTftMatchPreviewForSave({ database, token, matchId, tournamentId, config, now?: Date })`, defaulting `now` to `new Date()`
- `TftMatchPreviewConflictError` with status 409 and a fetch-again operator message

- [ ] **Step 1: Write failing cache lifecycle tests**

Use injected timestamps and deterministic token factories. Assert:

- generated production tokens match a 32-byte base64url shape and two writes differ;
- reads return a clone, so mutating a returned snapshot does not mutate the cached entry;
- an entry is readable before 15 minutes and absent at or after its expiration;
- writes and reads lazily remove expired entries;
- the 33rd live batch evicts the oldest insertion and retains the newest 32;
- a failed-save simulation leaves the token readable;
- explicit deletion after a successful-save simulation removes the entire batch.

- [ ] **Step 2: Write failing discovery service tests against an in-memory SQLite fixture**

Create only the players, tournaments, tournament_players, catalog_snapshots, and catalog_champions tables needed by the service. Seed one selected roster player with complete normalized Riot fields, one outsider, one active snapshot, active champions, and one excluded helper.

Assert:

- the browser-supplied player must belong to the supplied tournament;
- incomplete Riot identity, missing active catalog, or unavailable catalog fails before the gateway call;
- the gateway receives DB-owned game name/tagline, never a request-owned Riot ID or PUUID;
- ten returned details normalize, successful rows sort by `completedAt` descending, and failed detail rows stay visible after valid rows in original list order;
- returned rows are capped at ten;
- an intentionally old but otherwise valid detail within those ten remains in the result and cache, proving there is no post-fetch age cutoff;
- selected placement may be any value 1–8;
- mapping failures expose exact unresolved IDs in a safe unavailable row;
- `SELECT total_changes()` is identical immediately before and after both successful discovery and representative gateway/normalization failures;
- the cached batch binds region, tournament ID, catalog snapshot ID, local player ID, normalized Riot identity, resolved PUUID, snapshots by match ID, and safe failures;
- neither the returned DTO nor `JSON.stringify(cachedBatch)` contains `apiKey` or the configured key value.

- [ ] **Step 3: Write failing Save-resolution tests**

After discovery, call `resolveTftMatchPreviewForSave` and assert it returns the authoritative cached canonical value rather than a client projection. Then independently change each of these and assert a 409 conflict without deleting the cache:

- token or match ID;
- configured region;
- tournament ID;
- active catalog snapshot ID;
- roster membership;
- selected player's normalized Riot game name or tagline;
- cached payload validity.

Call `clearTftMatchPreviewCacheForTests()` to simulate a process restart and assert the old token receives the same fetch-again conflict. Then run discovery again for the same roster player, assert the replacement token differs, and successfully resolve the new token/match pair. This locks both halves of the disposable-cache behavior: restart loss fails safely and the data can be fetched again immediately.

- [ ] **Step 4: Run tests and confirm missing modules**

```powershell
pnpm exec vitest run --project server src/lib/server/tft-matches/preview-cache.test.js src/lib/server/tft-matches/service.test.js
```

Expected: FAIL because the cache and service do not exist.

- [ ] **Step 5: Implement the cache**

Use a module-level `Map`, `randomBytes(32).toString('base64url')`, `PREVIEW_TTL_MS = 15 * 60 * 1000`, and `MAX_PREVIEW_BATCHES = 32`. Never schedule a timer. Cleanup runs at the beginning of each read and write. Preserve insertion order on reads and delete the first Map key until the cap is satisfied.

Use `structuredClone` on cache ingress and egress. Store ISO timestamps or numeric milliseconds consistently; tests must prove the expiry boundary exactly.

- [ ] **Step 6: Implement roster/catalog discovery**

Use one joined read across `tournamentPlayers`, `players`, and `tournaments` to establish membership and obtain `riotGameName`, `riotTagline`, `displayName`, and `activeCatalogSnapshotId`. Verify the active catalog snapshot is available, then load all champion rows for only that snapshot, including excluded rows.

Call the injected gateway, normalize each successful payload independently, retain per-detail failures, sort successful projections by descending completion time, append unavailable projections in list order, store the complete batch, and return only `{ token, selectedPlayer, matches }`.

- [ ] **Step 7: Implement Save-time binding resolution**

Read the cache without consuming it. Re-query the same roster/catalog context, compare every binding, find only the requested match within the cached batch, re-run `parseCanonicalTftMatchSnapshot`, verify `snapshot.source.matchId`, `snapshot.source.region`, and the selected PUUID, then return the final correctly spelled source object from the Contracts section.

- [ ] **Step 8: Run focused verification**

```powershell
pnpm exec vitest run --project server src/lib/server/tft-matches/preview-cache.test.js src/lib/server/tft-matches/service.test.js
pnpm exec prettier --check src/lib/server/tft-matches/preview-cache.js src/lib/server/tft-matches/preview-cache.test.js src/lib/server/tft-matches/service.js src/lib/server/tft-matches/service.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit the transient discovery layer**

```powershell
git add src/lib/server/tft-matches/preview-cache.js src/lib/server/tft-matches/preview-cache.test.js src/lib/server/tft-matches/service.js src/lib/server/tft-matches/service.test.js
git commit -m "feat: stage TFT match previews in memory"
```

---

### Task 4: Add the append-only snapshot schema and repository

**Files:**

- Create: `src/lib/server/db/schema/tft-matches.js`
- Modify: `src/lib/server/db/schema/winner-boards.js`
- Modify: `src/lib/server/db/schema/index.js`
- Modify: `src/lib/server/db/schema/schema.test.js`
- Create: `src/lib/server/tft-matches/snapshot-repository.js`
- Create: `src/lib/server/tft-matches/snapshot-repository.test.js`
- Generate: `drizzle/0003_tft_match_snapshots.sql`
- Generate: `drizzle/meta/0003_snapshot.json`
- Modify generated journal: `drizzle/meta/_journal.json`

**Schema:**

```text
tft_match_snapshots
  id                            TEXT PRIMARY KEY
  riot_match_id                 TEXT NOT NULL
  region                        TEXT NOT NULL
  tournament_id                 TEXT NOT NULL
  selected_player_id            TEXT NOT NULL
  active_catalog_snapshot_id    TEXT NOT NULL
  contract_version              INTEGER NOT NULL
  payload_json                  TEXT NOT NULL
  fetched_at                    INTEGER NOT NULL
  saved_at                      INTEGER NOT NULL

winner_board_state.source_tft_match_snapshot_id
  nullable TEXT REFERENCES tft_match_snapshots(id) ON DELETE SET NULL
```

Keep context IDs as immutable text facts rather than foreign keys from the append-only table. This preserves snapshots if a later maintenance operation removes a player, tournament, or catalog snapshot. Add indexes named `tft_match_snapshots_match_idx` on `(region, riot_match_id)` and `tft_match_snapshots_tournament_idx` on `(tournament_id, saved_at)`.

- [ ] **Step 1: Add failing schema tests**

Extend the export list with `tftMatchSnapshots`. Assert its primary key, required columns, index names, and timestamp modes. Assert `winnerBoardState.sourceTftMatchSnapshotId` is nullable and references `tft_match_snapshots.id` with `onDelete: 'set null'`.

- [ ] **Step 2: Add failing snapshot repository tests**

Use an in-memory database with foreign keys enabled. Assert `insertTftMatchSnapshot(transaction, source, { id, savedAt })`:

- revalidates the canonical payload;
- re-reads tournament active catalog, roster membership, and normalized Riot identity inside the transaction;
- verifies source region, match ID, and selected PUUID against the canonical payload;
- inserts one row whose parsed JSON equals the canonical object exactly;
- stores canonical `fetchedAt` and injected `savedAt` as timestamps;
- rejects every binding mismatch before insertion.

- [ ] **Step 3: Run tests and confirm failures**

```powershell
pnpm exec vitest run --project server src/lib/server/db/schema/schema.test.js src/lib/server/tft-matches/snapshot-repository.test.js
```

Expected: FAIL because the table, source column, and repository do not exist.

- [ ] **Step 4: Implement schema and repository**

Export the new table from `schema/index.js`. Import it into `winner-boards.js` and add the nullable source reference.

In `snapshot-repository.js`, make the transaction-scoped binding query authoritative. Serialize only the parsed canonical object with `JSON.stringify`; do not retain the raw Riot response. Return the inserted UUID so the Winner state can reference it.

Define the third dependency argument as optional with production defaults `{ id: randomUUID(), savedAt: new Date() }`; tests pass fixed values, while `saveWinnerBoardState` calls the two-argument production form.

- [ ] **Step 5: Generate the named migration**

Run as two PowerShell commands:

```powershell
$env:DATABASE_URL='file:local.db'
pnpm db:generate --name tft_match_snapshots
```

Expected generated tag: `0003_tft_match_snapshots`. Inspect the SQL and confirm it creates the table and indexes before adding the nullable Winner source column. Reject any generated destructive table recreation or drop statement.

- [ ] **Step 6: Run focused verification**

```powershell
pnpm exec vitest run --project server src/lib/server/db/schema/schema.test.js src/lib/server/tft-matches/snapshot-repository.test.js
pnpm exec prettier --check src/lib/server/db/schema/tft-matches.js src/lib/server/db/schema/winner-boards.js src/lib/server/db/schema/index.js src/lib/server/db/schema/schema.test.js src/lib/server/tft-matches/snapshot-repository.js src/lib/server/tft-matches/snapshot-repository.test.js drizzle/meta/_journal.json drizzle/meta/0003_snapshot.json
```

Expected: PASS.

- [ ] **Step 7: Commit the durable snapshot foundation**

```powershell
git add src/lib/server/db/schema/tft-matches.js src/lib/server/db/schema/winner-boards.js src/lib/server/db/schema/index.js src/lib/server/db/schema/schema.test.js src/lib/server/tft-matches/snapshot-repository.js src/lib/server/tft-matches/snapshot-repository.test.js drizzle/0003_tft_match_snapshots.sql drizzle/meta/0003_snapshot.json drizzle/meta/_journal.json
git commit -m "feat: persist immutable TFT match snapshots"
```

---

### Task 5: Integrate snapshot insertion with the existing Winner transaction

**Files:**

- Modify: `src/lib/server/winner-boards/repository.js`
- Modify: `src/lib/server/winner-boards/repository.test.js`

**Interfaces:**

- Extend the local `SaveWinnerBoardStateInput` JSDoc with optional `sourceSnapshot`.
- Keep `saveWinnerBoardState(database, input)` as the sole public save function.
- Keep `getWinnerBoardState`, `setWinnerBoardLive`, and `resetWinnerBoardState` return shapes unchanged.

- [ ] **Step 1: Extend the test database schema without changing existing fixtures' meaning**

Add `tft_match_snapshots` to `schemaStatements` before `winner_board_state`, then add the nullable source column to the Winner table declaration. Existing `validInput()` must remain a manual Save with no source property.

- [ ] **Step 2: Add failing hidden-save tests**

Assert:

- a manual Save inserts no snapshot and stores a null source reference;
- an API-assisted Save inserts one exact snapshot and stores its UUID on `winner_board_state`, while deliberately edited Winner title, winner player, champion order/star levels, and augments persist independently from that snapshot;
- saving manually after an API-assisted Save clears only the current source reference and retains the prior snapshot row;
- resetting an API-assisted Winner board retains the append-only snapshot row;
- a forced snapshot insert failure rolls back the Winner replacement and retains the previous board;
- a forced Winner child insert failure rolls back the snapshot row too.

- [ ] **Step 3: Add failing live-save atomicity tests**

Start with a live publication, then assert:

- API-assisted Save inserts the snapshot, replaces the editable board, creates the next immutable publication, advances the live pointer/version, and returns the saved board;
- media preparation failure inserts no snapshot and changes no state;
- snapshot binding/insertion failure and Winner child-insert failure each roll back the live-path transaction, retain the old board/publication pointer/version, insert no snapshot, and remove the newly prepared unreferenced media;
- publication insertion or advancement failure rolls back the snapshot and Winner replacement, retains the old live publication pointer/version, and invokes existing prepared-media cleanup.

- [ ] **Step 4: Run the focused repository tests and confirm failure**

```powershell
pnpm exec vitest run --project server src/lib/server/winner-boards/repository.test.js
```

Expected: new assertions FAIL while existing manual/live tests remain green.

- [ ] **Step 5: Insert the source inside `replaceState`**

At the start of the transaction-owned replacement, call `insertTftMatchSnapshot` only when `input.sourceSnapshot` exists. Capture its UUID, validate the tournament scope as today, delete/replace the singleton, and set `sourceTftMatchSnapshotId` to the UUID or null.

Do not insert before `runWriteTransaction`. Do not delete any snapshot in reset or replacement paths. Keep live media preparation outside the transaction exactly as today; the snapshot starts only after media preparation succeeds and rolls back with publication advancement.

- [ ] **Step 6: Run focused verification**

```powershell
pnpm exec vitest run --project server src/lib/server/winner-boards/repository.test.js src/lib/server/tft-matches/snapshot-repository.test.js
pnpm exec prettier --check src/lib/server/winner-boards/repository.js src/lib/server/winner-boards/repository.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit the atomic Winner integration**

```powershell
git add src/lib/server/winner-boards/repository.js src/lib/server/winner-boards/repository.test.js
git commit -m "feat: attach TFT snapshots to winner saves"
```

---

### Task 6: Add the authenticated discovery endpoint and Save-action cache resolution

**Files:**

- Create: `src/routes/(admin)/admin/graphics/tft-matches/+server.js`
- Create: `src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js`
- Modify: `src/routes/(admin)/admin/graphics/+page.server.js`
- Modify: `src/routes/(admin)/admin/admin-actions.test.js`

**HTTP and form contract:**

- `POST /admin/graphics/tft-matches`
- Request `FormData`: `tournamentId`, `playerId`
- Response: `TftMatchDiscoveryResponse`, `Cache-Control: no-store`
- Existing `saveBoard` optional fields: `tftPreviewToken`, `tftMatchId`

- [ ] **Step 1: Write failing endpoint tests**

Directly call the request handler and assert:

- unauthenticated events fail through `requireAdmin`;
- empty tournament/player IDs return 400;
- missing configuration returns a safe feature-unavailable status and reason;
- authenticated valid input returns the service DTO with `Cache-Control: no-store`;
- extra form fields named `riotId`, `puuid`, `matchId`, and `region` are ignored and never forwarded;
- service conflict, rate-limit, key, player-not-found, and temporary-service errors return their safe message/status without stack or private values.

- [ ] **Step 2: Add failing `saveBoard` action tests**

Extend the hoisted mocks for configuration, preview resolution, cache deletion, and the snapshot-aware repository call. Assert:

- the existing manual form calls `saveWinnerBoardState` with its exact old object and never reads/deletes cache;
- supplying only one hidden source field returns 409 and never calls the repository;
- supplying both fields resolves the preview with DB/config/tournament binding, passes the returned source as `sourceSnapshot`, then deletes the cache token only after repository success;
- missing or changed Riot configuration after an import returns the same 409 fetch-again response and retains the cache;
- preview conflict returns the fetch-again message and retains the cache;
- repository failure retains the cache;
- successful API Save returns the same `{ action: 'saveBoard', board }` action shape.

- [ ] **Step 3: Add a failing page-load availability test**

Assert the graphics load result includes only `{ enabled, region, reason }` under `tftMatchApi` and does not serialize `apiKey`, account route group, or match route group. Missing configuration must not prevent the rest of the page load.

- [ ] **Step 4: Run route/action tests and confirm failure**

```powershell
pnpm exec vitest run --project server "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js" "src/routes/(admin)/admin/admin-actions.test.js"
```

Expected: FAIL because the endpoint and action integration are absent.

- [ ] **Step 5: Implement the authenticated endpoint**

Call `requireAdmin(event)` before reading the form. Parse private configuration server-side, create the runtime gateway, and call `discoverTftMatchHistory`. Return SvelteKit `json(result, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })`.

Map typed expected failures to safe HTTP responses. For unknown failures, return a generic temporary-unavailability message and log only an internal correlation UUID if project logging is added; do not log the caught object or request form.

- [ ] **Step 6: Implement page availability and API-assisted Save**

In `load`, call `getTftMatchApiAvailability(env)` synchronously and add only its safe result.

In `saveBoard`, preserve current champion/star/augment parsing. If neither source field exists, use the unchanged manual call. If both exist, require current config, resolve the cache source, pass it to the repository, and delete the batch only after the awaited repository call returns. Convert missing/changed API configuration during an API-backed Save into the same 409 fetch-again conflict as a stale cache. Return a 409 action failure for any `TftMatchPreviewConflictError`; retain the existing generic validation failure for ordinary invalid board data.

- [ ] **Step 7: Run focused verification**

```powershell
pnpm exec vitest run --project server "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js" "src/routes/(admin)/admin/admin-actions.test.js"
pnpm exec prettier --check "src/routes/(admin)/admin/graphics/tft-matches/+server.js" "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js" "src/routes/(admin)/admin/graphics/+page.server.js" "src/routes/(admin)/admin/admin-actions.test.js"
```

Expected: PASS.

- [ ] **Step 8: Commit the authenticated server workflow**

```powershell
git add "src/routes/(admin)/admin/graphics/tft-matches/+server.js" "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js" "src/routes/(admin)/admin/graphics/+page.server.js" "src/routes/(admin)/admin/admin-actions.test.js"
git commit -m "feat: expose authenticated TFT match discovery"
```

---

### Task 7: Build and verify the full-screen match import dialog

**Files:**

- Create: `src/lib/components/admin/TftMatchImportDialog.svelte`
- Create: `src/lib/components/admin/TftMatchImportDialog.svelte.test.js`

**Props:**

```js
{
	tournament: { id: string, name?: string } | null,
	roster: Array<{
		id: string,
		displayName: string,
		riotId: string | null,
		riotGameName: string | null,
		riotTagline: string | null
	}>,
	apiAvailability: TftMatchApiAvailability,
	hasActiveCatalog: boolean,
	onuseboard: (draft: TftMatchComposerDraft) => void
}
```

- [ ] **Step 1: Write failing entry and roster-stage browser tests**

Assert:

- **Fetch API Data** renders as one control suitable for the Winner control row;
- missing API config, tournament, active catalog signal, or roster makes it `aria-disabled="true"` and exposes the exact reason on hover and keyboard focus;
- opening a valid control creates a modal native dialog filling the viewport with outer padding;
- the roster-stage heading is exactly “Which player do you want to fetch data from?”;
- roster order matches the provided array;
- complete Riot game name/tagline rows activate;
- incomplete rows remain visible, grey, cannot call `fetch`, and expose “A complete Riot ID is required.” on hover/focus;
- Escape and Close dismiss without callback and restore focus to **Fetch API Data**;
- Tab and Shift+Tab wrap between the first and last enabled controls while the modal is open, including roster, loading-error, history, and verification stages.

The explicit `hasActiveCatalog` prop keeps entry availability independent from browser-visible catalog contents.

- [ ] **Step 2: Write failing loading/history tests with a deferred fetch**

Spy on `globalThis.fetch`. After selecting an eligible player, assert a centered status region announces “Please wait…” and includes a visible animated spinner with `role="progressbar"` and an accessible label. Resolve the deferred response with 12 rows and assert the component renders only the first 10 response rows.

For valid rows assert completed local date/time, selected placement, game type, set number/core name, and match ID. For invalid rows assert `aria-disabled="true"`, no stage transition, and reason popover on hover/focus.

Resolve a failed HTTP response and assert the selected player context remains, a safe error is announced, and Back/Retry controls work.

Resolve a successful response with an empty `matches` array and assert an explicit “No recent matches found.” state with Back/Retry controls rather than a blank panel.

- [ ] **Step 3: Write failing verification and handoff tests**

Select a valid non-first-place row and assert:

- heading text is “Please double-check this is the correct board.”;
- local player, Riot ID, date/time, placement, game type, set, and match ID render;
- champions render in one `flex-col` list with icon fallback, display name, and one to three star glyphs based on `starLevel`;
- no augment label or data renders;
- Back returns to history without refetching;
- **Use this board** calls `onuseboard` once with token, match ID, local winner ID, and champions, then closes without a network request;
- focus is not restored to the trigger after successful handoff because the composer owns the next focus target.

- [ ] **Step 4: Run browser tests and confirm the missing component failure**

```powershell
pnpm exec vitest run --project client src/lib/components/admin/TftMatchImportDialog.svelte.test.js
```

Expected: FAIL because the component does not exist.

- [ ] **Step 5: Implement the dialog state machine**

Use explicit stages `'roster'`, `'loading'`, `'matches'`, and `'verify'`. Keep selected player, response token, rows, selected row, request error, and trigger/dialog elements in `$state`. Reset transient state on each fresh open.

Use a native `<dialog>` with `showModal()`, `aria-modal="true"`, labelled heading, Escape cancellation, explicit Close/Back controls, a keyboard focus trap, and these layout constraints. The loading stage must render the tested progressbar spinner next to “Please wait…” rather than text alone:

```text
fixed inset-0 m-0 h-dvh w-dvw max-h-none max-w-none bg-transparent p-4 md:p-8
inner panel: h-full overflow-y-auto rounded-container bg-surface-50-950 p-5 md:p-8
```

Use `fetch(resolve('/admin/graphics/tft-matches'), { method: 'POST', body: formData, headers: { Accept: 'application/json' } })`. The form contains only `tournamentId` and `playerId`.

- [ ] **Step 6: Implement hover/focus reason popovers**

Keep unavailable controls focusable with `aria-disabled="true"`, `type="button"`, and a guard that performs no action. Link each control to a nearby `role="tooltip"` element with `aria-describedby`. Reveal the tooltip from the same wrapper on `:hover` and `:focus-within`; hide it visually otherwise. Do not rely on `title`, because keyboard and touch users need visible content.

- [ ] **Step 7: Run the Svelte autofixer until clean**

Send the complete `TftMatchImportDialog.svelte` source to the Svelte MCP autofixer with Svelte version 5. Apply every correctness and accessibility fix that preserves the approved interaction, then rerun until both issue and suggestion arrays are empty.

- [ ] **Step 8: Run focused verification**

```powershell
pnpm exec vitest run --project client src/lib/components/admin/TftMatchImportDialog.svelte.test.js
pnpm check
pnpm exec prettier --check src/lib/components/admin/TftMatchImportDialog.svelte src/lib/components/admin/TftMatchImportDialog.svelte.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit the dialog**

```powershell
git add src/lib/components/admin/TftMatchImportDialog.svelte src/lib/components/admin/TftMatchImportDialog.svelte.test.js
git commit -m "feat: add TFT match import dialog"
```

---

### Task 8: Populate the existing composer without changing its Save semantics

**Files:**

- Modify: `src/lib/components/admin/WinnerBoardComposer.svelte`
- Modify: `src/lib/components/admin/admin-components.svelte.test.js`
- Modify: `src/routes/(admin)/admin/graphics/+page.svelte`

**Composer additions:**

- Prop: `tftMatchApi: TftMatchApiAvailability`
- Local source state: `{ previewToken, matchId } | null`
- Callback: `useApiBoard(draft: TftMatchComposerDraft)`
- Hidden inputs in the original save form: `tftPreviewToken`, `tftMatchId`
- Review status: “API board loaded. Review it, then Save.”

- [ ] **Step 1: Add failing control-row and handoff tests**

Extend `composerProps()` with complete Riot roster fields and a default enabled availability object. Mock the discovery response and assert:

- **Fetch API Data** is in the same rounded control row as the Live switch and Reset button;
- importing a board replaces `winnerPlayerId`, champion order, and every imported star level;
- the existing title input and selected augment checkboxes are unchanged;
- the original save form contains exactly one token and match ID hidden input after import;
- the unsaved review message appears, the Save button remains the existing **Save board**, and Live-on remains disabled while dirty;
- focus moves to the composer review/save region;
- closing without import leaves composer fields and hidden inputs unchanged.

- [ ] **Step 2: Add failing canonical-save synchronization tests**

Rerender with a successful `form.action === 'saveBoard'` and a newer canonical board. Assert the imported source state and review message clear, the hidden fields disappear, and the canonical board becomes the new non-dirty baseline. Then edit a manual field and assert the next save form has no API fields, which will clear the persisted source reference.

Rerender with a 409 preview-expired form response and unchanged canonical board. Assert the composer fields and hidden source remain so the operator can inspect the draft or fetch again; display the server's fetch-again message.

Rerender separately with a non-409 repository/publication failure response and the same canonical board. Assert the edited composer, hidden source, dirty state, and prior saved/live baseline all remain unchanged; no API-related failure may reset the browser draft.

Rerender after a successful Reset with `savedBoard: null`, and rerender the graphics page under a different tournament key. In both cases assert the prior token, match ID, and review message disappear; no API source may leak into a reset or newly selected tournament.

- [ ] **Step 3: Run browser tests and confirm failure**

```powershell
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js
```

Expected: new integration assertions FAIL while existing Save/Live/Reset tests remain green.

- [ ] **Step 4: Integrate the dialog into `WinnerBoardComposer`**

Render `TftMatchImportDialog` between Live and Reset/broadcast controls. Derive `hasActiveCatalog` from `Boolean(activeCatalog.snapshot)`. On handoff:

```js
composer.winnerPlayerId = draft.winnerPlayerId;
composer.championIds = draft.champions.map((champion) => champion.catalogChampionId);
composer.starLevels = Object.fromEntries(
	draft.champions.map((champion) => [champion.catalogChampionId, champion.starLevel])
);
apiSource = { previewToken: draft.previewToken, matchId: draft.matchId };
```

Do not assign `composer.title` or `composer.augmentIds`. Include `Boolean(apiSource)` in the dirty calculation so importing an otherwise identical board remains savable. Clear `apiSource` whenever `canonicalKey !== lastBaselineKey`, including a successful Save and the transition to the empty baseline after Reset. Component recreation under the graphics page's tournament key must initialize with no API source.

- [ ] **Step 5: Pass safe availability through the graphics page**

Add `tftMatchApi={data.tftMatchApi}` to the existing `WinnerBoardComposer` call. Do not add a new page or a second save form.

- [ ] **Step 6: Run the Svelte autofixer until both files are clean**

Run the Svelte MCP autofixer separately on the complete modified `WinnerBoardComposer.svelte` and `+page.svelte` sources with Svelte version 5. Apply fixes and repeat until neither call reports issues or suggestions.

- [ ] **Step 7: Run focused verification**

```powershell
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js src/lib/components/admin/TftMatchImportDialog.svelte.test.js
pnpm check
pnpm exec prettier --check src/lib/components/admin/WinnerBoardComposer.svelte src/lib/components/admin/admin-components.svelte.test.js "src/routes/(admin)/admin/graphics/+page.svelte"
```

Expected: PASS.

- [ ] **Step 8: Commit the in-memory composer handoff**

```powershell
git add src/lib/components/admin/WinnerBoardComposer.svelte src/lib/components/admin/admin-components.svelte.test.js "src/routes/(admin)/admin/graphics/+page.svelte"
git commit -m "feat: populate winner composer from TFT matches"
```

---

### Task 9: Exercise the complete operator workflow with a fake injected gateway

**Files:**

- Create: `tests/fixtures/fake-tft-match-gateway.js`
- Modify: `scripts/e2e-server.js`
- Modify: `scripts/playwright-global-setup.js`
- Modify: `playwright.config.js`
- Modify: `tests/manual-winner-graphics.test.js`

**Fake data contract:**

- Region `VN2`
- Match ID `VN2_E2E_MATCH_1`
- Eight unique participants with placements 1–8
- Selected roster player's PUUID returned from account resolution and placed at 4
- One mapped `TFT16_TestChampion` at tier 2 on the selected board
- No augments field
- Complete match metadata with deterministic timestamp and set values

- [ ] **Step 1: Build a two-phase, loopback-only preview restart harness with an intentionally failing fake**

Create `tests/fixtures/fake-tft-match-gateway.js` with a factory whose initial `fetchRecentMatches` increments a module-local history-call counter and throws exactly `new Error('E2E TFT gateway fixture is not implemented')`. Export counter reset/read helpers. This temporary red behavior must not be committed.

At module startup in both `scripts/e2e-server.js` and `playwright.config.js`, explicitly assign `RIOT_API_KEY = ''` and `RIOT_REGION = ''` rather than inheriting values from the developer shell. Do the same at the beginning of `playwright-global-setup.js`, and delete the provider symbol before `vite.preview` starts. Empty process values intentionally override any ignored local `.env` file that Vite's `loadEnv` would otherwise reload; application configuration trims them and treats them as missing. This guarantees the build and the first browser phase exercise genuinely missing configuration and cannot observe a real credential.

In `playwright-global-setup.js`, keep `activeServer`, `mode`, and `restartPromise` in the setup closure and start the first `vite.preview` with the empty environment. Use a small plugin factory to pass a fresh test-only Vite plugin object, backed by that shared closure, to every preview instance. Register middleware directly in `configurePreviewServer`; do not return a post hook, so it runs before the application fallback. Keep preview bound to `127.0.0.1`, reject a non-loopback socket, expose `GET /__e2e/tft-match-mode` returning only `{ mode: 'disabled' | 'restarting' | 'enabled' }`, and accept the transition only once at `POST /__e2e/enable-tft-match`.

The enable handler sets mode to `restarting`, returns 202, and starts one tracked asynchronous restart after the response finishes. The restart must close the disabled preview completely, reset the fake counter, install `globalThis[Symbol.for('tft-match-v1.gateway-factory')] = createFakeTftMatchGateway`, then assign the fake key and `VN2`, and only then call `preview(...)` again on the same port. Set mode to `enabled` only after the replacement preview resolves. Attach a rejection handler to `restartPromise` immediately when it is created, store the error in `restartError`, and let teardown report it; do not leave a rejected restart promise unhandled while Playwright polls.

The restart is required because SvelteKit preview snapshots `$env/dynamic/private` during `Server.init`; mutating `process.env` without restarting would leave the feature disabled. Installing the factory before assigning non-empty configuration guarantees no enabled server state can construct a real Twisted client. Teardown awaits the restart promise if present, closes whichever preview is active, reports any restart failure, verifies exactly one history call when enabled, deletes the symbol, and restores both Riot process values to empty strings. These control endpoints exist only in Playwright's in-process preview middleware; do not add an application route or ship a production test hook.

The fake receives no private key because `createRuntimeTftMatchGateway` passes only key-free routing metadata to injected factories. Task 2's explicit provider test must prove the injected factory is chosen before either Twisted client is constructed.

- [ ] **Step 2: Add a failing two-phase Playwright workflow**

Extend the existing single operator workflow without splitting it into another server run:

- on the first graphics-page visit, while both Riot variables are forcibly absent, assert **Fetch API Data** is `aria-disabled`, hover/focus its wrapper, and assert the safe configuration reason is visible;
- complete the existing manual title, champion, star-level, and augment edits; click the original **Save board**, take it Live, and assert the broadcast publication succeeds while API configuration is still absent;
- keep the existing player/catalog maintenance checks, then immediately before the later live-board update call the test-only `POST /__e2e/enable-tft-match` control and require status 202;
- poll `GET /__e2e/tft-match-mode`, tolerating connection refusal while the port restarts, until it returns `enabled`; then reload the graphics page with the same authenticated browser context and assert API availability is enabled;
- change the title to `Championship Winner` while leaving the already-saved `Test Augment` selected, click **Fetch API Data**, select the maintained Player Two roster row, choose the valid placement-four match, inspect the champion verification view, and click **Use this board**;
- assert the edited title and selected augment are preserved, the maintained Player Two and tier-two corrected Test Champion populate, the review message appears, Live remains the prior saved state, and the imported draft has not been persisted;
- query SQLite and assert `tft_match_snapshots` still has zero rows and the existing manual board has a null source before **Save board**;
- click the original **Save board** while Live and assert one snapshot row, exactly eight parsed participants, no augment key, and `winner_board_state.source_tft_match_snapshot_id` equals the inserted snapshot UUID;
- assert the live publication/version advances through the existing Save-while-Live path and both already-open broadcast pages render the maintained player and corrected champion.

This one test must therefore prove both end-to-end acceptance modes: missing configuration leaves manual Winner Save/Live fully functional, and enabled configuration uses only the deterministic injected boundary.

- [ ] **Step 3: Run E2E and confirm the safe fake-fixture failure**

```powershell
pnpm test:e2e
```

Expected: the missing-configuration manual Save/Live phase passes, the controlled preview restart succeeds, then the API phase reaches the throwing fake and FAILS when the expected history row cannot appear, with only the endpoint's safe temporary-unavailability UI exposed. Riot cannot be contacted: empty process values override local `.env` files for the first server, and the replacement server receives non-empty configuration only after the fake is installed.

- [ ] **Step 4: Replace the throwing fake with the deterministic match gateway**

Keep the same factory and counter interface, but return the exact `fetchRecentMatches` gateway contract. Derive the selected PUUID deterministically from the supplied game name/tagline and build all eight participants in memory. Return one complete match and never read an API key or contact a network service. The global setup resets the counter immediately before the enabled preview starts; teardown throws unless that workflow made exactly one discovery call.

- [ ] **Step 5: Update E2E database cleanup order**

Delete `winner_board_state` before `tft_match_snapshots`, and delete `tft_match_snapshots` before tournaments/catalog/players. Keep the existing cleanup rooted under the explicit E2E media directory.

- [ ] **Step 6: Run E2E and focused server regression tests**

```powershell
pnpm test:e2e
pnpm exec vitest run --project server src/lib/server/tft-matches src/lib/server/winner-boards/repository.test.js
```

Expected: PASS. The initial empty-env phase, authenticated session surviving the controlled restart, loopback-only activation order, global-teardown counter, Task 2 provider test, deliberately invalid E2E key, and network-free fake prove both configuration modes without ever making a Riot request.

- [ ] **Step 7: Commit the end-to-end coverage**

```powershell
git add tests/fixtures/fake-tft-match-gateway.js scripts/e2e-server.js scripts/playwright-global-setup.js playwright.config.js tests/manual-winner-graphics.test.js
git commit -m "test: cover TFT match winner import workflow"
```

---

### Task 10: Document runtime configuration and complete release verification

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/TODO.md`
- Stage the saved plan artifact: `docs/superpowers/plans/2026-08-12-tft-match-v1-winner-import.md`

- [ ] **Step 1: Document the optional server-only configuration**

Add this exact environment example:

```dotenv
RIOT_API_KEY=
RIOT_REGION=VN2
```

Update README's opening claim so it no longer says the key is unused. State that both values enable only the optional admin import, the manual Winner flow works without them, the key never reaches the browser, and one process supports one configured platform region.

Document the freshness policy: account lookup once, exactly ten newest match IDs, sequential detail retrieval, no date range, no Set 1 backfill, and disposable 15-minute process-local previews.

- [ ] **Step 2: Update the work status accurately**

In `docs/TODO.md`, mark the four Immediate Priority TFT-MATCH-V1 items complete only after all code tests pass. Change the later Post-Match scene wording from placements/augments/champions to placements/champions from this snapshot, and state that any future augment source requires a separate design because current match responses omit augments.

- [ ] **Step 3: Format all changed source and documentation**

Run:

```powershell
pnpm exec prettier --write src/lib/tft-match.js src/lib/server/tft-matches src/lib/server/db/schema/tft-matches.js src/lib/server/db/schema/winner-boards.js src/lib/server/db/schema/index.js src/lib/server/db/schema/schema.test.js src/lib/server/winner-boards/repository.js src/lib/server/winner-boards/repository.test.js src/lib/components/admin/TftMatchImportDialog.svelte src/lib/components/admin/TftMatchImportDialog.svelte.test.js src/lib/components/admin/WinnerBoardComposer.svelte src/lib/components/admin/admin-components.svelte.test.js "src/routes/(admin)/admin/graphics/+page.server.js" "src/routes/(admin)/admin/graphics/+page.svelte" "src/routes/(admin)/admin/graphics/tft-matches/+server.js" "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js" "src/routes/(admin)/admin/admin-actions.test.js" scripts/e2e-server.js scripts/playwright-global-setup.js playwright.config.js tests/fixtures/fake-tft-match-gateway.js tests/manual-winner-graphics.test.js README.md docs/TODO.md
```

Expected: formatter exits 0. Inspect `git diff --stat` and confirm no unrelated files changed.

- [ ] **Step 4: Run the complete verification matrix**

Run each command separately and stop on the first failure:

```powershell
pnpm check
pnpm lint
pnpm exec vitest run --project server
pnpm exec vitest run --project client
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command exits 0. Browser/server tests must use only fake injected clients; no real Riot key or service is required.

- [ ] **Step 5: Perform explicit safety checks**

Run:

```powershell
rg -n "RIOT_API_KEY|apiKey" src/lib/components src/routes src/lib/tft-match.js
rg -n "fetch\(" src/lib/server/tft-matches --glob "!*.test.js"
rg -n "augments|\bwin\b" src/lib/server/tft-matches src/lib/components/admin/TftMatchImportDialog.svelte --glob "!*.test.js"
rg -n "startTime|endTime|listWithDetails" src/lib/server/tft-matches --glob "!*.test.js"
```

Expected findings:

- no API key name/value is serialized by components or route response objects;
- the server TFT modules contain no application-owned `fetch` call;
- no augment/`win` reference exists in the production canonical snapshot or dialog;
- no backfill parameter or `listWithDetails` call exists in production gateway code.

- [ ] **Step 6: Verify migration and working tree scope**

Run:

```powershell
git status --short
git log -p -1 -- drizzle/0003_tft_match_snapshots.sql drizzle/meta/_journal.json
```

Expected: only the documentation files and this saved plan artifact remain unstaged, and the migration diff is additive.

- [ ] **Step 7: Commit documentation**

```powershell
git add .env.example README.md docs/TODO.md docs/superpowers/plans/2026-08-12-tft-match-v1-winner-import.md
git commit -m "docs: document TFT match winner imports"
```

- [ ] **Step 8: Final clean verification**

```powershell
git status --short
git log -10 --oneline
```

Expected: clean worktree and the ten focused commits from this plan, with no accidental modification to the supplied example payload.

## Final Acceptance Checklist

- [ ] The button sits beside Live/Reset and missing prerequisites have a hover/focus reason.
- [ ] The modal is full-screen with padding and keyboard-safe focus behavior.
- [ ] Ineligible roster players remain visible but cannot activate.
- [ ] Selecting a player blocks inside the modal with “Please wait…” while Twisted resolves account, ten IDs, and sequential details.
- [ ] At most ten newest matches appear; any placement can be selected.
- [ ] Invalid details or mappings disable only their own row with a safe reason.
- [ ] Verification shows champions in a vertical column and never shows augments.
- [ ] **Use this board** changes only in-memory winner/champions/star levels/source and preserves title/augments.
- [ ] Browsing and handoff leave SQLite and the live graphic untouched.
- [ ] The original Save atomically inserts the exact eight-player snapshot and editable Winner state.
- [ ] A manual Save clears the current source reference without deleting historical snapshots.
- [ ] Save while Live still creates and advances one immutable publication.
- [ ] Cache expiry, restart loss, binding drift, mapping errors, database failures, and Riot failures preserve saved/live state.
- [ ] Automated tests never contact Riot and the full verification matrix passes.
