# TFT Winner Import Ordered Unit Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` task-by-task with a fresh implementer and independent review gate. Steps use checkbox syntax for tracking.

**Goal:** Import and edit TFT Winner boards as ordered, duplicate-safe unit slots while atomically persisting an exact match snapshot only through the existing Save action.

**Architecture:** The active eligible catalog is the sole mapping whitelist. Match normalization turns every matching `units[]` occurrence into an ordered slot and omits unmatched occurrences with a safe count; it never uses a hard-coded helper list. The Composer, route action, repository, snapshot, and publication all exchange one ordered `champions[]` list, so repeated champion IDs retain independent star levels.

**Tech Stack:** Svelte 5, SvelteKit, JavaScript/JSDoc, Zod 4, Twisted 1.82, Drizzle/SQLite, Vitest, Playwright, Skeleton/Tailwind.

## Global Constraints

- A board slot is `{ slotId, catalogChampionId, starLevel, displayOrder }`; `slotId` is browser-local and never trusted by the server.
- Duplicate `catalogChampionId` values are valid in all canonical snapshots, saved boards, publications, previews, and forms.
- Each Riot `units[]` occurrence maps only when `character_id` exactly matches an active eligible catalog `externalId`; unmatched occurrences are omitted and counted.
- No static helper allowlist and no inference from unit name, cost, rarity, or traits.
- Canonical snapshots remain strict version 1, retain exactly eight unique placements/participants, and contain no augments or `win` field.
- The browser never receives Riot keys, raw responses, arbitrary PUUID/match selection, or unrelated participant data.
- Browse/import never writes. The existing Save action atomically writes board and optional snapshot; manual save clears only source linkage.
- Title and selected augments survive import unchanged. Save-while-Live keeps its immutable publication behavior.

---

## File and Responsibility Map

- `src/lib/tft-match.js` — shared JSDoc for ordered slots and Winner board state.
- `src/lib/server/tft-matches/contract.js` — strict canonical match normalization and safe selected-board projection.
- `src/lib/server/tft-matches/{gateway,cache,discovery,repository}.js` — private provider access, 15-minute previews, safe discovery, durable snapshots.
- `src/lib/server/winner-boards/repository.js` — atomic board/snapshot/publication write boundary.
- `src/routes/(admin)/admin/graphics/+page.server.js` — indexed slot form parsing and token resolution.
- `src/lib/components/admin/{TftMatchImportDialog,WinnerBoardComposer}.svelte` — import review and independent slot editor.
- `src/routes/(admin)/admin/graphics/tft-matches/+server.js` — protected safe discovery endpoint.
- `tests/fixtures/fake-tft-match-gateway.js` and Playwright harness — network-free acceptance workflow.

### Task 1: Replace the contract with duplicate-safe active-catalog slots

**Files:**
- Modify: `src/lib/tft-match.js`
- Modify: `src/lib/server/tft-matches/contract.js`
- Modify: `src/lib/server/tft-matches/contract.test.js`

**Produces:**

```js
normalizeTftMatch({ payload, requestedMatchId, selectedPuuid, region, catalogChampions, fetchedAt })
// => strict snapshot where participant.champions may repeat catalogChampionId
// => participant.omittedUnitCount is a non-negative integer

previewRowFromSnapshot(snapshot, selectedPuuid)
// => selected player match metadata, champions[], omittedUnitCount only
```

- [ ] **Step 1: Write failing contract regressions**

```js
test('keeps duplicate mapped units as independent ordered slots', () => {
  const result = normalizeTftMatch({ ...fixtureInput, catalogChampions });
  expect(result.participants[0].champions).toEqual([
    expect.objectContaining({ catalogChampionId: 'zed', starLevel: 2, displayOrder: 0 }),
    expect.objectContaining({ catalogChampionId: 'zed', starLevel: 1, displayOrder: 1 })
  ]);
});

test('omits a unit absent from the eligible catalog and counts it', () => {
  expect(result.participants[0].omittedUnitCount).toBe(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --project server src/lib/server/tft-matches/contract.test.js`  
Expected: FAIL because duplicate mapped IDs are currently rejected and unmatched units are not represented as omissions.

- [ ] **Step 3: Implement the slot mapping**

