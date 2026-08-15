# Winner Composer Unit Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the Winner composer to save, reload, preview, and publish ordered duplicate champion instances with independent star levels.

**Architecture:** Keep the existing database schema and manual-first save/publication flow. Represent selected champions as instance objects in the browser, submit catalog IDs and star levels as aligned ordered form arrays, and relax only champion uniqueness checks at the repository and immutable-publication boundaries.

**Tech Stack:** Svelte 5 runes, SvelteKit form actions and progressive enhancement, JavaScript with JSDoc, Drizzle ORM/SQLite, Skeleton UI v5, Vitest server/browser projects, Playwright.

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-15-winner-composer-unit-instances-design.md` as authoritative.
- A champion may be added to the board any number of times.
- Every selected champion instance has its own star level of `null`, `1`, `2`, or `3`.
- Champion instances retain their selection order through preview, save, reload, and publication.
- All champion rows in the tournament's active catalog are eligible for manual selection, including helper, summon, and minion units.
- Augments remain unique and limited to three.
- Draft changes must not affect the live graphic until the existing save/publication boundary advances it.
- Do not add a database migration, unit-type whitelist, drag-and-drop ordering, or TFT-MATCH-V1 integration.
- Preserve the existing fixed 1920x1080 Winner renderer and Skeleton UI language.

---

## File Structure

- `src/lib/server/winner-boards/repository.js` owns save-scope and immutable-publication validation; it will allow repeated champion IDs while retaining all other checks.
- `src/lib/server/winner-boards/repository.test.js` proves duplicate instances persist and publish in order.
- `src/routes/(admin)/admin/graphics/+page.server.js` converts aligned native form arrays into repository input.
- `src/routes/(admin)/admin/admin-actions.test.js` proves route parsing preserves duplicate IDs and independent stars and rejects malformed array pairs.
- `src/lib/components/admin/WinnerBoardComposer.svelte` owns browser-only instance identity and the separated available/selected controls.
- `src/lib/components/admin/admin-components.svelte.test.js` proves instance-level interaction, augment limits, search isolation, and helper-unit eligibility.
- `tests/manual-winner-graphics.test.js` proves the browser/server/database/renderer workflow with duplicate instances.
- `docs/TODO.md` records the three verified Winner Composer blockers as complete.

### Task 1: Permit duplicate champion instances in persistence and publications

**Files:**

- Modify: `src/lib/server/winner-boards/repository.js:100-193`
- Modify: `src/lib/server/winner-boards/repository.js:346-399`
- Test: `src/lib/server/winner-boards/repository.test.js:300-390`

**Interfaces:**

- Consumes: `SaveWinnerBoardStateInput.champions: Array<{ catalogChampionId: string, starLevel: number | null }>` in display order.
- Produces: `WinnerBoardStateView.champions` and `WinnerBoardPublicationPayload.champions` with one entry per input instance and contiguous `displayOrder` values.

- [ ] **Step 1: Write the failing duplicate persistence/publication test**

Add this test beside the existing save and validation cases:

```js
it('persists and publishes duplicate champion instances with independent stars', async () => {
	const input = {
		...validInput(),
		champions: [
			{ catalogChampionId: 'champion-2', starLevel: 1 },
			{ catalogChampionId: 'champion-2', starLevel: 3 },
			{ catalogChampionId: 'champion-1', starLevel: null }
		]
	};

	const saved = await repository.saveWinnerBoardState(database, input);
	expect(saved.champions).toEqual([
		expect.objectContaining({ id: 'champion-2', starLevel: 1, displayOrder: 0 }),
		expect.objectContaining({ id: 'champion-2', starLevel: 3, displayOrder: 1 }),
		expect.objectContaining({ id: 'champion-1', starLevel: null, displayOrder: 2 })
	]);

	await repository.setWinnerBoardLive(database, true);
	const published = await requirePublishedWinnerBoard(database);
	expect(published.champions).toEqual([
		expect.objectContaining({ id: 'champion-2', starLevel: 1, displayOrder: 0 }),
		expect.objectContaining({ id: 'champion-2', starLevel: 3, displayOrder: 1 }),
		expect.objectContaining({ id: 'champion-1', starLevel: null, displayOrder: 2 })
	]);
});
```

- [ ] **Step 2: Run the repository test and verify the expected failure**

Run:

```powershell
pnpm exec vitest run --project server src/lib/server/winner-boards/repository.test.js
```

Expected: FAIL with `Champion IDs must be unique` before any implementation change.

- [ ] **Step 3: Relax champion uniqueness without weakening catalog scope**

In `validateInputShape`, delete only the champion `assertUnique` call. Keep minimum champion count, augment uniqueness/limit, and star validation.

In `validateTournamentScope`, query distinct requested champion IDs and compare against that distinct list:

```js
const uniqueChampionIds = [...new Set(scope.championIds)];
const scopedChampions = await transaction
	.select({ id: catalogChampions.id })
	.from(catalogChampions)
	.where(
		and(
			eq(catalogChampions.catalogSnapshotId, activeCatalogSnapshotId),
			inArray(catalogChampions.id, uniqueChampionIds)
		)
	);
