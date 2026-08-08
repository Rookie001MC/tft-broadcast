# Operator Workflow and Data Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Put deliberate Save, Live, and Reset behavior in the singleton graphics workflow, make all operator data maintainable, preserve catalog corrections across same-set syncs, and prevent destructive actions from invalidating saved state.

**Architecture:** Page actions remain authenticated SvelteKit POST actions. Repositories own normalization, mutation validation, managed-media staging, and reset-required dependency checks; a shared destructive transaction clears the singleton and hides the graphic before deleting or excluding a referenced record. Catalog corrections are separately persisted, then materialized into each active snapshot after upstream normalization and before activation.

**Tech Stack:** SvelteKit 2 form actions, Svelte 5 runes, Skeleton Svelte 5, JavaScript with JSDoc, Drizzle/libSQL SQLite, file-type, Vitest browser/server projects, Playwright.

## Global Constraints

- This plan depends on the singleton saved-state and immutable-publication contracts from the Integrity Foundation workstream.
- Form fields are local until Save. A saved state belongs to one tournament; changing tournament requires Reset confirmation.
- Live-on is disallowed for dirty or invalid local form state. Save while live publishes a new immutable version; Save while hidden only replaces saved state.
- Every mutation requires requireAdmin. Expected errors use action-specific safe messages and 400, 409, or 422 statuses.
- Deletion or resource exclusion that conflicts with saved state must recheck its dependency inside the server transaction. Client confirmation alone is not authority.
- Player/tournament edits and catalog correction edits never mutate an existing publication.
- Manual catalog images are optional. Exclusion is reversible; corrections apply only to the same canonical set key or, without one, the exact patch scope.
- Modal dialogs have title/description labels, trap focus, close with Escape, restore focus to their initiating control, and prevent duplicate submits.

---

## File Structure

- src/lib/server/winner-boards/repository.js and maintenance.test.js: saved-state dependency lookup plus atomic reset-and-destroy primitives.
- src/lib/server/players/repository.js, player-images.js, and tests: player edit, validated image replacement/removal, and safe delete.
- src/lib/server/tournaments/repository.js and tests: tournament edit/slug normalization and safe delete.
- src/lib/server/db/schema/catalog.js, catalog-corrections.js, catalog-sync.js, catalog-media.js, and tests: correction persistence, materialization, optional manual media, and transactional sync activation.
- src/lib/server/admin/load.js and import/staging.js: load persisted preview status as the authoritative import view.
- Player, tournament, game-resource, and graphics page server files: named authenticated actions.
- PlayerImportPanel.svelte, WinnerBoardComposer.svelte, CatalogManager.svelte, player/tournament pages, graphics page, and new ResetRequiredDialog.svelte: deliberate operator feedback and confirmed destructive flows.
- Admin browser tests, action tests, catalog sync tests, staging tests, and manual-winner-graphics.test.js: component, route, and workflow regressions.

---

### Task 1: Define maintenance and UI regression tests

**Files:**

- Modify: src/lib/server/players/repository.test.js
- Modify: src/lib/server/tournaments/repository.test.js
- Modify: src/lib/server/catalog/catalog-sync.test.js
- Modify: src/lib/server/import/staging.test.js
- Create: src/lib/server/winner-boards/maintenance.test.js
- Modify: src/routes/(admin)/admin/admin-actions.test.js
- Modify: src/lib/components/admin/admin-components.svelte.test.js

**Interfaces:**

- Produces failing tests for maintenance APIs, reset-required conflicts, correction reapplication, import preview status, and the redesigned composer controls.

- [ ] **Step 1: Add repository tests for player and tournament maintenance**

Cover changing all player identity fields, duplicate normalized Riot ID, image write failure preserving the old image, image removal, ordinary delete, and delete when the player is current winner. Cover tournament rename/slug normalization/unique collision, normal delete, and current-state tournament delete.

~~~js
await expect(deletePlayer(db, { playerId: 'winner', confirmReset: false })).resolves.toMatchObject({
	kind: 'reset_required',
	label: 'Winner One'
});
await expect(deletePlayer(db, { playerId: 'winner', confirmReset: true })).resolves.toMatchObject({
	deleted: true,
	reset: true
});
~~~

- [ ] **Step 2: Add catalog correction tests**

Seed two snapshots with different canonical set keys. Test add, partial override, exclude, restore, optional manual image, correction reapplication into a later same-set snapshot, isolation from a different set, and correction failure preserving the previously active snapshot.

- [ ] **Step 3: Add action/component workflow tests**

Assert anonymous callers receive the existing auth rejection for every new action. Assert no draft picker or separate LiveControls panel, dirty state blocks Live-on, Save hidden/live behavior, Reset/tournament-confirmation behavior, committed import confirmation unavailable after rerender and reload, and dialog keyboard/focus behavior.

