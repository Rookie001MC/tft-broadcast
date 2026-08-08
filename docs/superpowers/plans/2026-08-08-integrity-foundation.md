# Integrity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace mutable winner-board drafts and live joins with a single saved state plus immutable publication payloads and media, and enforce ZIP limits from bytes emitted by decompression streams.

**Architecture:** winner_board_state.current is the sole editable board and has ordered state children. Publishing validates that state, copies its managed media to a unique publication directory, then a serialized database transaction stores an immutable render JSON payload, advances graphic_state to the publication, and increments its version.

**Tech Stack:** SvelteKit 2, Svelte 5, JavaScript with JSDoc, Drizzle/libSQL SQLite, yauzl, file-type, Vitest 4, Playwright.

## Global Constraints

- Preserve the 25 MiB compressed input limit, 500 entry limit, and 100 MiB total emitted decompressed-byte limit.
- Keep exactly one saved board across the installation. Champion count is unbounded; unique augment count is zero through three at the repository boundary.
- A publication must never join players, catalog_champions, or catalog_augments after it is stored.
- Publication media URLs include the publication ID and generated file name; responses use nosniff and one-year immutable caching.
- Successful publication, hide, and live reset increment graphic_state.version once. Hiding an already-hidden graphic does not increment it.
- The old live pointer is cleared during migration; the operator deliberately enables Live under the new contract.
- The pre-existing Vite E2E suite must be made repeatable before it becomes this workstream's gate.
- Take a database backup before the production migration rehearsal.

---

## File Structure

- src/lib/server/import/player-bundle.js and player-bundle.test.js: streamed expansion accounting and adversarial ZIP tests.
- src/lib/server/db/schema/winner-boards.js and schema/index.js: singleton state, state children, immutable publications, and updated graphic pointer.
- drizzle/0001_integrity_foundation.sql and drizzle/meta: data-preserving replacement of legacy board tables.
- src/lib/server/winner-boards/repository.js and repository.test.js: state replacement, publish, live switch, reset, payload-only reads, and version behavior.
- src/lib/server/winner-boards/publication-media.js and publication-media.test.js: prepare, validate, clean up, and read publication-scoped media.
- src/routes/media/publications/[publicationId]/[filename]/+server.js and media.test.js: controlled immutable asset endpoint.
- src/lib/winner-board.js, gfx route files, admin graphics route files, WinnerBoardComposer.svelte, LiveControls.svelte, component tests, and manual-winner-graphics.test.js: use the singleton/publication contract without a draft picker.

---

### Task 1: Stabilize the existing Vite E2E fixture boundary

**Files:**

- Modify: tests/manual-winner-graphics.test.js

**Interfaces:**

- Produces a short-lived direct fixture database client used only for setup/reset and catalog seeding. All operator/auth mutations remain browser requests to the running application.

- [ ] **Step 1: Capture the failing baseline**

Run the existing Vite workflow twice:

~~~powershell
pnpm test:e2e
pnpm test:e2e
~~~

Expected before the change: the publish assertion can fail after Better Auth logs SQLITE_BUSY while querying the session/user. Record the first failing stack and do not treat this as an Integrity Foundation behavior failure.

- [ ] **Step 2: Remove the long-lived fixture client**

Pass a client argument into resetDatabase and seedCatalog. Open it only inside a helper and always close it before subsequent browser traffic:

~~~js
async function withFixtureDatabase(operation) {
	const fixture = createClient({ url: 'file:test-e2e.db' });
	try {
		return await operation(fixture);
	} finally {
		fixture.close();
	}
}

test.beforeAll(() => withFixtureDatabase((database) => resetDatabase(database)));
await withFixtureDatabase((database) => seedCatalog(database, tournamentId));
~~~

Delete the module-level client and the afterAll close. Do not write directly to test-e2e.db after the seed helper returns.

- [ ] **Step 3: Verify the fixture race is absent**

Run:

~~~powershell
pnpm test:e2e
pnpm test:e2e
~~~

Expected: both runs PASS through publish/hide with no Better Auth SQLITE_BUSY output.

- [ ] **Step 4: Commit**

~~~powershell
git add tests/manual-winner-graphics.test.js
git commit -m "test: isolate Vite E2E fixture database"
~~~

### Task 2: Characterize the integrity regressions

**Files:**

- Modify: src/lib/server/import/player-bundle.test.js
- Modify: src/lib/server/winner-boards/repository.test.js
- Create: src/lib/server/winner-boards/publication-media.test.js
- Modify: src/routes/(gfx)/gfx/version/version.test.js
- Modify: src/routes/(admin)/admin/admin-actions.test.js