if (scopedChampions.length !== uniqueChampionIds.length)
	throw new Error('Champion does not belong to active catalog');
```

In `parsePublicationPayload`, continue validating every champion entry and its display order, but remove the `championIds` collection and duplicate-ID rejection. Do not alter augment-ID validation.

- [ ] **Step 4: Run repository tests and verify green**

Run:

```powershell
pnpm exec vitest run --project server src/lib/server/winner-boards/repository.test.js
```

Expected: PASS, including the existing foreign-catalog, star-level, fourth-augment, and duplicate-augment regressions.

- [ ] **Step 5: Commit repository behavior**

```powershell
git add src/lib/server/winner-boards/repository.js src/lib/server/winner-boards/repository.test.js
git commit -m "fix: persist duplicate winner units"
```

### Task 2: Parse ordered unit instances at the form-action boundary

**Files:**

- Modify: `src/routes/(admin)/admin/graphics/+page.server.js:36-59`
- Test: `src/routes/(admin)/admin/admin-actions.test.js:590-632`

**Interfaces:**

- Consumes: repeated `championIds` and `championStarLevels` form values with equal lengths and matching DOM order.
- Produces: ordered `SaveWinnerBoardStateInput.champions`; blank star values become `null` and integers `1..3` are retained.

- [ ] **Step 1: Change the route test to send duplicate aligned values**

Replace the champion portion of the existing singleton-save test with:

```js
form.append('championIds', 'champion-2');
form.append('championStarLevels', '1');
form.append('championIds', 'champion-2');
form.append('championStarLevels', '3');
form.append('championIds', 'champion-1');
form.append('championStarLevels', '');
```

Assert the mock receives:

```js
champions: [
	{ catalogChampionId: 'champion-2', starLevel: 1 },
	{ catalogChampionId: 'champion-2', starLevel: 3 },
	{ catalogChampionId: 'champion-1', starLevel: null }
]
```

Add a parameterized malformed-input test covering a missing star value, an extra star value, `0`, `4`, and a non-integer string. Each case must return status `422` and must not call `saveWinnerBoardState`.

- [ ] **Step 2: Run the action tests and verify red**

Run:

```powershell
pnpm exec vitest run --project server src/routes/\(admin\)/admin/admin-actions.test.js
```

Expected: the duplicate test fails because the current route reads `starLevel:<catalogId>`, and malformed aligned arrays are not rejected.

- [ ] **Step 3: Implement strict aligned-array parsing**

Replace the ID-keyed star lookup inside `saveBoard` with this shape:

```js
const championIdValues = form.getAll('championIds');
const championStarLevelValues = form.getAll('championStarLevels');
if (championIdValues.length !== championStarLevelValues.length)
	throw new Error('Champion instance fields are misaligned');

