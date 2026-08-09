# Operator Workflow and Data Maintenance Design

## Status

Approved design for the second release-remediation workstream. It depends on the singleton saved-state and immutable-publication contracts from the integrity foundation.

## Goals

- Remove the saved-draft mechanic from the operator experience.
- Put Save, Live, and Reset controls in the Graphics composer.
- Preserve the operator's deliberate double-check before on-air changes.
- Make player, tournament, champion, and augment mistakes correctable from the admin UI.
- Preserve explicit catalog corrections when the same TFT set is synchronized again.
- Prevent destructive maintenance from leaving an invalid saved state.
- Stop presenting committed imports as ready to commit.

## Non-Goals

- No multiple saved states, per-tournament drafts, revision browser, or publication rollback UI.
- No automatic field-by-field publishing.
- No arbitrary editing of raw catalog snapshot metadata.
- No requirement for a manual catalog resource to have an image.
- No automatic correction inference from upstream Riot or CommunityDragon changes.

## Graphics Composer Workflow

The Graphics page loads the installation-wide saved state. If no state exists, the selected tournament supplies an empty composer. If a state exists, its tournament is authoritative for the composer.

The previous draft picker and separate `LiveControls` panel are removed. The composer header contains:

- title
- saved/unsaved indicator
- Live switch
- Save button
- Reset button
- Open `/gfx` link

Form fields remain local until Save. Dirty state is calculated against the last successfully loaded or saved state.

### Save

- With Live off, Save replaces only the singleton state.
- With Live on, Save replaces the singleton state and publishes a new immutable version.
- Validation errors keep entered values visible and leave the prior saved/live state untouched.
- A successful Save clears the dirty indicator and refreshes the preview from the canonical server response.

### Live switch

- Live cannot be enabled while the form is dirty; the UI explains that Save is required first.
- Enabling Live publishes the last saved state.
- Disabling Live hides `/gfx` immediately but retains the saved state.
- The switch reflects server state after every action and is disabled during submission.

### Reset and tournament changes

Reset opens an accessible confirmation dialog describing whether the current graphic will be hidden. Confirmation clears all saved board data.

Choosing a different tournament while a state exists opens the same reset-required flow. Cancel keeps the current tournament and form unchanged. Confirm resets first and then activates the requested tournament as an empty composer.

If loading detects that a referenced tournament, player, champion, or augment is unavailable, the composer does not silently discard individual fields. It shows a reset-required state and permits only Reset or non-destructive navigation.

## Player Maintenance

The Players table supports:

- viewing all persisted player fields and managed-image status
- creating a player
- editing full name, display name, optional Riot ID, and optional split Riot identity
- uploading, replacing, or removing the managed image
- deleting a player

Riot ID normalization and uniqueness use the same server functions as ZIP import. Image replacements are signature-checked and written to a unique managed path before the database points at them. Failed writes and transactions clean up newly staged files without deleting the previous working image.

Deleting a player that appears in the singleton saved state returns a reset-required result. Confirming the destructive dialog clears/hides the board and deletes the player in one server-controlled operation. Normal edits never mutate an existing publication.

## Tournament Maintenance

The Tournaments table supports creating, viewing, renaming, changing the slug, and deleting tournaments. Slugs remain unique and server-normalized.

Deleting the tournament used by the singleton state requires Reset confirmation. Existing roster cascade behavior remains, but a destructive action cannot bypass saved-state validation. Changing a tournament name or slug does not affect an existing immutable publication.

## Catalog Correction Model

Catalog snapshots retain their upstream provenance. Operator changes are represented explicitly rather than rewriting away the source record.

Each catalog correction records:

- canonical TFT set key
- resource kind: champion or augment
- operation: add, override, or exclude
- target upstream external/engine ID for override and exclude operations
- stable manual external/engine ID for additions
- optional display-name override
- optional tier override
- optional managed-image override
- creation and update timestamps

The canonical set key uses the normalized TFT set identity from snapshot metadata. When a source cannot expose a stable set identity, corrections are patch-scoped rather than applied to unrelated future sets.

### Apply behavior

- Add creates a manual selectable resource with explicit provenance.
- Override changes only supplied fields while retaining the upstream identity and original metadata.
- Exclude hides a problematic resource from normal browsing and selection without physically deleting it.
- Restore removes or disables the exclusion and returns the upstream resource to selection.
- Manual images are optional and use controlled managed media. Image-less entries render a deliberate placeholder.

Corrections are materialized into the active snapshot for immediate use and stored separately for traceability. During a later synchronization of the same set, correction application occurs after upstream normalization and before transactional activation. Failed correction application prevents activation and preserves the prior usable snapshot.

Correcting an engine ID is represented as excluding the incorrect identity and adding the correct manual identity. This avoids changing the key used to match future upstream records.

Hiding a catalog resource referenced by the singleton state requires Reset confirmation. Editing its display name, tier, or image is non-destructive; the saved state sees the corrected data on its next load, while the existing live publication remains unchanged until Save.

## Destructive-Action Contract

Repositories report whether a requested delete or exclusion conflicts with the singleton state. Page actions return a structured reset-required response containing only the action kind and safe display label.

The confirmation submission repeats all authorization and dependency checks. It does not trust a client-supplied claim that Reset is necessary. The server transaction:

1. verifies the target still exists
2. verifies the dependency still conflicts
3. clears the saved state
4. hides the live publication and advances the version when necessary
5. performs the requested deletion or exclusion

If any step fails, the state, live pointer, and target record remain unchanged.

## Import Preview Status

The import panel uses the persisted preview row as its status authority.

- `previewed`: show validation results and enable confirmation only when valid and unexpired.
- `committed`: show a committed success state, committed timestamp, and result summary; do not render an enabled confirmation action.
- `expired`: show that a new preview is required.
- missing token or staged file: show a safe unavailable state and require a new preview.

A form response from the commit action cannot cause a committed preview to render as commit-ready. Repeating a committed token continues to fail closed on the server.

## Errors and Accessibility

- All mutations use authenticated SvelteKit POST actions or the existing authenticated sync endpoint.
- Expected validation and dependency conflicts use action-specific messages and appropriate failure status codes.
- Dialogs have a labelled title and description, trap focus while open, support Escape to cancel, and restore focus to the initiating control.
- Submit controls expose pending state and prevent duplicate submission.
- Success notices distinguish saved, published, hidden, reset, corrected, restored, and committed outcomes.

## Verification

Repository and route tests cover:

- player and tournament edits and uniqueness errors
- safe player image replacement/removal
- delete with and without a saved-state dependency
- catalog addition, override, exclusion, and restoration
- correction reapplication to the same set and isolation from a different set
- sync failure preserving the active snapshot
- reset-and-destroy atomicity
- committed, expired, and missing import-preview statuses
- every admin mutation rejecting anonymous calls

Component tests cover:

- no draft picker or separate live-control panel
- dirty state blocking Live-on
- Save while hidden and Save while live
- Reset and tournament-change confirmation
- CRUD edit forms and safe action feedback
- image-optional manual catalog entries
- committed import confirmation remaining unavailable after rerender and reload
- dialog keyboard and focus behavior

The workstream completes only after focused server and browser tests, `pnpm check`, `pnpm lint`, and the existing Vite E2E workflow pass.
