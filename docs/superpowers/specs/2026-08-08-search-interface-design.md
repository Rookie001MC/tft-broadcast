# Search and Interface Organization Design

## Status

Approved design for the third release-remediation workstream. It depends on the final catalog-maintenance and singleton-composer interfaces from the operator workflow workstream.

## Goals

- Make champion and augment catalogs fast to search using the names and IDs operators already know.
- Keep searches scoped to the active resource type.
- Reduce density on Game Resources and Graphics without splitting either workflow across more routes.
- Preserve selected items and the exact graphic preview while filtering candidates.
- Use the installed Skeleton Svelte component APIs and Svelte 5 runes.

## Non-Goals

- No server-side search service.
- No stored alias field.
- No semantic or embedding-based search.
- No MiniSearch dependency in this workstream.
- No pagination requirement for the current catalog size.
- No change to publication validation beyond the three-augment limit defined by the integrity foundation.

## Search Engine

Add Fuse.js as the client-side fuzzy-search dependency. Catalog lists are small enough to index in the browser and do not justify a persistent full-text index.

A shared pure module converts each champion or augment into a search document with:

- original display name
- lowercase, accent-insensitive display name
- display-name initials
- raw external/engine ID
- tokenized engine ID
- engine ID with known TFT/set prefixes and punctuation removed

Normalization applies Unicode decomposition, removes combining marks, maps Vietnamese `đ` and `Đ` to `d`, lowercases with a stable locale, collapses whitespace, and tokenizes underscores, hyphens, punctuation, and letter/number boundaries.

Search ranking follows these rules:

1. exact display-name and exact engine-ID matches
2. display-name and engine-ID prefix matches
3. display-name fuzzy matches
4. engine-ID and initials fuzzy matches

Display names receive the highest Fuse weight. Raw and normalized engine IDs receive the next highest weight. Initials are lower-weight helpers. Location penalties are disabled because meaningful engine-ID tokens may occur after a set prefix. Empty queries return the original server ordering.

The search helper accepts a resource list and query and returns the original resource objects, preserving stable identifiers and selection state. Its normalization and ranking behavior is unit-tested independently of Svelte.

## Game Resources

The current combined catalog manager becomes a tabbed manager using `Tabs` from `@skeletonlabs/skeleton-svelte`.

Tabs:

- Champions, with visible and total counts
- Augments, with visible and total counts

Only the active tab's table is mounted as the primary interaction surface. A single visible search control is labelled for the active resource type and filters only that type. Champion and augment queries are stored separately so switching tabs does not destroy an operator's place.

Each tab includes:

- searchable resource table
- source/correction provenance
- add action
- edit action
- hide or restore action
- `Show hidden` filter, disabled by default

Hidden upstream entries do not appear in normal search results. Manual additions and corrected rows are visibly marked without dominating the table.

Catalog synchronization status and progress remain outside the tab panels so a tab switch cannot hide an active synchronization or its result.

## Graphics Composer

The composer uses the same Skeleton Svelte Tabs API with:

- Champions and selected-count badge
- Augments and selected-count badge

Each tab owns a separate query and Fuse index. Search filters only the candidate controls; it never removes selected items from the saved form model, selected summary, or exact `WinnerBoardGraphic` preview.

Champion selection remains unlimited. Augment behavior is:

- zero through two selected: all candidates remain selectable
- three selected: selected entries remain enabled for removal; every unselected entry is disabled
- a visible message explains the maximum of three
- server validation remains authoritative if the UI is bypassed

Switching tabs does not reorder or clear selections. Search result ordering does not alter saved display order; display order is determined by selection order and any existing explicit ordering controls.

## Svelte State Boundaries

- Raw server data remains component input.
- Active tab, per-tab query, `Show hidden`, and composer selections use `$state`.
- Search documents, Fuse instances, filtered results, counts, dirty state, and preview payloads use side-effect-free `$derived` or `$derived.by` calculations.
- `$effect` is reserved for genuine external integration and is not used to synchronize duplicate local state.
- Data passed into Fuse is converted to plain data when necessary rather than relying on deep reactive proxies.

## Accessibility

- Use Skeleton's Svelte Tabs semantics, triggers, indicator, and content components.
- Every search input has a visible label or equivalent programmatic label that changes with the active tab.
- Result counts are announced without moving focus.
- Disabled augment controls expose the reason through adjacent text and appropriate description linkage.
- CRUD action buttons remain reachable from the keyboard within responsive native tables.
- Empty, no-result, loading, hidden-only, and image-placeholder states are visually and programmatically distinct.

## Verification

Pure search tests cover:

- case-insensitive display-name matching
- accent-insensitive Vietnamese matching, including `đ`
- full and abbreviated engine-ID matching
- initials matching
- typo tolerance
- exact and prefix result priority
- stable original ordering for empty queries
- no cross-resource-type results

Component-browser tests cover:

- active-tab content and keyboard switching
- independent per-tab queries
- Game Resources search affecting only the active table
- Graphics search affecting only active candidates
- selected items remaining in summary and preview when filtered out
- three selected augments disabling only unselected candidates
- unlimited champion selection
- hidden-resource filtering and restore controls

Every modified Svelte component is passed through the Svelte autofixer until it reports no issues or suggestions. The workstream completes after focused unit/browser tests, `pnpm check`, `pnpm lint`, and the existing Vite E2E workflow pass.
