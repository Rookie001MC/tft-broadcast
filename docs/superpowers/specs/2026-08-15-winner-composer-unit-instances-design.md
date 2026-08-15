# Winner Composer Unit Instances Design

## Goal

Allow a Winner board to contain multiple instances of the same catalog champion, with an independent star level for every instance, while preserving the existing manual-first save, preview, publish, and hide workflow.

This work must be complete before TFT-MATCH-V1 integration begins. It changes the manual composer and its existing server boundary only; it does not implement Riot API discovery or match import.

## Requirements

- A champion may be added to the board any number of times.
- Every selected champion instance has its own star level of `null`, `1`, `2`, or `3`.
- Champion instances retain their selection order through preview, save, reload, and publication.
- Removing one instance must not remove another instance of the same champion.
- The operator must see separate available and selected sections instead of one checkbox list that conflates both states.
- The available champion section must continue to offer a champion after it has already been selected.
- All champion rows in the tournament's active catalog are eligible for manual selection, including helper, summon, and minion units. The composer must not infer unit type or maintain a whitelist.
- Augments remain unique and limited to three, but their available and selected states must also be presented as separate sections.
- Draft changes must not affect the live graphic until the existing save/publication boundary advances it.
- The renderer remains the existing fixed 1920x1080 Winner graphic.

## Data Model

The browser composer represents champions as an ordered array of unit instances:

```js
{
	instanceId: string,
	catalogChampionId: string,
	starLevel: '' | 1 | 2 | 3
}
```

`instanceId` is local UI identity. It exists so Svelte keyed lists, star-level controls, and remove actions can distinguish otherwise identical champion copies. It is not persisted and is not added to the immutable publication contract.

The database needs no migration. `winner_board_state_champions` already gives each selected row a separate primary key and stores catalog champion ID, star level, and display order independently.

## Form and Server Boundary

The enhanced POST form remains the only save boundary and must continue to work as a native form. Each selected unit emits one `championIds` value and one `championStarLevels` value in the same DOM order. The route action reads both arrays, requires equal lengths, and constructs the repository input by index.

An empty star-level value becomes `null`. Non-empty values must be integers from 1 through 3. Missing, extra, or invalid star-level values make the board request invalid.

The repository continues to require at least one champion, roster membership, an available active catalog, catalog ownership, and valid star levels. It no longer requires champion IDs to be unique. Catalog-scope validation compares the distinct requested champion IDs with the distinct matching catalog rows so duplicate instances do not produce a false ownership failure.

Augment parsing and validation remain unchanged: augment IDs must be unique and no more than three may be selected.

## Operator Interface

The existing Champions and Augments tabs remain because they match the current Skeleton UI control surface.

The Champions tab contains two explicit regions:

1. **Available champions** — searchable catalog results with an Add button. A champion remains available after selection, so the operator can add another instance immediately.
2. **Selected units** — an ordered list of unit-instance cards. Each card shows the champion name, an independent star selector, and a Remove button. The displayed order is the board and publication order.

The Augments tab follows the same information structure:

1. **Available augments** — searchable results with Add buttons disabled only when that augment is already selected or the three-augment limit has been reached.
2. **Selected augments** — selected items with individual Remove buttons.

The controls use the repository's existing Skeleton classes and semantic buttons, labels, fieldsets, and lists. Buttons receive unit-specific accessible names. Empty selected sections state that nothing is selected instead of collapsing.

No drag-and-drop or reorder controls are added. Addition order remains the established ordering mechanism and keeps this fix focused on the requested blockers.

## Manual Eligibility for Helper Units

The active catalog loader already returns every champion row for the pinned snapshot. The Winner composer and repository must not add an `isExcluded` eligibility condition or any name/metadata-based helper filter. A test fixture marked as excluded verifies that the operator can still add and save it manually.

This rule applies to manual composition. Future TFT-MATCH-V1 normalization must preserve Riot's ordered unit instances and must not silently remove duplicate, helper, summon, or minion units based on a maintained whitelist.

## Publication Safety

The immutable publication payload preserves one champion entry per selected instance, including repeated catalog IDs and independent star levels. Publication validation continues to enforce shape, controlled media URLs, contiguous display order, and valid star levels, but it no longer rejects repeated champion IDs.

Augment IDs remain unique. Existing publication media copying, transactional pointer advancement, ETag/version behavior, hidden output, and failure isolation are unchanged.

## Testing

Tests must demonstrate the complete behavior rather than only the UI state:

- component: add the same champion twice, set different star levels, remove one instance, and confirm the other remains;
- component: available and selected champion/augment regions are distinct and an excluded helper unit remains addable;
- route action: parallel champion ID and star-level values preserve duplicates and order, while misaligned or invalid values fail;
- repository: duplicate champion IDs with different star levels save, reload, and retain display order;
- publication: duplicate champion IDs are accepted and remain distinct in the immutable payload;
- regression: foreign-catalog champions, invalid star levels, duplicate augments, and a fourth augment are still rejected;
- end to end: save and reload a board with duplicate champion instances and verify both instances render with their respective star levels.

After all relevant checks pass, mark the three Winner Composer blockers in `docs/TODO.md` complete. Do not mark any TFT-MATCH-V1 item complete.
