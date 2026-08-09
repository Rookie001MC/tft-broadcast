# Search and Interface Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add client-side Fuse search for champions and augments, split catalog and graphics workflows into accessible resource tabs, and preserve selection/order/preview while filtering candidates.

**Architecture:** A pure search module creates plain, normalized documents and returns original resource objects. CatalogManager and WinnerBoardComposer each hold local tab, per-tab query, and filtering state with Svelte state; their result lists, count badges, Fuse indexes, dirty state, and preview payload remain derived calculations. Skeleton Tabs supplies tab semantics while the resource model remains unchanged.

**Tech Stack:** Svelte 5 runes, SvelteKit 2, Skeleton Svelte 5 Tabs, Fuse.js, JavaScript with JSDoc, Vitest browser/server projects, Playwright.

## Global Constraints

- This plan depends on the completed catalog-maintenance and singleton-composer interfaces.
- Add only Fuse.js; do not add a server search API, aliases, MiniSearch, pagination, or embeddings.
- Search is scoped to the active resource type. Empty queries preserve server ordering and return original resource objects.
- Use Unicode decomposition, combining-mark removal, Vietnamese đ/Đ mapping, stable lowercase, collapsed whitespace, and engine token boundaries.
- Champions remain unlimited. At three augments, only unselected augment candidates are disabled; selected entries remain removable.
- Search never removes selected values from the saved form model, selected summary, or WinnerBoardGraphic preview. Filter ordering never changes stored display order.
- Use state for interactive inputs and side-effect-free derived expressions for all computed values. Do not use an effect to synchronize duplicate state.
- Every changed Svelte file must pass Svelte autofixer with no issues or suggestions.

---

## File Structure

- package.json and pnpm-lock.yaml: Fuse.js runtime dependency.
- src/lib/search/catalog-search.js and catalog-search.test.js: pure document normalization, index creation, and ranking.
- src/lib/components/admin/CatalogManager.svelte: champions/augments tabs, independent search and hidden filters, counts, and maintenance controls supplied by the prior workstream.
- src/lib/components/admin/WinnerBoardComposer.svelte: candidate tabs, independent searches, selected badges, derived preview, and three-augment client guard.
- src/lib/components/admin/admin-components.svelte.test.js: browser interaction coverage for tabs, filtering, selection persistence, and keyboard behavior.
- tests/manual-winner-graphics.test.js: end-to-end smoke coverage for active-resource-only search.

---

### Task 1: Write pure search behavior tests

**Files:**

- Create: src/lib/search/catalog-search.test.js

**Interfaces:**

- Produces failing tests for normalizeCatalogSearchText, createCatalogSearchIndex, and searchCatalogResources.

- [ ] **Step 1: Define deterministic champion and augment fixtures**

Use source-order arrays with Vietnamese display names, accented variants, known internal IDs, initials, and a hidden resource. Keep champion and augment lists distinct so scope assertions use object identity as well as labels.

- [ ] **Step 2: Add normalization cases**

Test case-insensitive name matching, accent-insensitive Vietnamese matching, explicit đ to d behavior, punctuation/underscore/hyphen tokenization, letter-number boundaries, and name initials.

~~~js
expect(normalizeCatalogSearchText('Đấu Trường Chân Lý')).toBe('dau truong chan ly');
expect(engineTokens('TFT15_Champion-Ahri2')).toEqual(['tft15', 'champion', 'ahri', '2']);
~~~

- [ ] **Step 3: Add ranking and identity cases**

Assert exact name/engine ID precedes prefix, prefix precedes fuzzy, fuzzy name precedes fuzzy engine/initials, empty query returns the original array references in original order, and a query against champions never returns an augment.

~~~js
const result = searchCatalogResources(champions, 'tft15_ahri');
expect(result[0]).toBe(champions[1]);
expect(searchCatalogResources(champions, '')).toEqual(champions);
~~~

- [ ] **Step 4: Add typo tolerance**

Assert a one-character display-name typo, an abbreviated engine ID, and initials return the intended resource without requiring stored aliases.

- [ ] **Step 5: Run the focused test**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/search/catalog-search.test.js
~~~

Expected: FAIL because the module and Fuse dependency do not exist.

- [ ] **Step 6: Commit**

~~~powershell
git add src/lib/search/catalog-search.test.js
git commit -m "test: define catalog search behavior"
~~~