```js
const champions = [];
let omittedUnitCount = 0;
for (const unit of participant.units) {
  const catalog = catalogByExternalId.get(requiredText(unit.character_id));
  if (!catalog) { omittedUnitCount += 1; continue; }
  champions.push({
    catalogChampionId: catalog.id,
    externalId: catalog.externalId,
    displayName: catalog.displayName,
    iconPath: catalog.iconPath,
    starLevel: validTier(unit.tier),
    displayOrder: champions.length
  });
}
```

Remove duplicate-champion rejection from raw/canonical validation. Keep strict schema validation for slot order, tiers, metadata participant equality, and all existing safe-error behavior.

- [ ] **Step 4: Verify GREEN and format**

Run: `pnpm exec vitest run --project server src/lib/server/tft-matches/contract.test.js`  
Expected: PASS.

Run: `pnpm exec prettier --check src/lib/tft-match.js src/lib/server/tft-matches/contract.js src/lib/server/tft-matches/contract.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/tft-match.js src/lib/server/tft-matches/contract.js src/lib/server/tft-matches/contract.test.js
git commit -m "fix: preserve duplicate TFT board units"
```

### Task 2: Make saved boards and publications accept indexed duplicate slots

**Files:**
- Modify: `src/lib/winner-board.js`
- Modify: `src/lib/server/winner-boards/repository.js`
- Modify: `src/lib/server/winner-boards/repository.test.js`
- Modify: `src/routes/(admin)/admin/graphics/+page.server.js`
- Modify: `src/routes/(admin)/admin/admin-actions.test.js`

**Consumes:** ordered `champions[]` from Task 1.

**Produces:** server input `champions: Array<{ catalogChampionId: string, starLevel: number | null }>` where repeated IDs remain independent ordered entries.

- [ ] **Step 1: Write failing persistence/action tests**

```js
expect(saved.champions).toEqual([
  expect.objectContaining({ catalogChampionId: 'zed', starLevel: 2, displayOrder: 0 }),
  expect.objectContaining({ catalogChampionId: 'zed', starLevel: 1, displayOrder: 1 })
]);

const form = new FormData();
form.append('championCatalogId', 'zed');
form.append('championStarLevel', '2');
form.append('championCatalogId', 'zed');
form.append('championStarLevel', '1');
```

Also prove publication payload preserves both entries, malformed unequal indexed field arrays fail safely, and source linkage is unchanged by this representation change.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --project server src/lib/server/winner-boards/repository.test.js "src/routes/(admin)/admin/admin-actions.test.js"`  
Expected: FAIL because existing duplicate validation and ID-keyed star form parsing collapse/reject repeated entries.

- [ ] **Step 3: Implement ordered form parsing and repository validation**

```js
const championIds = toStringValues(form.getAll('championCatalogId'));
const starLevels = toStringValues(form.getAll('championStarLevel'));
if (championIds.length !== starLevels.length) throw new Error('Invalid champion slots');
const champions = championIds.map((catalogChampionId, displayOrder) => ({
  catalogChampionId,
  starLevel: parseStarLevel(starLevels[displayOrder])
}));
```

Validate every entry, preserve order, and remove only the duplicate-ID rejection. Do not add a database uniqueness constraint; existing `displayOrder` rows represent slots.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run --project server src/lib/server/winner-boards/repository.test.js "src/routes/(admin)/admin/admin-actions.test.js"`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/winner-board.js src/lib/server/winner-boards/repository.js src/lib/server/winner-boards/repository.test.js "src/routes/(admin)/admin/graphics/+page.server.js" "src/routes/(admin)/admin/admin-actions.test.js"
git commit -m "feat: save ordered winner board slots"
```

### Task 3: Implement the private gateway, bounded previews, and protected endpoint

**Files:**
- Create: `src/lib/server/tft-matches/config.js`, `gateway.js`, `cache.js`, `discovery.js`, and focused tests
- Create: `src/routes/(admin)/admin/graphics/tft-matches/+server.js` and test
- Modify: `src/routes/(admin)/admin/graphics/+page.server.js`

**Consumes:** Task 1 canonical snapshot and Task 2 ordered source input.

- [ ] **Step 1: Write failing gateway/discovery/endpoint tests**

Test missing private config yields a safe disabled reason; injected fake factory wins before Twisted construction; one account lookup, ten newest IDs, sequential detail calls, 15-minute opaque cache; roster-only request identity; selected match only; omitted-unit count in safe DTO; expired token fails Save with safe refetch message; unauthenticated endpoint rejects.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --project server src/lib/server/tft-matches "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js"`  
Expected: FAIL because the private modules and endpoint do not exist.