- [ ] **Step 4: Run the red suite**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/server/players/repository.test.js src/lib/server/tournaments/repository.test.js src/lib/server/catalog/catalog-sync.test.js src/lib/server/import/staging.test.js src/lib/server/winner-boards/maintenance.test.js src/routes/(admin)/admin/admin-actions.test.js
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js
~~~

Expected: FAIL because the current repositories expose create/roster operations only and the component still uses a draft picker and independent live panel.

- [ ] **Step 5: Commit**

~~~powershell
git add src/lib/server/players/repository.test.js src/lib/server/tournaments/repository.test.js src/lib/server/catalog/catalog-sync.test.js src/lib/server/import/staging.test.js src/lib/server/winner-boards/maintenance.test.js src/routes/(admin)/admin/admin-actions.test.js src/lib/components/admin/admin-components.svelte.test.js
git commit -m "test: define operator maintenance regressions"
~~~

### Task 2: Add catalog-correction persistence and materialization

**Files:**

- Modify: src/lib/server/db/schema/catalog.js
- Modify: src/lib/server/db/schema/index.js
- Create: src/lib/server/catalog/catalog-corrections.js
- Create: src/lib/server/catalog/catalog-corrections.test.js
- Modify: src/lib/server/catalog/catalog-sync.js
- Modify: src/lib/server/catalog/catalog-sync.test.js
- Modify: src/lib/server/catalog/catalog-media.js
- Create: drizzle/0002_catalog_corrections.sql
- Modify: drizzle/meta/_journal.json
- Create: drizzle/meta/0002_snapshot.json

**Interfaces:**

- Produces catalogCorrections and materialized catalog resource fields isExcluded, provenanceJson, and correctionId.
- Produces applyCatalogCorrections, createCatalogCorrection, updateCatalogCorrection, excludeCatalogResource, and restoreCatalogResource.

- [ ] **Step 1: Add the correction schema**

Add a catalog_corrections table with canonicalSetKey, patchLabel, resourceKind, operation, targetExternalId, manualExternalId, displayNameOverride, tierOverride, imagePathOverride, createdAt, and updatedAt. Add nullable correctionId, isExcluded default false, and provenanceJson default upstream metadata to both catalog resource tables.

~~~js
resourceKind: text('resource_kind', { enum: ['champion', 'augment'] }).notNull(),
operation: text('operation', { enum: ['add', 'override', 'exclude'] }).notNull(),
canonicalSetKey: text('canonical_set_key'),
patchLabel: text('patch_label').notNull()
~~~

Use a check in repository validation: add requires manualExternalId, override/exclude require targetExternalId, and a source without a canonical key matches only patchLabel.

- [ ] **Step 2: Implement correction application as a pure boundary**

Normalize upstream resources first, then transform plain records through corrections before database activation. Add inserts a manual resource with provenance; override changes only supplied fields; exclude marks a target hidden; restoring removes the active exclusion. Treat a manual engine-ID correction as exclude old plus add new, never as a changed upstream key.

~~~js
const materialized = applyCatalogCorrections({
	resources: normalizedResources,
	corrections,
	canonicalSetKey,
	patchLabel
});
~~~

The returned list must have unique external IDs per resource kind and each entry must include provenanceJson.

- [ ] **Step 3: Apply corrections before transactional activation**

After snapshot normalization and image staging, load only matching corrections, materialize champions/augments, stage optional manual images in controlled media, and insert snapshot/resources in the same transaction that sets tournaments.activeCatalogSnapshotId. If correction application or insert fails, remove staged assets and leave the old active snapshot unchanged.

- [ ] **Step 4: Generate migration and verify**

Run pnpm db:generate and verify the generated migration on an existing fixture database. Run:

~~~powershell
pnpm exec vitest run --project server src/lib/server/catalog/catalog-corrections.test.js src/lib/server/catalog/catalog-sync.test.js src/lib/server/db/schema/schema.test.js
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~powershell
git add src/lib/server/db/schema/catalog.js src/lib/server/db/schema/index.js src/lib/server/catalog drizzle
git commit -m "feat: persist catalog corrections"
~~~

### Task 3: Implement safe mutable player, tournament, and catalog operations

**Files:**

- Modify: src/lib/server/winner-boards/repository.js
- Create: src/lib/server/winner-boards/maintenance.js
- Create: src/lib/server/winner-boards/maintenance.test.js
- Modify: src/lib/server/players/repository.js
- Modify: src/lib/server/players/repository.test.js
- Modify: src/lib/server/media/player-images.js
- Modify: src/lib/server/tournaments/repository.js
- Modify: src/lib/server/tournaments/repository.test.js
- Modify: src/lib/server/catalog/catalog-corrections.js

**Interfaces:**