**Interfaces:**

- Produces failing tests for inspectPlayerBundle, the singleton state API, immutable publication payload/media, and ETag version transitions.

- [ ] **Step 1: Add decompression-stream boundary tests**

Add a ZIP fixture helper with a central-directory expanded size lower than its actual stored payload. Assert rejection as soon as a single entry or all entries emit more than 100 MiB, and assert the current stream is destroyed and the ZIP closes once.

~~~js
await expect(inspectPlayerBundle(zipWithDeclaredSize(1, emittedBytes), [])).rejects.toThrow(
	'ZIP expanded size is too large'
);
~~~

Also assert exactly-at-limit content passes and no rejected entry is returned from a buffered result.

- [ ] **Step 2: Replace draft tests with the singleton contract**

Define tests for save while hidden, enable Live from persisted state, save while live creating a distinct publication/version, hide, no-op hide, hidden Reset, and live Reset. Test that four augments reject and a large champion list succeeds.

~~~js
const state = await saveWinnerBoardState(db, validInput);
expect(state.id).toBe('current');
await expect(
	saveWinnerBoardState(db, { ...validInput, augmentIds: ['a1', 'a2', 'a3', 'a4'] })
).rejects.toThrow('At most three augments are allowed');
~~~

- [ ] **Step 3: Add media immutability and migration cases**

Seed current player/catalog images, publish, then edit the source rows and replace source files. Assert the first payload and bytes are unchanged and a later save-live yields a new publication ID. Seed legacy data for both a live-referenced board and draft-only boards; assert the chosen row becomes current and the live pointer is null.

- [ ] **Step 4: Run the red suite**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/server/import/player-bundle.test.js src/lib/server/winner-boards/repository.test.js src/lib/server/winner-boards/publication-media.test.js src/routes/(gfx)/gfx/version/version.test.js
~~~

Expected: FAIL because current code trusts metadata and has only draft/published/hidden board rows.

- [ ] **Step 5: Commit**

~~~powershell
git add src/lib/server/import/player-bundle.test.js src/lib/server/winner-boards src/routes/(gfx)/gfx/version src/routes/(admin)/admin/admin-actions.test.js
git commit -m "test: define integrity foundation regressions"
~~~

### Task 3: Migrate database storage to a singleton and publications

**Files:**

- Modify: src/lib/server/db/schema/winner-boards.js
- Modify: src/lib/server/db/schema/index.js
- Create: drizzle/0001_integrity_foundation.sql
- Modify: drizzle/meta/_journal.json
- Create: drizzle/meta/0001_snapshot.json
- Modify: src/lib/server/db/schema/schema.test.js

**Interfaces:**

- Produces winnerBoardState, winnerBoardStateChampions, winnerBoardStateAugments, winnerBoardPublications, and graphicState.publishedPublicationId.
- Retires winnerBoards and its two child tables after their migration copy succeeds.

- [ ] **Step 1: Write the schema export test**

Extend schema.test.js to require every new table symbol and to require singleton primary keys on state and graphicState. Preserve all unrelated auth, catalog, player, tournament, import, and setup exports.

- [ ] **Step 2: Define the new tables**

Replace the legacy schema exports with this table shape. State-child rows use onDelete cascade from state and onDelete restrict from catalog.