const champions = championIdValues.map((rawChampionId, index) => {
	const catalogChampionId = text(rawChampionId);
	const rawStarLevel = championStarLevelValues[index];
	if (!catalogChampionId || typeof rawStarLevel !== 'string')
		throw new Error('Champion instance fields are invalid');
	const normalizedStarLevel = rawStarLevel.trim();
	const starLevel = normalizedStarLevel === '' ? null : Number(normalizedStarLevel);
	if (starLevel !== null && (!Number.isInteger(starLevel) || starLevel < 1 || starLevel > 3))
		throw new Error('Star level must be between 1 and 3');
	return { catalogChampionId, starLevel };
});
```

Keep tournament, winner, title, augment, generic `422` response, and repository invocation behavior unchanged.

- [ ] **Step 4: Run the action tests and verify green**

Run:

```powershell
pnpm exec vitest run --project server src/routes/\(admin\)/admin/admin-actions.test.js
```

Expected: PASS with duplicates and malformed arrays covered.

- [ ] **Step 5: Commit the form boundary**

```powershell
git add "src/routes/(admin)/admin/graphics/+page.server.js" "src/routes/(admin)/admin/admin-actions.test.js"
git commit -m "fix: parse ordered winner unit instances"
```

### Task 3: Separate available assets from selected instances in the composer

**Files:**

- Modify: `src/lib/components/admin/WinnerBoardComposer.svelte:13-237`
- Modify: `src/lib/components/admin/WinnerBoardComposer.svelte:339-510`
- Test: `src/lib/components/admin/admin-components.svelte.test.js:80-167`
- Test: `src/lib/components/admin/admin-components.svelte.test.js:376-479`

**Interfaces:**

- Consumes: saved board champion rows and active catalog champion/augment rows, including `isExcluded: true` champions.
- Produces: native form fields `championIds[]` and `championStarLevels[]` in instance order and an exact preview derived from the same instance array.

- [ ] **Step 1: Write failing browser-component tests for unit instances**

Replace checkbox-oriented expectations with Add/Remove actions and add this focused test:

```js
test('adds duplicate unit instances with independent stars and removes only one copy', async () => {
	render(WinnerBoardComposer, searchableComposerProps());

	await page.getByRole('button', { name: 'Add Ahri' }).click();
	await page.getByRole('button', { name: 'Add Ahri' }).click();
	const stars = page.getByLabelText(/Ahri unit \d+ star level/);
	await stars.nth(0).selectOptions('1');
	await stars.nth(1).selectOptions('3');

	expect(
		[...document.querySelectorAll('input[name="championIds"]')].map(
			(input) => /** @type {HTMLInputElement} */ (input).value
		)
	).toEqual(['champion-1', 'champion-2', 'champion-2']);
	expect(
		[...document.querySelectorAll('input[name="championStarLevels"]')].map(
			(input) => /** @type {HTMLInputElement} */ (input).value
		)
	).toEqual(['3', '1', '3']);

	await page.getByRole('button', { name: 'Remove Ahri unit 2' }).click();
	await expect.element(page.getByLabelText(/Ahri unit \d+ star level/)).toHaveCount(1);
	await expect.element(page.getByLabelText(/Ahri unit \d+ star level/)).toHaveValue('3');
});
```

Also assert:

- headings/regions named `Available champions`, `Selected units`, `Available augments`, and `Selected augments` appear in their respective tabs;
- the `Add Ahri` button remains enabled after adding Ahri;
- an `isExcluded: true` fixture named `Ivern Minion` has an enabled `Add Ivern Minion` button;
- selected augments have Remove buttons, an already-selected augment cannot be added twice, and a fourth unique augment is disabled at the limit;
- filtering available candidates does not remove selected unit instances or preview content.

- [ ] **Step 2: Run the browser-component test and verify red**

Run:

```powershell
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js
```

Expected: FAIL because the current checkbox/set model cannot add duplicates and stores stars by catalog ID.

- [ ] **Step 3: Replace ID-set state with ordered instance state**

Use this local shape and monotonic component-local key generator:

```js
/** @typedef {{ instanceId: string, catalogChampionId: string, starLevel: '' | number }} ChampionInstance */
let nextChampionInstanceId = 0;

/** @param {string} catalogChampionId @param {number | '' | null} starLevel */
function createChampionInstance(catalogChampionId, starLevel = '') {
	nextChampionInstanceId += 1;
	return {
		instanceId: `unit-${nextChampionInstanceId}`,
		catalogChampionId,
		starLevel: starLevel ?? ''
	};
}
```

Change `formState` to return `champions: ChampionInstance[]` instead of `championIds` plus the ID-keyed `starLevels` record. Change `normalizedForm`, `dirty`, `invalid`, hidden fields, selected-unit derivation, and `previewBoard` to read the instance array.

Use focused mutations:

```js
function addChampion(catalogChampionId) {
	composer.champions = [...composer.champions, createChampionInstance(catalogChampionId)];
}

function removeChampion(instanceId) {
	composer.champions = composer.champions.filter((unit) => unit.instanceId !== instanceId);
}
```

Do not use catalog champion IDs as Svelte each keys for the selected list. Key selected units by `instanceId`; key available catalog results by catalog ID.

- [ ] **Step 4: Build the two-section Skeleton UI**

Within each existing tab, retain the current search field and create semantic available/selected sections:

```svelte
<section aria-labelledby="available-champions-heading" class="space-y-2">
	<h3 id="available-champions-heading" class="font-bold">Available champions</h3>
	<!-- searchable catalog cards with btn preset-tonal-primary Add buttons -->