- Produces inspectSavedStateDependency, resetStateAndRun, updatePlayer, replacePlayerImage, removePlayerImage, deletePlayer, updateTournament, deleteTournament, and safe catalog exclusion.

- [ ] **Step 1: Implement a shared server-side reset-required transaction**

Return only an action kind and safe display label before confirmation. On confirmation, reopen a write transaction, re-read the target and singleton dependency, clear saved state and live pointer through the Integrity Foundation API, then execute the target mutation. If any check fails, roll back every change.

~~~js
export async function resetStateAndRun(database, { target, operation }) {
	return database.transaction(async (transaction) => {
		const dependency = await inspectSavedStateDependency(transaction, target);
		if (!dependency) return { kind: 'not_required' };
		await resetWinnerBoardStateInTransaction(transaction);
		await operation(transaction);
		return { kind: 'reset_complete' };
	});
}
~~~

Use the existing serialized live-write queue for operations that may hide a live publication.

- [ ] **Step 2: Implement player media staging and CRUD**

Use normalizeRiotId for either a full Riot ID or matching game/tag fields. Write replacement image bytes to a generated contained path and signature-check before updating the row. On transaction failure delete only the new staged file; after commit remove the previous image. Do not delete a prior working image on failed replacement.

~~~js
await updatePlayer(db, {
	playerId,
	fullName,
	displayName,
	riotId: riotId || null
});
~~~

deletePlayer returns reset_required without confirmReset and uses resetStateAndRun after confirmation when it is the saved winner.

- [ ] **Step 3: Implement tournament CRUD**

Normalize supplied slugs with the current slug helper, reject an empty or duplicate normalized slug, update timestamps, and return canonical records. deleteTournament uses the same reset flow when it is current state tournament; retain existing tournament-player cascading once the dependency checks pass.

- [ ] **Step 4: Make catalog hide/restore safe**

excludeCatalogResource returns reset_required when the resource is selected in saved state. Confirmed exclusion uses the shared transaction. Display-name, tier, and image correction changes are non-destructive and leave live publication data alone.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/server/winner-boards/maintenance.test.js src/lib/server/players/repository.test.js src/lib/server/tournaments/repository.test.js src/lib/server/catalog/catalog-corrections.test.js
pnpm check
~~~

Expected: PASS.

~~~powershell
git add src/lib/server/winner-boards src/lib/server/players src/lib/server/media/player-images.js src/lib/server/tournaments src/lib/server/catalog/catalog-corrections.js
git commit -m "feat: protect destructive operator maintenance"
~~~

### Task 4: Wire authenticated page actions and authoritative import status

**Files:**

- Modify: src/lib/server/admin/load.js
- Modify: src/lib/server/import/staging.js
- Modify: src/lib/server/import/staging.test.js
- Modify: src/routes/(admin)/admin/players/+page.server.js
- Modify: src/routes/(admin)/admin/tournaments/+page.server.js
- Modify: src/routes/(admin)/admin/game-resources/+page.server.js
- Modify: src/routes/(admin)/admin/graphics/+page.server.js
- Modify: src/routes/(admin)/admin/admin-actions.test.js

**Interfaces:**

- Player actions: createPlayer, updatePlayer, replacePlayerImage, removePlayerImage, deletePlayer, confirmDeletePlayer.
- Tournament actions: createTournament, updateTournament, deleteTournament, confirmDeleteTournament plus existing roster actions.
- Catalog actions: createCorrection, updateCorrection, excludeResource, restoreResource, confirmExcludeResource, and existing syncCatalog.

- [ ] **Step 1: Load persisted import state**

Change loadAdminData to return the most recent preview record including token, preview JSON, status, expiresAt, committedAt if added, and result summary. Do not promote a form response over the persisted record after a commit.

- [ ] **Step 2: Make staging report terminal status**

After a successful commit, store status committed and a serializable committed summary. Expired/missing staged data returns an unavailable state. A repeated token fails closed before any player/media write.

~~~js
return {
	token: preview.token,
	status: 'committed',
	committedAt: now,
	summary: { created, updated, skipped }
};
~~~

- [ ] **Step 3: Add named actions with safe parsing**

Every action starts with requireAdmin, reads only expected form fields, calls the relevant repository API, and maps uniqueness/conflict errors to actionFailure with 409. Confirmation actions must recompute dependencies; they do not accept a client-provided dependency claim.

- [ ] **Step 4: Verify route authorization and statuses**

Run:

~~~powershell
pnpm exec vitest run --project server src/routes/(admin)/admin/admin-actions.test.js src/lib/server/import/staging.test.js
~~~

Expected: PASS, including anonymous rejection of every mutation.

- [ ] **Step 5: Commit**

~~~powershell
git add src/lib/server/admin/load.js src/lib/server/import/staging.js src/lib/server/import/staging.test.js src/routes/(admin)/admin
git commit -m "feat: add authenticated maintenance actions"
~~~