### Task 2: Implement the Fuse-backed pure search module

**Files:**

- Modify: package.json
- Modify: pnpm-lock.yaml
- Create: src/lib/search/catalog-search.js
- Modify: src/lib/search/catalog-search.test.js

**Interfaces:**

- Produces normalizeCatalogSearchText(value), catalogSearchDocument(resource, index), createCatalogSearchIndex(resources), and searchCatalogResources(resources, query).

- [ ] **Step 1: Add the one runtime dependency**

Run:

~~~powershell
pnpm add fuse.js
~~~

Do not add a second search library or change existing Skeleton/Vitest dependencies.

- [ ] **Step 2: Implement normalization and documents**

Build only plain data for Fuse; do not pass Svelte proxies.

~~~js
export function normalizeCatalogSearchText(value) {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replaceAll('đ', 'd')
		.replaceAll('Đ', 'd')
		.toLocaleLowerCase('en-US')
		.replace(/\s+/g, ' ')
		.trim();
}

export function catalogSearchDocument(resource, index) {
	const displayName = normalizeCatalogSearchText(resource.displayName);
	const engineId = normalizeCatalogSearchText(resource.externalId);
	return {
		resource,
		index,
		displayName,
		initials: displayName.split(' ').filter(Boolean).map((part) => part[0]).join(''),
		externalId: engineId,
		engineTokens: tokenizedEngineId(engineId),
		engineCompact: tokenizedEngineId(engineId).join('')
	};
}
~~~

tokenizedEngineId must split underscores, hyphens, punctuation, whitespace, and the boundary between letters and numbers.

- [ ] **Step 3: Configure and apply ranking tiers**

Create the Fuse index with includeScore, ignoreLocation true, and weighted keys: displayName 0.55, externalId 0.25, engineCompact 0.15, initials 0.05. Before Fuse results, collect direct exact and prefix resource matches. Append fuzzy results after filtering duplicates, order ties by source index, and return only document.resource.

~~~js
const seen = new Set();
return [...exact, ...prefix, ...fuzzy]
	.map((item) => item.resource)
	.filter((resource) => !seen.has(resource.id) && seen.add(resource.id));
~~~

- [ ] **Step 4: Run the green unit suite**

Run:

~~~powershell
pnpm exec vitest run --project server src/lib/search/catalog-search.test.js
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~powershell
git add package.json pnpm-lock.yaml src/lib/search/catalog-search.js src/lib/search/catalog-search.test.js
git commit -m "feat: add Fuse catalog search"
~~~

### Task 3: Organize Game Resources around active-type tabs

**Files:**

- Modify: src/lib/components/admin/CatalogManager.svelte
- Modify: src/routes/(admin)/admin/game-resources/+page.svelte
- Modify: src/lib/components/admin/admin-components.svelte.test.js

**Interfaces:**

- CatalogManager keeps activeTab, championQuery, augmentQuery, championShowHidden, and augmentShowHidden locally.
- It consumes activeCatalog resources with prior-workstream provenance, isExcluded, and correction controls.

- [ ] **Step 1: Add browser test cases**

Test keyboard tab switching, only active tab primary table mounted, separate query retention, active-only result counts/search, hidden resources absent by default, show-hidden reveal, and add/edit/hide/restore controls remaining accessible.

- [ ] **Step 2: Replace one mixed list with Skeleton Tabs**

Import Tabs from the installed Skeleton package and build Root, List, Trigger, Indicator, and Content around Champion and Augment panels. Each trigger shows visible/total counts and each panel has a visible type-specific search label.

~~~svelte
<Tabs.Root>
	<Tabs.List aria-label="Catalog resource type">
		<Tabs.Trigger value="champions">Champions ({visibleChampionCount}/{championTotal})</Tabs.Trigger>
		<Tabs.Trigger value="augments">Augments ({visibleAugmentCount}/{augmentTotal})</Tabs.Trigger>
		<Tabs.Indicator />
	</Tabs.List>
	<Tabs.Content value="champions">...</Tabs.Content>
	<Tabs.Content value="augments">...</Tabs.Content>
</Tabs.Root>
~~~

Bind the component's current tab callback/controlled value according to the installed Tabs API; its one source of truth is activeTab state.

- [ ] **Step 3: Derive each panel independently**

Use plain-resource input to create two search indexes and derive filtered lists. Apply isExcluded filtering before search unless that type's show-hidden toggle is true.

