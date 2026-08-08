# Integrity Foundation Design

## Status

Approved design for the first release-remediation workstream.

## Context

Two release-blocking integrity problems exist in the current implementation:

- Player bundle inspection trusts ZIP metadata for expanded-size accounting while entry streams are buffered without measuring their actual decompressed bytes.
- Published boards store foreign keys and reconstruct `/gfx` data by joining mutable player and catalog rows. Editing a player or replacing media can therefore change an already-published board without a new publication version.

The existing collection of draft, published, and hidden board rows also conflicts with the desired single-purpose operator workflow. The replacement model keeps one editable installation-wide state and creates immutable publication records only when an operator deliberately puts a saved version on air.

## Goals

- Bound ZIP decompression using actual streamed bytes.
- Keep one saved winner-board state across the installation.
- Make every live publication immutable in both data and media.
- Preserve one-second version polling and ETag behavior.
- Make Save the only action that can update an already-live board.
- Enforce zero to three augments and an unbounded champion list at the repository boundary.
- Migrate safely from the existing board model without silently carrying mutable live state forward.

## Non-Goals

- No history browser or draft library.
- No rollback-to-publication interface.
- No automatic publishing for individual field changes.
- No champion-count validation.
- No automatic champion layout redesign based on seasonal team-size rules.
- No general-purpose media deduplication or garbage-collection service.

## Persistence Model

### Saved board state

`winner_board_state` contains at most one row with the fixed identifier `current`:

- `id`
- `tournament_id`
- `winner_player_id`
- `title`
- `created_at`
- `updated_at`

Ordered child tables hold the current champion selections and augment selections. They retain foreign keys to the current player and catalog records because the saved state is editable and is expected to reflect deliberate operator maintenance before the next Save.

The singleton invariant is enforced in the repository and by the fixed primary key. There is no tournament-specific state collection and no `draft`, `published`, or `hidden` status on the editable state.

### Immutable publications

`winner_board_publications` records an immutable render contract:

- unique publication identifier
- source saved-state timestamp
- monotonically increasing graphic version
- canonical serialized render payload
- publication-scoped media directory
- creation timestamp

The serialized payload contains all fields consumed by `WinnerBoardGraphic`:

- board title and tournament identity
- winner identifier, display name, Riot ID, and immutable image URL or `null`
- ordered champion identifiers, display names, immutable image URLs or `null`, star levels, and display orders
- ordered augment identifiers, display names, immutable image URLs or `null`, and display orders

The payload is validated at publication write and read boundaries. `/gfx` reads only this payload and never joins `players`, `catalog_champions`, or `catalog_augments` to reconstruct a live board.

### Graphic state

`graphic_state` remains a singleton with:

- `id = 'live'`
- nullable `published_publication_id`
- monotonically increasing `version`
- `updated_at`

The pointer targets an immutable publication rather than an editable board. Any successful publish, hide, or live Reset increments `version` exactly once. A no-op hide while already hidden does not increment it.

## Immutable Media

Every publication receives a unique managed directory under the configured media root. Referenced player, champion, and augment images are copied into that directory using generated filenames and validated content types. Missing optional images remain `null` and use the existing renderer placeholder.

Publication preparation follows this order:

1. Validate the complete board against the current tournament, roster, and active catalog.
2. Read and signature-check every referenced managed image.
3. Write a unique publication directory that is not yet referenced by the database.
4. Execute the database transaction that updates the saved state, inserts the immutable publication payload, moves the live pointer, and increments the version.
5. If the transaction fails, remove the unreferenced directory. Cleanup failure may leave an inert orphan but never a broken live pointer.

Publication media URLs include the publication identifier and immutable filename. The serving endpoint uses `X-Content-Type-Options: nosniff` and long-lived immutable caching. Replacing a player's current image or a manual catalog image cannot change or stale an existing publication.

Historical publication records and their media are retained for this scope. Retention and garbage collection can be designed after production usage is known.

## State Transitions

### Save while hidden

Save validates and transactionally replaces the singleton state and ordered children. It does not create a publication, move the live pointer, or increment the graphic version.

### Turn Live on

Live can be enabled only from a valid, already-saved, non-dirty state. The operation creates an immutable publication from that saved state, points `graphic_state` at it, and increments the version.

### Save while live

Save validates the edited form, replaces the singleton state, creates a new immutable publication, advances the live pointer, and increments the graphic version as one logical operation. The prior publication remains unchanged and readable until the transaction commits.

### Turn Live off

The operation clears the live pointer and increments the version. The saved state remains available for correction and later republishing.

### Reset

Reset clears the singleton state and ordered children. If a publication is live, the same transaction clears the live pointer and increments the version. Reset while hidden does not create a publication.

## Validation Rules

Every saved or published state requires:

- an existing tournament
- a winner belonging to that tournament's roster
- at least one champion from the tournament's active catalog
- unique champion selections
- champion star levels of `null` or integers from one through three
- zero through three unique augments from the active catalog

There is no server or UI maximum for champions. A fourth augment is rejected in the repository even if a request bypasses the UI.

## ZIP Expansion Accounting

ZIP inspection keeps the existing compressed-size, entry-count, path traversal, symlink, encryption, nested-archive, and allowed-location checks.

Each opened entry stream maintains an entry byte counter and contributes to a total decompressed byte counter. The reader aborts and destroys the stream as soon as either limit is exceeded. Metadata-declared sizes may reject an entry early when already excessive, but they are never accepted as proof of the actual decompressed size.

The limits remain:

- 25 MiB compressed bundle
- 500 entries
- 100 MiB total expanded bytes

The entry reader must not concatenate an entry after a limit failure. All rejection paths close the ZIP and release listeners.

## Existing-Data Migration

The schema migration creates the new singleton and publication tables without attempting to expose an old mutable board as an immutable publication.

If legacy board rows exist, a one-time application migration selects the currently published board when one is referenced; otherwise it selects the most recently updated draft. That board becomes the saved singleton state. Other legacy drafts are intentionally not presented in the new interface. The live pointer is cleared so an operator must inspect the migrated state and deliberately enable Live under the new immutable contract.

Deployment instructions require a database backup before applying this migration. Legacy tables are removed only after the singleton data has been copied successfully.

## Errors and Recovery

- Expected validation failures return stable operator-safe messages.
- A failed media read leaves the previous saved and live states unchanged.
- A failed saved-state transaction leaves the previous child ordering intact.
- A failed publication transaction retains the prior live pointer and polling version.
- A missing publication-media file returns a controlled missing-media response and emits no filesystem path to the client.
- Orphan publication directories from rare cleanup failures are harmless and may be reported for later maintenance.

## Verification

Focused tests cover:

- an entry whose declared size is smaller than its emitted decompressed bytes
- per-entry and aggregate streamed-byte boundaries
- stream closure and rejection without full buffering after a limit breach
- singleton replacement and ordering
- save while hidden
- enable Live from saved state
- Save while live producing a distinct publication and version
- edits to player or catalog rows not changing an existing publication payload or media bytes
- existing and newly opened `/gfx` clients rendering the same publication version
- hide and Reset version behavior
- zero, one, two, and three augments accepted; four rejected
- a large champion list accepted by repository validation
- safe migration from a referenced live board and from draft-only data

The workstream completes only after focused tests, all server tests, `pnpm check`, and `pnpm lint` pass.
