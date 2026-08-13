# TFT Winner Import Ordered Unit Slots Design

## Goal

Update TFT match winner import and the existing Winner composer so a board is an ordered list of independently editable unit slots. The import preserves repeated real champions and each copy’s star level, while safely omitting any match-unit occurrence that has no entry in the active catalog.

## Problem

The original TFT-MATCH-V1 design treated `catalogChampionId` as unique within a board. That is not a valid TFT invariant: a player can field multiple copies of the same champion, potentially at different star levels. Riot Match-V1 can also report unit records that are not deployable board champions (for example, summons or helpers). The public TFT static-data feeds include broad champion/unit data, but do not provide a stable, documented deployable-helper discriminator suitable for a permanent hard-coded allowlist.

## Decision

The active tournament catalog is the authoritative whitelist for importable board units.

For every Riot `units[]` occurrence, in its original order:

1. If its `character_id` exactly matches an active catalog champion’s `externalId`, create one ordered unit slot.
2. If it has no active catalog match, omit that occurrence from the editable/imported board.
3. Preserve all matching occurrences, including repeated `catalogChampionId` values, and retain each occurrence’s own `tier` as its slot `starLevel`.

The import review displays a non-blocking count/note for omitted occurrences. It does not expose raw Riot payloads or require an operator-maintained helper list. A stale catalog can omit a newly released real champion; the review note makes that result visible, while the normal catalog sync is the corrective path.

## Data Model

The conceptual board shape becomes:

```js
{
  title: 'Championship Winner',
  winnerPlayerId: 'player-id',
  champions: [
    { slotId: 'client-or-persisted-slot-id', catalogChampionId: 'zed-id', starLevel: 2, displayOrder: 0 },
    { slotId: 'client-or-persisted-slot-id', catalogChampionId: 'zed-id', starLevel: 1, displayOrder: 1 }
  ],
  augmentIds: ['augment-id']
}
```

`slotId` is a client-local identity for editing, keyed rendering, and form serialization; it is not trusted as a database identity. The server accepts ordered champion entries and persists `displayOrder`. Existing `winner_board_state_champions` already stores one row per ordered entry and has no uniqueness constraint on `catalog_champion_id`, so no destructive schema rewrite is required for repeated champion rows. Snapshot participant boards use the same repeated-entry semantics.

## Winner Composer UX

The composer replaces its unique selected-champion set and champion-ID-keyed `starLevels` map with an ordered slot array.

- Selecting **Add champion** creates a new slot even if that catalog champion is already present.
- Each slot renders its champion, individual star control, explicit order, and move/remove controls.
- The preview and summary render slots in order; duplicate champions remain visibly separate.
- The form serializes one indexed entry per slot, rather than deriving star-level field names from a catalog champion ID.
- The import dialog hands off its ordered slots directly. It preserves manual title and augments exactly as before.
- The dialog’s verification view and handoff note report the number of unmapped unit occurrences omitted because they are absent from the active catalog.

## Import Contract and Safety

The canonical match snapshot remains strict and versioned, with exactly eight unique participant PUUIDs and placements 1–8. It retains all mapped board slot occurrences; duplicate catalog IDs are valid. It omits unmatched occurrences and records their count or external IDs only in safe, bounded metadata needed for the operator review. It never includes augments, `win`, API keys, PUUIDs other than server-side canonical participants, arbitrary match IDs, or the raw provider payload in browser DTOs.

The active catalog controls mapping eligibility. `isExcluded` catalog corrections are not a general import-helper classifier: excluded resources do not become arbitrary silent omissions. The import boundary considers the active eligible catalog projection it is given; later catalog work must provide that projection explicitly.

## Persistence and Publication

The existing Save action remains the only write boundary. It atomically writes the editable board and optional exact eight-participant match snapshot, including ordered duplicate slots. Manual saves clear only the source snapshot reference. Save-while-Live continues producing one immutable publication whose payload preserves slot order and duplicate entries.

## Testing

- Contract tests cover duplicate mapped occurrences with different tiers, omitted unmapped occurrences, exact active-catalog matching, and strict snapshot validation for slot ordering rather than champion uniqueness.
- Repository/action tests cover indexed repeated-slot form input, ordered duplicate persistence, manual source clearing, and publication payload preservation.
- Browser tests cover adding duplicate manual slots, independent star levels, reordering/removal, imported duplicate slots, preserved title/augments, omission note, focus, and dirty/live behavior.
- E2E uses the injected fake gateway to import a deterministic board containing duplicate mapped units and an unmapped helper occurrence, then verifies persisted snapshot and rendered publication.

## Non-goals

- No static minion/helper allowlist.
- No provider-wide classification based on unit name, cost, rarity, or traits.
- No augments imported from Match-V1.
- No separate save form, direct database writes during browsing, or browser access to Riot configuration.