~~~js
const visibleChampions = $derived(
	searchCatalogResources(
		activeCatalog.champions.filter((asset) => championShowHidden || !asset.isExcluded),
		championQuery
	)
);
~~~

Keep synchronization progress, warning, and result notices above/outside both panels so tab changes cannot hide active sync feedback.

- [ ] **Step 4: Run autofixer and browser tests**

Run the Svelte autofixer on CatalogManager.svelte and the modified page until clean. Then run:

~~~powershell
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js
pnpm check
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~powershell
git add src/lib/components/admin/CatalogManager.svelte src/routes/(admin)/admin/game-resources/+page.svelte src/lib/components/admin/admin-components.svelte.test.js
git commit -m "feat: organize catalog resources by type"
~~~

### Task 4: Add candidate tabs and bounded augment choices to Graphics

**Files:**

- Modify: src/lib/components/admin/WinnerBoardComposer.svelte
- Modify: src/routes/(admin)/admin/graphics/+page.svelte
- Modify: src/lib/components/admin/admin-components.svelte.test.js

**Interfaces:**

- WinnerBoardComposer owns championQuery, augmentQuery, activeAssetTab, composer selections, derived candidate lists, derived dirty state, and derived preview payload.

- [ ] **Step 1: Add component tests**

Cover keyboard tab switching, independent query state, active-only candidate filtering, selected resource persistence in summary and preview when filtered out, unlimited champions, and exactly-three augments disabling only unselected candidates with an exposed reason.

- [ ] **Step 2: Add Skeleton candidate tabs**

Use a second Tabs Root inside the composer candidate area. The champion trigger contains its selected-count badge; the augment trigger contains its selected-count badge. Each panel has a distinct visible search label and consumes only that resource type.

- [ ] **Step 3: Keep selection model separate from candidates**

Derive candidates from search, but derive selected summary and preview from composer.championIds and composer.augmentIds against complete catalog arrays.

~~~js
const selectedAugmentIds = $derived(new Set(composer.augmentIds));
const augmentLimitReached = $derived(composer.augmentIds.length >= 3);
const disabledAugment = (id) => augmentLimitReached && !selectedAugmentIds.has(id);
~~~

For disabled unselected controls, set disabled and aria-describedby to text explaining the three-augment maximum. Selected entries are never disabled solely by reaching the limit.

- [ ] **Step 4: Preserve display order**

Only toggle methods append/remove IDs. Search result order cannot mutate composer IDs, explicit star levels, selected summary, or preview item displayOrder.

- [ ] **Step 5: Run autofixer and focused checks**

Run Svelte autofixer until no issue or suggestion remains, then:

~~~powershell
pnpm exec vitest run --project client src/lib/components/admin/admin-components.svelte.test.js
pnpm check
pnpm lint
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~powershell
git add src/lib/components/admin/WinnerBoardComposer.svelte src/routes/(admin)/admin/graphics/+page.svelte src/lib/components/admin/admin-components.svelte.test.js
git commit -m "feat: add searchable graphics candidates"
~~~

### Task 5: Verify the operator-facing search workflow

**Files:**

- Modify: tests/manual-winner-graphics.test.js
- Modify: README.md

**Interfaces:**

- Produces browser coverage for catalog and composer search behavior and documents supported name/engine-ID searches.

- [ ] **Step 1: Add Playwright assertions**

On Game Resources, switch to Augments and search an engine-ID token; assert champion rows do not appear. On Graphics, select a resource, filter it out with a new query, and assert the selected summary/exact preview remains present. Select three augments and assert a fourth candidate is disabled while a selected one can still be unchecked.

- [ ] **Step 2: Document the operator contract**

State that search accepts display names, accent-insensitive Vietnamese, abbreviations/initials, and engine-ID forms; it does not persist aliases or search across tabs.

- [ ] **Step 3: Run all workstream gates**

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
git commit -m "test: verify searchable resource workflows"
~~~

## Workstream Exit Criteria

- Exact/prefix name and engine-ID results outrank fuzzy matches, and Vietnamese normalization works.
- Resource type boundaries, selections, display order, and preview are preserved while filtering.
- Three augment choices are usable and server validation remains authoritative.
- pnpm exec vitest run, pnpm check, pnpm lint, and pnpm test:e2e pass.