- [ ] **Step 3: Implement server boundaries**

```js
const preview = cache.put({ tournamentId, playerId, snapshots, expiresAt: Date.now() + 15 * 60_000 });
return { token: preview.token, matches: snapshots.map((snapshot) => previewRowFromSnapshot(snapshot, puuid)) };
```

Use `$env/dynamic/private`, never browser imports. Route Save resolves only the opaque token plus match ID from cache, then passes the resolved canonical snapshot into Task 2’s transaction input.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm exec vitest run --project server src/lib/server/tft-matches "src/routes/(admin)/admin/graphics/tft-matches/tft-matches.test.js" "src/routes/(admin)/admin/admin-actions.test.js"`  
Expected: PASS.

```powershell
git add src/lib/server/tft-matches "src/routes/(admin)/admin/graphics/tft-matches" "src/routes/(admin)/admin/graphics/+page.server.js" "src/routes/(admin)/admin/admin-actions.test.js"
git commit -m "feat: discover TFT match board slots"
```

### Task 4: Add durable eight-participant snapshots to the existing Save transaction

**Files:**
- Create: `src/lib/server/db/schema/tft-matches.js`, `src/lib/server/tft-matches/repository.js`, tests, and additive migration
- Modify: schema exports/tests, `winner-boards.js`, `winner-boards/repository.js`, and its tests

**Consumes:** Task 1 canonical snapshot and Task 3 cache resolution.

- [ ] **Step 1: Write failing schema/transaction tests**

Assert one Save inserts one immutable snapshot with eight participants whose boards preserve duplicate slot entries/order; source reference points to it; manual Save clears source reference but retains old snapshot; a transaction failure leaves neither state nor snapshot; live Save produces one new immutable publication.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --project server src/lib/server/db/schema/schema.test.js src/lib/server/tft-matches/repository.test.js src/lib/server/winner-boards/repository.test.js`  
Expected: FAIL because snapshot tables/source field/repository do not exist.

- [ ] **Step 3: Implement additive persistence**

Create `tft_match_snapshots` and participant rows with `snapshotId`, `puuid`, `placement`, and canonical slot JSON or normalized ordered slot rows. Add nullable `source_tft_match_snapshot_id` to `winner_board_state`. Insert snapshot and board state inside the existing repository transaction.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm exec vitest run --project server src/lib/server/db/schema/schema.test.js src/lib/server/tft-matches/repository.test.js src/lib/server/winner-boards/repository.test.js`  
Expected: PASS.

```powershell
git add drizzle src/lib/server/db/schema src/lib/server/tft-matches/repository.js src/lib/server/tft-matches/repository.test.js src/lib/server/winner-boards
git commit -m "feat: persist TFT winner match snapshots"
```

### Task 5: Build the import dialog and redesign the Winner composer as slots

**Files:**
- Create: `src/lib/components/admin/TftMatchImportDialog.svelte` and test
- Modify: `src/lib/components/admin/WinnerBoardComposer.svelte`, `src/lib/components/admin/admin-components.svelte.test.js`, and `src/routes/(admin)/admin/graphics/+page.svelte`

**Consumes:** Task 3 browser-safe DTO and Task 2 indexed form format.

- [ ] **Step 1: Write failing browser tests**

Cover disabled API reason, full-screen focus-safe dialog, eligible roster selection, loading, match rows, verification, omitted-unit note, cancel, handoff, and title/augment preservation. Cover manual Add champion twice for Zed, independent 2★/1★ controls, move/remove, indexed hidden inputs, imported duplicate slots, dirty/live save rules, reset/tournament baseline clearing, and no second save form.

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run --project client src/lib/components/admin/TftMatchImportDialog.svelte.test.js src/lib/components/admin/admin-components.svelte.test.js`  
Expected: FAIL because the dialog and slot editor behaviors are absent.

- [ ] **Step 3: Implement slot UI**

```js
function addChampion(catalogChampionId) {
  composer.champions.push({ slotId: crypto.randomUUID(), catalogChampionId, starLevel: null });
}

function moveSlot(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= composer.champions.length) return;
  [composer.champions[index], composer.champions[target]] = [composer.champions[target], composer.champions[index]];
}
```