~~~js
export const winnerBoardState = sqliteTable('winner_board_state', {
	id: text('id').primaryKey(),
	tournamentId: text('tournament_id').notNull().references(() => tournaments.id),
	winnerPlayerId: text('winner_player_id').notNull().references(() => players.id),
	title: text('title').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const winnerBoardPublications = sqliteTable('winner_board_publications', {
	id: text('id').primaryKey(),
	sourceStateUpdatedAt: integer('source_state_updated_at', { mode: 'timestamp_ms' }).notNull(),
	graphicVersion: integer('graphic_version').notNull().unique(),
	renderPayloadJson: text('render_payload_json').notNull(),
	mediaDirectory: text('media_directory').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});
~~~

Update graphicState to reference publishedPublicationId with onDelete set null.

- [ ] **Step 3: Generate a safe data migration**

Run pnpm db:generate. In the migration, create the new tables; copy only the board referenced by graphic_state when present, otherwise the most recently updated draft; copy its children ordered by display_order; set the new live pointer to null; and only then drop legacy board tables.

~~~sql
INSERT INTO winner_board_state (id, tournament_id, winner_player_id, title, created_at, updated_at)
SELECT 'current', tournament_id, winner_player_id, title, created_at, updated_at
FROM winner_boards
WHERE id = (
	SELECT COALESCE(
		(SELECT published_winner_board_id FROM graphic_state WHERE id = 'live'),
		(SELECT id FROM winner_boards WHERE status = 'draft' ORDER BY updated_at DESC LIMIT 1)
	)
);
~~~

Do not create a saved state if no legacy board exists.

- [ ] **Step 4: Verify clean and upgrade paths**

Migrate a clean temporary database and a temporary database first migrated to the existing 0000 schema then seeded with each legacy selection case. Assert PRAGMA foreign_key_check returns no rows and the regression migration expectations pass.

- [ ] **Step 5: Commit**

~~~powershell
git add src/lib/server/db/schema/winner-boards.js src/lib/server/db/schema/index.js src/lib/server/db/schema/schema.test.js drizzle
git commit -m "feat: persist singleton winner board publications"
~~~

### Task 4: Count actual decompressed stream bytes

**Files:**

- Modify: src/lib/server/import/player-bundle.js
- Modify: src/lib/server/import/player-bundle.test.js

**Interfaces:**

- Produces one bounded read-entry helper shared by inspection and image extraction.

- [ ] **Step 1: Keep metadata only as an early rejection**

Retain existing compressed input, entry-count, encryption, symlink, path, nested-archive, and allowed-location validation. Do not add entry.uncompressedSize to an authoritative counter.

- [ ] **Step 2: Implement a shared stream counter**

Open each selected entry stream, increment its own and the operation total before buffering a chunk, and destroy the stream immediately on either excess.

~~~js
entryBytes += chunk.length;
counters.total += chunk.length;
if (entryBytes > MAX_EXPANDED_BYTES || counters.total > MAX_EXPANDED_BYTES) {
	stream.destroy(new Error('ZIP expanded size is too large'));
	return;
}
chunks.push(chunk);
~~~

The helper removes listeners, closes the ZIP exactly once, and settles once across data, error, end, and close events.

- [ ] **Step 3: Route CSV and image reads through the counter**

Use a shared counter for all content read during inspectPlayerBundle and another shared counter for all selected image reads. Preserve the exact requested-image path check.

- [ ] **Step 4: Verify and commit**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/server/import/player-bundle.test.js src/lib/server/import/staging.test.js
pnpm check
~~~

Expected: PASS.

~~~powershell
git add src/lib/server/import/player-bundle.js src/lib/server/import/player-bundle.test.js
git commit -m "fix: count streamed ZIP expansion bytes"
~~~

### Task 5: Create and serve immutable publication media

**Files:**

- Create: src/lib/server/winner-boards/publication-media.js
- Create: src/lib/server/winner-boards/publication-media.test.js
- Create: src/routes/media/publications/[publicationId]/[filename]/+server.js
- Create: src/routes/media/publications/[publicationId]/[filename]/media.test.js
- Modify: src/lib/server/media/player-images.js

**Interfaces:**

- Produces preparePublicationMedia, discardPublicationMedia, and readPublicationMedia.
- Media references in a render payload are a controlled URL or null.

- [ ] **Step 1: Add media tests**

Cover PNG/JPEG/WebP source bytes, absent optional image, invalid source bytes, generated names, cleanup after transaction failure, and missing media returning a generic 404 without an absolute path.

- [ ] **Step 2: Implement contained media preparation**

Create MEDIA_ROOT/publications/<uuid>, validate every non-null source using fileTypeFromBuffer, write generated names inside that directory, and return only controlled URLs.

~~~js
return {
	relativeDirectory: 'publications/' + publicationId,
	url: '/media/publications/' + publicationId + '/' + filename
};
~~~

- [ ] **Step 3: Add the publication-media endpoint**

Validate the UUID and generated filename parameters, read only through the contained-path helper, redetect MIME, and return:

~~~js
{
	'Content-Type': asset.mime,
	'X-Content-Type-Options': 'nosniff',
	'Cache-Control': 'public, max-age=31536000, immutable'
}
~~~

- [ ] **Step 4: Verify and commit**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/server/winner-boards/publication-media.test.js src/routes/media/publications/[publicationId]/[filename]/media.test.js
~~~

Expected: PASS.

~~~powershell
git add src/lib/server/winner-boards/publication-media.js src/lib/server/winner-boards/publication-media.test.js src/routes/media/publications
git commit -m "feat: snapshot immutable publication media"
~~~

### Task 6: Implement singleton state, publish, hide, and reset

**Files:**

- Modify: src/lib/server/winner-boards/repository.js
- Modify: src/lib/server/winner-boards/repository.test.js
- Modify: src/lib/winner-board.js

**Interfaces:**

- Produces getWinnerBoardState, saveWinnerBoardState, setWinnerBoardLive, resetWinnerBoardState, getPublishedWinnerBoard, and getGraphicVersion.

- [ ] **Step 1: Define saved-state and immutable-payload JSDoc**

The editable view contains current player/catalog identifiers. The publication payload contains title, tournament identity, winner identifier/name/Riot ID/immutable image URL, ordered champion identifier/name/immutable image URL/star/order, and ordered augment identifier/name/immutable image URL/order.

- [ ] **Step 2: Centralize validation**

Retain roster and active-snapshot validation and implement:

~~~js
if (input.champions.length === 0) throw new Error('At least one champion is required');
if (input.augmentIds.length > 3) throw new Error('At most three augments are allowed');
assertUnique(input.champions.map((item) => item.catalogChampionId), 'Champion IDs must be unique');
assertUnique(input.augmentIds, 'Augment IDs must be unique');
~~~

- [ ] **Step 3: Implement transactions**

saveWinnerBoardState always replaces current and its ordered children. When live, it prepares media before the transaction, replaces state, inserts payload/publication, advances the pointer, and increments once. On failure, delete only the unreferenced new directory. setWinnerBoardLive(true) validates persisted current state and creates a publication. setWinnerBoardLive(false) clears a live pointer only when one exists. resetWinnerBoardState removes current state and conditionally clears live/increments.

- [ ] **Step 4: Make published reads JSON-only**

Validate JSON when storing and reading. getPublishedWinnerBoard selects the publication referenced by graphic_state and parses its payload; it must not join current player or catalog tables.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/server/winner-boards/repository.test.js src/lib/server/db/schema/schema.test.js
pnpm check
~~~

Expected: PASS.

~~~powershell
git add src/lib/server/winner-boards/repository.js src/lib/server/winner-boards/repository.test.js src/lib/winner-board.js
git commit -m "feat: publish immutable winner board payloads"
~~~

### Task 7: Adapt admin and broadcast to the new contract

**Files:**

- Modify: src/routes/(admin)/admin/graphics/+page.server.js
- Modify: src/routes/(admin)/admin/graphics/+page.svelte
- Modify: src/lib/components/admin/WinnerBoardComposer.svelte
- Modify: src/lib/components/admin/LiveControls.svelte
- Modify: src/routes/(gfx)/gfx/+page.server.js
- Modify: src/routes/(gfx)/gfx/+page.svelte
- Modify: src/routes/(gfx)/gfx/version/+server.js
- Modify: src/lib/components/admin/admin-components.svelte.test.js
- Modify: tests/manual-winner-graphics.test.js

**Interfaces:**

- Graphics load returns savedBoard and livePublicationId, never drafts or selectedBoardId.
- saveBoard has no boardId field; setLive uses enabled true or false; resetBoard has no client target.

- [ ] **Step 1: Rewrite graphics actions**

Parse existing field names into one state input and call the new APIs.

~~~js
return { action: 'saveBoard', board: await saveWinnerBoardState(db, input) };
return { action: 'setLive', live: await setWinnerBoardLive(db, text(form.get('enabled')) === 'true') };
return { action: 'resetBoard', result: await resetWinnerBoardState(db) };
~~~

- [ ] **Step 2: Remove multiple-board UI**

Initialize the composer from savedBoard or an empty selected tournament. Remove draft selection and board IDs. Keep the existing separate controls only as a temporary working placement; the next workstream moves them into the composer.

- [ ] **Step 3: Preserve public polling**

The gfx loader returns only immutable payload plus getGraphicVersion. Preserve quoted gfx version ETags and 304 handling. Test already-open and freshly-opened graphics display identical payload after player/catalog edits.

- [ ] **Step 4: Run Svelte autofixer**

Pass every modified Svelte component to the Svelte autofixer until it reports no issue or suggestion.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
pnpm exec vitest run
pnpm check
pnpm lint
pnpm test:e2e
~~~

Expected: PASS.

~~~powershell
git add src/routes/(admin)/admin/graphics src/lib/components/admin/WinnerBoardComposer.svelte src/lib/components/admin/LiveControls.svelte src/routes/(gfx) tests/manual-winner-graphics.test.js
git commit -m "feat: use singleton board state in graphics workflow"
~~~

## Workstream Exit Criteria

- Focused ZIP, repository, media, route, browser, and E2E checks pass.
- pnpm exec vitest run, pnpm check, pnpm lint, and pnpm test:e2e pass.
- The saved-draft collection, mutable publication joins, and legacy live pointer are removed.
