# TFT-MATCH-V1 Winner Import — Agent Execution Plan

> **For agentic workers:** Use `subagent-driven-development`; implement each task test-first, review it against this plan, and record completion in `.superpowers/sdd/progress.md`.

**Goal:** Add an authenticated, Twisted-only admin workflow that previews one roster player's ten newest TFT matches, imports a champion-only board into the existing editable Winner composer, and persists an exact eight-player match snapshot only through the original Save action.

**Architecture:** Keep Riot configuration/gateway, response normalization, expiring in-memory preview cache, durable snapshot storage, and Winner transaction integration as separate layers. The browser receives only safe, opaque-token-backed projections and never supplies credentials, PUUIDs, or arbitrary match IDs. The existing Winner repository remains the single transaction and publication boundary.

**Tech Stack:** Svelte 5, SvelteKit form actions and endpoints, JavaScript/JSDoc, Zod, Twisted, Drizzle/SQLite, Vitest, Playwright, Skeleton/Tailwind.

## Global Constraints

- Use the supplied source plan, `docs/superpowers/plans/2026-08-12-tft-match-v1-winner-import.md`, as the authoritative detailed acceptance contract; this execution plan preserves every requirement and test gate.
- Riot API credentials remain server-only; tests must use injected fakes and never contact Riot.
- Preview data is process-local, opaque-token-backed, read-only, disposable after 15 minutes, and has no database writes until the existing Save action.
- Browse/import preserves manual title and augments; import updates only winner, champion order/star levels, and the transient source reference.
- Save atomically inserts an exact eight-participant snapshot with the editable board; manual saves clear the source reference without deleting history.
- Use no arbitrary match selection, no date-range/backfill query, no augments or `win` field in the canonical import contract, and no client serialization of API keys.

---

### Task 1: Lock response fixtures and the canonical contract

**Files:** Create `src/lib/tft-match.js`, its tests, and the recorded Riot payload fixture; update repository test setup only as needed.

- [ ] Add failing tests for Riot response parsing and the browser-safe champion-only DTO.
- [ ] Implement strict Zod normalization: one match has exactly eight unique participants, valid placement/tier/champion data, no augment/win contract, and a deterministic champion mapping surface.
- [ ] Run the focused server tests and commit the contract.

### Task 2: Add private configuration and a Twisted-only gateway

**Files:** Create `src/lib/server/tft-matches/config.js`, `gateway.js`, and tests; update `.env.example` only in Task 10.

- [ ] Add failing configuration and gateway selection tests.
- [ ] Implement safe missing-configuration availability, one configured region, Twisted-only calls, account lookup, ten newest IDs, sequential detail loading, and injected gateway-factory precedence.
- [ ] Verify focused tests and commit.

### Task 3: Build preview cache and discovery service

**Files:** Create `src/lib/server/tft-matches/cache.js`, `discovery.js`, and tests.

- [ ] Add failing tests for 15-minute opaque previews, roster identity validation, bounded discovery, partial-row disablement, expiry, and safe provider failures.
- [ ] Implement the cache and safe browser projection without database writes.
- [ ] Verify focused tests and commit.

### Task 4: Add append-only snapshot schema and repository

**Files:** Create `src/lib/server/db/schema/tft-matches.js`, migration `drizzle/0003_tft_match_snapshots.sql`; modify schema exports/tests; create `src/lib/server/tft-matches/repository.js` and tests.

- [ ] Add failing schema/repository tests for immutable snapshots and exactly eight persisted participants.
- [ ] Implement additive Drizzle schema, migration, snapshot/participant rows, and canonical serialization validation.
- [ ] Verify schema/repository tests and commit.

### Task 5: Integrate snapshot insertion into the Winner transaction

**Files:** Modify `src/lib/server/db/schema/winner-boards.js`, `src/lib/server/winner-boards/repository.js`, and repository tests.

- [ ] Add failing tests that prove source resolution/validation and snapshot insertion are atomic with Save and publication behavior remains unchanged.
- [ ] Add nullable source snapshot reference and transactional snapshot insertion; manual saves clear only the reference.
- [ ] Verify repository tests and commit.

### Task 6: Add authenticated discovery endpoint and Save-action resolution

**Files:** Create `src/routes/(admin)/admin/graphics/tft-matches/+server.js` and endpoint tests; modify `src/routes/(admin)/admin/graphics/+page.server.js` and `src/routes/(admin)/admin/admin-actions.test.js`.

- [ ] Add failing authorization, safe availability, discovery, expired-token, and Save source-resolution tests.
- [ ] Implement the protected endpoint and route-action handoff; never expose key, PUUID, raw payload, or arbitrary match selection.
- [ ] Verify endpoint/action tests and commit.

### Task 7: Build the accessible full-screen import dialog

**Files:** Create `src/lib/components/admin/TftMatchImportDialog.svelte` and browser test.

- [ ] Add failing browser tests for disabled prerequisites/reason, keyboard-safe dialog focus, roster eligibility, loading, selectable matches, row-level errors, vertical champion verification, cancel, and `Use this board` handoff.
- [ ] Implement the dialog using the safe endpoint contract; do not persist or display augments.
- [ ] Run the Svelte autofixer to zero findings, focused browser tests, and commit.

### Task 8: Hand imported state into the existing Winner composer

**Files:** Modify `src/lib/components/admin/WinnerBoardComposer.svelte`, `src/lib/components/admin/admin-components.svelte.test.js`, and `src/routes/(admin)/admin/graphics/+page.svelte`.

- [ ] Add failing integration tests for control-row placement, preserving title/augments, hidden token/match fields, dirty/live behavior, canonical save/reset/tournament transitions, and safe action failures.
- [ ] Wire the dialog without creating a second save form; propagate safe availability and clear transient source at each canonical baseline change.
- [ ] Run the Svelte autofixer on both components, focused client tests, checks, and commit.

### Task 9: Add deterministic two-phase E2E coverage

**Files:** Create `tests/fixtures/fake-tft-match-gateway.js`; modify `scripts/e2e-server.js`, `scripts/playwright-global-setup.js`, `playwright.config.js`, and `tests/manual-winner-graphics.test.js`.

- [ ] Add the initially failing injected gateway and two-phase loopback preview restart test: manual Save/Live works without configuration, then fake-enabled import persists one snapshot through Save.
- [ ] Replace the temporary failure with the deterministic fake contract, ensure one discovery call, safe cleanup order, no inherited Riot environment, and no network access.
- [ ] Verify E2E plus focused server tests and commit.

### Task 10: Document and release-verify

**Files:** Modify `.env.example`, `README.md`, and `docs/TODO.md`; stage this execution plan and the source plan artifact.

- [ ] Document optional server-only configuration, manual fallback, regional scope, and freshness policy; update status and future augment wording accurately.
- [ ] Format all changed paths and execute the source plan’s full check/lint/server/client/E2E/build/diff safety matrix.
- [ ] Run the explicit secret/network/augment/backfill safety searches, inspect migration scope, commit documentation, and record final verification evidence.