Render each slot with key `slotId`; serialize same-position `championCatalogId` and `championStarLevel` inputs. Dialog handoff replaces only `winnerPlayerId` and `champions`, preserves title/augments, stores opaque token/match ID, and announces omitted count.

- [ ] **Step 4: Run Svelte validation**

Run `svelte-autofixer` on each complete modified `.svelte` file until it returns no issues/suggestions.

- [ ] **Step 5: Verify GREEN and commit**

Run: `pnpm exec vitest run --project client src/lib/components/admin/TftMatchImportDialog.svelte.test.js src/lib/components/admin/admin-components.svelte.test.js`  
Expected: PASS.

Run: `pnpm check`  
Expected: PASS.

```powershell
git add src/lib/components/admin/TftMatchImportDialog.svelte src/lib/components/admin/TftMatchImportDialog.svelte.test.js src/lib/components/admin/WinnerBoardComposer.svelte src/lib/components/admin/admin-components.svelte.test.js "src/routes/(admin)/admin/graphics/+page.svelte"
git commit -m "feat: edit winner boards as ordered slots"
```

### Task 6: Add deterministic E2E, document configuration, and release-verify

**Files:**
- Create: `tests/fixtures/fake-tft-match-gateway.js`
- Modify: `scripts/e2e-server.js`, `scripts/playwright-global-setup.js`, `playwright.config.js`, `tests/manual-winner-graphics.test.js`, `.env.example`, `README.md`, `docs/TODO.md`

- [ ] **Step 1: Write failing E2E workflow**

The first preview process has empty Riot env and proves manual duplicate-slot Save/Live works. The controlled loopback restart installs a fake before nonempty test config, then imports a board with two mapped Zed slots at different stars plus one unmapped helper. Assert the omission note, no snapshot before Save, one eight-player snapshot after Save, duplicate slots in state/publication, and no Riot request.

- [ ] **Step 2: Verify RED**

Run: `pnpm test:e2e`  
Expected: FAIL at the fake gateway’s deliberate initial “not implemented” discovery error after the missing-config manual phase succeeds.

- [ ] **Step 3: Implement deterministic fake and cleanup**

The fake returns exactly one match; its counter must equal one in teardown. Force `RIOT_API_KEY=''` and `RIOT_REGION=''` before the disabled preview. The loopback-only control installs `globalThis[Symbol.for('tft-match-v1.gateway-factory')]` before enabling config and restarting preview. Cleanup `winner_board_state` before snapshot rows.

- [ ] **Step 4: Document and verify**

Add `RIOT_API_KEY=` and `RIOT_REGION=VN2` to `.env.example`; document optional server-only import, manual fallback, one-region constraint, ten newest sequential details, 15-minute previews, active-catalog omission behavior, and duplicate slot preservation. Update status wording in `docs/TODO.md`.

Run each separately:

```powershell
pnpm check
pnpm lint
pnpm exec vitest run --project server
pnpm exec vitest run --project client
pnpm test:e2e
pnpm build
git diff --check
rg -n "RIOT_API_KEY|apiKey" src/lib/components src/routes src/lib/tft-match.js
rg -n "fetch\(" src/lib/server/tft-matches --glob "!*.test.js"
rg -n "augments|\bwin\b" src/lib/server/tft-matches src/lib/components/admin/TftMatchImportDialog.svelte --glob "!*.test.js"
```

Expected: each command exits 0; safety searches show no browser API key, no application-owned TFT `fetch`, and no production augment/`win` import contract.

- [ ] **Step 5: Commit**

```powershell
git add tests scripts .env.example README.md docs/TODO.md drizzle docs/superpowers/plans/2026-08-14-tft-winner-import-ordered-unit-slots.md
git commit -m "test: cover duplicate TFT winner unit slots"
```

## Final Acceptance Checklist

- [ ] Repeated mapped champions retain independent order and star levels from import through publication.
- [ ] Unmapped occurrences are omitted and counted, never classified using a hard-coded helper list.
- [ ] The manual composer adds, moves, removes, and saves duplicate slots independently.
- [ ] Import preserves manual title/augments and remains unsaved until the original Save action.
- [ ] The exact eight-participant snapshot and editable board are atomic, while browsing has no database effects.
- [ ] Missing configuration preserves manual Winner Save/Live; automated tests use only injected fakes.