</section>

<section aria-labelledby="selected-units-heading" class="space-y-2">
	<h3 id="selected-units-heading" class="font-bold">Selected units</h3>
	<!-- ordered instance cards with select and btn preset-tonal-error Remove buttons -->
</section>
```

Each selected instance emits:

```svelte
<input type="hidden" name="championIds" value={unit.catalogChampionId} />
<input type="hidden" name="championStarLevels" value={unit.starLevel} />
```

Mirror the information architecture for augments while retaining their ID array, uniqueness, and three-item limit. Do not filter champion candidates using `isExcluded`, metadata, name patterns, or selected IDs.

- [ ] **Step 5: Run Svelte autofix until clean**

Run:

```powershell
npx -y @sveltejs/mcp svelte-autofixer ./src/lib/components/admin/WinnerBoardComposer.svelte --svelte-version 5
```

Apply every relevant issue or suggestion and repeat until the tool returns no issues or suggestions.

- [ ] **Step 6: Run component checks and verify green**

Run:

```powershell
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js
pnpm check
```

Expected: PASS with no Svelte errors or warnings.

- [ ] **Step 7: Commit the operator UI**

```powershell
git add src/lib/components/admin/WinnerBoardComposer.svelte src/lib/components/admin/admin-components.svelte.test.js
git commit -m "feat: compose ordered duplicate winner units"
```

### Task 4: Prove the complete workflow and close only the verified blockers

**Files:**

- Modify: `tests/manual-winner-graphics.test.js:318-360`
- Modify: `docs/TODO.md:16-25`

**Interfaces:**

- Consumes: the component form fields, route parser, repository behavior, and existing `/gfx` publication flow from Tasks 1-3.
- Produces: browser-level evidence that two copies survive save/reload/publication with different stars; updates only the three Winner Composer checklist items.

- [ ] **Step 1: Change the E2E workflow to create two copies**

In the graphics portion of the existing manual winner workflow:

```js
await admin.getByRole('button', { name: 'Add Test Champion' }).click();
const testChampionStars = admin.getByLabel(/Test Champion unit \d+ star level/);
await testChampionStars.nth(0).selectOption('1');
await admin.getByRole('button', { name: 'Add Test Champion' }).click();
await testChampionStars.nth(1).selectOption('3');
```

Update augment interactions to Add/Remove button labels. After Save, reload `/admin/graphics?tournament=${tournamentId}` and assert two selected Test Champion rows with star values `1` and `3`. After publishing, assert the broadcast renderer contains two `Test Champion` entries and both `★` and `★★★` star strings.

- [ ] **Step 2: Run E2E and verify green**

Run:

```powershell
pnpm test:e2e
```

Expected: PASS through setup, save, reload, publish, live replacement, reset, and immutable-media assertions.

- [ ] **Step 3: Mark only the three Winner Composer blockers complete**

In `docs/TODO.md`, change only lines 22-24 from `- [ ]` to `- [x]`. Leave every TFT-MATCH-V1 and Broadcast Graphics Scenes item unchanged.

- [ ] **Step 4: Format only touched files**

Run:

```powershell
pnpm exec prettier --write src/lib/server/winner-boards/repository.js src/lib/server/winner-boards/repository.test.js "src/routes/(admin)/admin/graphics/+page.server.js" "src/routes/(admin)/admin/admin-actions.test.js" src/lib/components/admin/WinnerBoardComposer.svelte src/lib/components/admin/admin-components.svelte.test.js tests/manual-winner-graphics.test.js docs/TODO.md
```

- [ ] **Step 5: Run the complete verification suite**

Run each command separately and require exit code 0:

```powershell
pnpm check
pnpm lint
pnpm exec vitest run
pnpm test:e2e
pnpm build
git diff --check
git status --short
```

Inspect `git diff --stat` and the complete diff. Confirm that `docs/skeleton-ui/` and `examples/` remain untouched and untracked.

- [ ] **Step 6: Commit the verified workflow and checklist**

```powershell
git add tests/manual-winner-graphics.test.js docs/TODO.md
git commit -m "test: verify duplicate winner units"
```

- [ ] **Step 7: Record final evidence**

Run:

```powershell
git log -5 --oneline
git status --short
```

Report the local commit hashes, exact passing commands, and any environment-specific checks that could not be run. Do not push.