### Task 5: Build the deliberate composer and maintenance interfaces

**Files:**

- Create: src/lib/components/admin/ResetRequiredDialog.svelte
- Modify: src/lib/components/admin/WinnerBoardComposer.svelte
- Delete: src/lib/components/admin/LiveControls.svelte
- Modify: src/routes/(admin)/admin/graphics/+page.svelte
- Modify: src/lib/components/admin/PlayerImportPanel.svelte
- Modify: src/routes/(admin)/admin/players/+page.svelte
- Modify: src/routes/(admin)/admin/tournaments/+page.svelte
- Modify: src/lib/components/admin/CatalogManager.svelte
- Modify: src/routes/(admin)/admin/game-resources/+page.svelte
- Modify: src/lib/components/admin/admin-components.svelte.test.js

**Interfaces:**

- WinnerBoardComposer receives savedBoard, livePublicationId, roster, activeCatalog, and form; it owns the title header, status, live switch, Save, Reset, and exact preview.
- ResetRequiredDialog receives open, title, description, confirmAction, hidden inputs, and invoking control focus reference.

- [ ] **Step 1: Move all graphics actions into the composer**

Render title, saved/unsaved state, live switch, Save, Reset, and Open gfx link in composer header. Calculate dirty from a normalized local form snapshot versus the last loaded/successfully saved state. Disable Live-on while dirty with text explaining that Save is required.

~~~js
const dirty = $derived(JSON.stringify(normalizedForm(composer)) !== JSON.stringify(savedForm));
const liveOnDisabled = $derived(dirty || !previewBoard || submitting);
~~~

After Save, take the returned canonical board as the new baseline. After every live/reset action, use server-returned state instead of optimistic local state.

- [ ] **Step 2: Add reset and tournament-change confirmation**

Use one accessible dialog component based on native dialog showModal and close semantics. It traps focus when modal, cancels on Escape, restores the invoking focus, has labelled title/description, and posts to the appropriate confirm action. Selecting another tournament while state exists opens this dialog; confirm resets then loads the requested tournament, cancel restores the existing select/form.

- [ ] **Step 3: Add player and tournament tables/forms**

Add visible edit controls for every required field, optional Riot identity, controlled image upload/replace/remove, and destructive delete flow. Add tournament name and slug edit forms plus destructive delete. Render action-specific success/error notices and disable submitting controls.

- [ ] **Step 4: Add catalog correction controls**

Render source/correction provenance, add/edit/hide/restore controls, optional manual image input, and a deliberate placeholder for image-less manual entries. Keep sync progress outside resource maintenance controls. Hide and restore use the dialog if the resource is selected by state.

- [ ] **Step 5: Render terminal import status**

When persisted status is previewed and valid/unexpired, show validation rows and exact confirmation. When committed, show committed timestamp and summary with no enabled confirm control. When expired, missing, or staged file unavailable, require a new preview.

- [ ] **Step 6: Run Svelte autofixer and browser verification**

Run the Svelte autofixer on every modified or created Svelte file until no issue or suggestion remains. Then run:

~~~powershell
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js
pnpm check
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~powershell
git add src/lib/components/admin src/routes/(admin)/admin
git rm src/lib/components/admin/LiveControls.svelte
git commit -m "feat: complete operator maintenance workflow"
~~~

### Task 6: Execute workstream verification

**Files:**

- Modify: tests/manual-winner-graphics.test.js
- Modify: README.md

**Interfaces:**

- Produces an E2E workflow covering maintenance, reset protection, committed import state, Save/Live/Reset, and immutable live behavior.

- [ ] **Step 1: Extend the existing Playwright workflow**

Cover a player edit, safe image replacement/removal, tournament rename, manual catalog addition without image, correction/exclude/restore, committed preview reload, dirty-Live prevention, live save/new publication, reset confirmation, and an unchanged old publication after maintenance.

- [ ] **Step 2: Document operator behavior**

Update the operator workflow to say Save is the deliberate gate, Live-on publishes saved data, Save while live publishes a new immutable version, and destructive operations may require Reset.

- [ ] **Step 3: Run all gates**

Run:

~~~powershell
pnpm exec vitest run
pnpm check
pnpm lint
pnpm test:e2e
~~~

Expected: PASS.

- [ ] **Step 4: Commit**

~~~powershell
git add tests/manual-winner-graphics.test.js README.md
git commit -m "test: verify operator maintenance workflow"
~~~

## Workstream Exit Criteria

- Every admin mutation rejects anonymous requests.
- A destructive action cannot leave an invalid saved state and cannot mutate an existing publication.
- Same-set syncs reapply corrections; different sets do not inherit them.
- Committed imports remain visibly terminal after rerender and reload.
- pnpm exec vitest run, pnpm check, pnpm lint, and pnpm test:e2e pass.
