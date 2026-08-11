# Broadcast Graphics Scenes and Shared Context Design

## Status

Approved design for the scene-based Broadcast Graphics work that follows the immediate TFT-MATCH-V1 implementation.

## Priority and Dependency

TFT-MATCH-V1 is the immediate priority. It must produce validated, persisted, immutable match snapshots before the scene-based graphics work starts. Winner may consume those snapshots automatically, and Post-Match requires them, but no control page or OBS source may render directly from a live Riot response.

The Broadcast Graphics work follows in this order:

1. Shared graphics foundation and reusable Tournament Selection.
2. Global broadcast context controls.
3. Winner route and output separation.
4. HUD control and output.
5. Read-only Post-Match control and output.

The exact Riot match discovery, regional routing, rate-limit, and freshness rules belong to the immediate TFT-MATCH-V1 design. This design defines how its validated snapshot is consumed and how graphics behave when the API pipeline fails.

## Goals

- Extract Tournament Selection into one reusable control for every current and future GFX page.
- Persist one broadcast-wide tournament, Match Name, and Game Name shared by every scene.
- Split Global, HUD, Winner, and Post-Match into independent control routes with isolated commands.
- Give HUD, Winner, and Post-Match independent OBS routes, publications, visibility, and refresh versions.
- Preserve the current preview, save, publish, and hide safety model.
- Integrate API-derived Winner data while retaining a deliberate manual setup path.
- Keep Post-Match strictly read-only and derived from validated eight-player match data.
- Prevent failures in Riot fetching or one scene from clearing or refreshing another scene.
- Preserve existing `/gfx` OBS configurations as Winner aliases.

## Non-Goals

- This design does not define TFT-MATCH-V1 discovery UX, Riot routing selection, retry timing, rate-limit policy, or snapshot freshness thresholds.
- Post-Match does not provide manual editing or correction of Riot participant, placement, augment, or champion data.
- HUD does not read live gameplay state.
- Scenes do not share publish, hide, or reset commands.
- Motion is not part of the first HUD or Post-Match implementation.
- This work does not replace the current tournament, roster, or pinned-catalog model.

## Architecture Decision

Use one persisted broadcast-context draft and independent per-scene publication models.

The shared context supplies tournament identity and operator-entered match/game labels. Each scene owns its own saved data, preview state, immutable publication, live pointer, version counter, and server commands. Publishing or hiding one scene cannot update another scene's version or live payload.

A single combined graphics publication was rejected because it would couple unrelated OBS sources. URL-only or process-local global state was rejected because it would not reliably synchronize operator tabs, server requests, and OBS clients after reloads.

SQLite remains the cross-request and cross-machine source of truth. Svelte `createContext` provides request-scoped reactive coordination inside the control component tree; it does not replace persistence.

## Route Structure

### Operator routes

- `/admin/graphics` redirects to `/admin/graphics/global`.
- `/admin/graphics/global` edits the shared broadcast context.
- `/admin/graphics/hud` controls the HUD scene.
- `/admin/graphics/winner` hosts the existing Winner workflow plus its API/manual source choice.
- `/admin/graphics/post-match` controls the read-only Post-Match scene.

The graphics layout loads tournaments and the persisted broadcast context once, renders scene navigation, and installs the shared Svelte context provider. Each scene page loads only its own draft/publication data and installs its own scene context provider.

### OBS routes

- `/gfx/hud` renders only the published HUD snapshot.
- `/gfx/winner` renders only the published Winner snapshot.
- `/gfx/post-match` renders only the published Post-Match snapshot.
- `/gfx` renders the same Winner output as `/gfx/winner` without requiring an OBS configuration change.

Each route has its own lightweight version endpoint and ETag namespace. `/gfx/version` remains an alias for the Winner version contract. Existing OBS sources continue to work while new scenes can be added independently.

## Svelte Context Boundaries

The project uses Svelte 5.56, which supports typed `createContext` pairs.

The graphics layout provides `BroadcastContext`. It contains:

- the persisted tournament, Match Name, and Game Name
- a local editable copy for the current control tree
- dirty and submitting state
- shared save and tournament-switch request commands

Each scene provides a separate context, such as `HudSceneContext`, `WinnerSceneContext`, or `PostMatchSceneContext`. A scene context contains only that scene's draft or selected snapshot, preview model, dirty state, publication status, and commands. Scene components do not import another scene's context or repository.

Reactive context values are mutated in place so children retain the same state proxy. Context is created inside the route component tree to avoid process-global SSR state and cross-request leakage.

## Reusable Tournament Selection

`TournamentSelector` is a route-agnostic presentational component. It receives:

- the available tournaments
- the saved selected tournament ID
- disabled and submitting state
- a callback for a requested selection change

It renders the label, empty state, select, and action control. It does not call `goto`, inspect URL search parameters, reset Winner, write to the database, or own a confirmation dialog.

Every GFX control page obtains the saved selection and switch command from `BroadcastContext`. This makes the selector reusable while keeping reset policy and persistence in the shared graphics service.

Graphics routes stop treating `?tournament=` as their source of truth. Existing `/admin/graphics?tournament=...` bookmarks redirect to the new graphics area without changing persisted context through a GET request.

## Persisted Broadcast Context

The installation-wide context stores:

- singleton ID
- selected tournament ID
- Match Name
- Game Name
- created timestamp
- updated timestamp

Match Name and Game Name are free-form Unicode text. Values are trimmed at their boundaries and limited to 80 characters each. They are not enums and do not infer bracket stage or game number. The Global page owns their edit fields.

Saving context changes only the shared source data. It does not publish HUD or any other scene. HUD compares that source with its own saved scene draft; the operator must save the HUD draft before publishing it.

### Tournament switching

Tournament selection is global. A requested switch checks for tournament-bound Winner drafts, selected match snapshots, and live HUD, Winner, or Post-Match publications.

When incompatible state exists, the operator receives one confirmation describing that affected scenes will be reset and hidden. Confirmation performs one server transaction that:

1. clears the editable Winner state and its live pointer
2. clears the selected match snapshot and Post-Match live pointer
3. clears the HUD live pointer built from the old tournament context
4. increments only the versions of scenes whose live pointers changed
5. saves the new tournament in broadcast context

Immutable publication history may remain for retention and cleanup, but no old-tournament payload remains live. A failed transaction leaves the previous context, drafts, and live pointers unchanged.

## Data Model Boundaries

The existing Winner tables and immutable-publication flow remain Winner-owned. The current `graphic_state` table continues to serve only as the Winner live pointer so existing data does not require an unrelated rename.

The scene work adds these boundaries:

- `broadcast_context` stores the installation-wide tournament ID, Match Name, Game Name, and timestamps.
- `hud_state` stores the saved HUD draft copied from a specific saved broadcast-context revision.
- `hud_publications` stores immutable HUD render payloads.
- `hud_graphic_state` stores only the live HUD publication pointer, version, and update timestamp.
- `post_match_state` stores the currently saved validated match-snapshot selection.
- `post_match_publications` stores immutable eight-player render payloads.
- `post_match_graphic_state` stores only the live Post-Match publication pointer, version, and update timestamp.

The immediate API work owns `tft_match_snapshots` and its normalized participant children or equivalent immutable JSON representation. Winner state adds source metadata distinguishing `api` from `manual` and an optional match-snapshot reference. Each live-pointer foreign key targets only its own scene's publication table; there are no polymorphic publication references.

## Shared Draft and Publication Rules

All scenes follow the existing Winner safety model:

1. Local edits or API selection update the preview model.
2. Save validates and persists the draft or selected snapshot.
3. Publish is disabled while the preview differs from saved state.
4. Publish creates an immutable render payload and points only that scene's live state at it.
5. Hide clears only that scene's live pointer and increments only that scene's version.
6. Reset clears that scene's draft and live pointer without mutating another scene.

The admin preview and OBS output use the same render component and payload contract. A failed save, publish, hide, or reset leaves the last saved draft and live publication intact.

## Scene Designs

### Global

Global provides the reusable Tournament Selection control plus Match Name and Game Name fields. It shows dirty/saved feedback and uses an explicit Save action. It does not have an OBS output or scene publication of its own.

### HUD

HUD provides the reusable Tournament Selection control and an isolated HUD scene controller. The preview is an exact scaled rendering of a transparent 1920×1080 overlay that wraps around the in-game HUD and displays:

- tournament name
- Match Name
- Game Name

The initial layout is static. Preview reflects the currently saved broadcast context. Save copies that context revision into `hud_state`; Publish remains disabled when `hud_state` is missing or older than the saved broadcast context. HUD exposes Save, Publish, and Hide actions and clearly distinguishes source changes, saved draft, and live states. Its immutable publication embeds the resolved tournament name and saved labels so a later database edit cannot alter the live frame without publishing.

HUD does not require a fresh TFT API response. API failure may be reported to the operator, but it never blocks HUD context editing or replaces the saved or live HUD snapshot.

### Winner

The current Winner composer, exact preview, immutable publication, show/hide behavior, reset protection, and one-second polling remain intact when moved to their dedicated routes.

When a validated match snapshot is selected, Winner derives the first-place participant, champions, star levels where available, and augments. API-derived mode is non-editable so the snapshot is not silently altered.

An explicit **Set up manually** action switches to the existing editable composer. When valid API-derived values exist, manual mode begins from those values; otherwise it begins from the current saved manual draft or existing roster/catalog defaults. A manual publication remains fully supported when the Riot API is unavailable or its data cannot be mapped.

Winner draft and publication metadata record whether their source is API-derived or manual and, when applicable, the source match snapshot ID. The live renderer consumes only the immutable Winner publication, never the Riot API.

### Post-Match

Post-Match accepts only a validated snapshot containing exactly eight participants. The control surface may select a valid snapshot, preview it, publish it, and hide it. It does not expose inputs that mutate placements, player identity, augments, champions, or star levels.

The graphic presents all eight players in placement order with their mapped augments and champions. The saved selection references the normalized snapshot, while publication embeds a complete immutable render payload so later API retries or catalog changes cannot mutate the live scene.

If no valid eight-player snapshot exists, Post-Match shows an unavailable/error state and disables Save and Publish. It does not offer a manual fallback.

## TFT-MATCH-V1 Consumption Contract

The immediate API implementation must persist a normalized snapshot before graphics consume it. At minimum, the graphics contract provides:

- immutable snapshot ID and Riot match ID
- associated tournament ID
- retrieval and game timestamps
- validation status and failure reason when rejected
- exactly eight normalized participants for a valid snapshot
- participant identity suitable for tournament-roster mapping
- placement for each participant
- ordered augments for each participant
- ordered champions/units and available star levels for each participant
- enough source metadata to audit how the snapshot was produced

Raw Riot payloads may be retained for diagnostics according to the API design, but renderers consume only normalized validated data. Duplicate fetches for the same Riot match do not create conflicting editable records.

## Failure Isolation

### Fetch or transport failure

- Preserve the last valid match snapshot.
- Preserve every saved draft and live publication.
- Keep HUD fully usable.
- Let Winner continue through **Set up manually**.
- Keep Post-Match unavailable for the failed candidate without clearing an already published Post-Match snapshot.

### Mapping or validation failure

- Store or report the rejection without marking the candidate valid.
- Do not partially populate Post-Match.
- Do not replace an existing API-derived Winner draft automatically.
- Offer manual Winner setup.
- Do not increment any scene version.

### Scene command failure

- Roll back the scene transaction.
- Keep that scene's previous saved and live state.
- Do not invoke another scene's command or version update.

### OBS polling failure

- Keep the last successfully rendered payload on screen.
- Retry on the next one-second interval.
- Reload only when that scene's ETag changes.

## Server Module Boundaries

Server code is split by responsibility:

- `broadcast-context` owns the persisted global context and guarded tournament switch transaction.
- `tft-matches` owns Riot transport, normalization, validation, and match snapshots.
- `winner-boards` retains Winner draft/publication behavior and adds API/manual source metadata.
- `hud` owns HUD publication and live state.
- `post-match` owns validated snapshot selection, publication, and live state.

Shared graphics page actions delegate to the broadcast-context service. Scene-specific page actions delegate only to their corresponding repository. Repository tests enforce that a scene command cannot modify another scene's rows or version.

## Testing and Acceptance

### Component tests

- `TournamentSelector` renders available, selected, empty, disabled, and submitting states and emits only a selection request.
- `BroadcastContext` and each scene context are tested through wrapper components that install the corresponding `createContext` provider.
- Dirty previews disable Publish until Save succeeds.
- API-derived Winner mode is locked and the manual action enables the existing editor.
- Post-Match contains no participant-data editing controls.

### Repository and action tests

- Broadcast context persists across requests and server restarts.
- A confirmed tournament switch atomically clears/hides only incompatible tournament-bound state.
- A failed tournament switch preserves all previous context and live pointers.
- HUD, Winner, and Post-Match publish/hide commands increment only their own version.
- Failed scene commands preserve the previous publication.
- API failure preserves the last valid match snapshot.
- Winner can save and publish from either a valid snapshot or manual setup.
- Post-Match rejects missing, invalid, or non-eight-player snapshots.

### Route and compatibility tests

- `/admin/graphics` redirects to Global.
- All four graphics control routes share the persisted tournament context.
- `/gfx/hud`, `/gfx/winner`, and `/gfx/post-match` render only their own published payload.
- `/gfx` and `/gfx/version` remain compatible with Winner.
- Unchanged scene version requests return HTTP 304 with scene-specific ETags.
- Publishing or hiding one scene does not reload another scene.

### Browser and visual tests

- Each admin preview matches its OBS renderer from the same payload.
- HUD is transparent, exactly 1920×1080, and does not obscure required in-game HUD information.
- Winner remains exactly 1920×1080 after route separation.
- Post-Match renders eight ordered player panels without clipping at 1920×1080.
- API, save, publish, hide, and polling failures display actionable operator feedback without blanking existing live graphics.

## Implementation Sequence

### Phase 1: Immediate TFT-MATCH-V1 work

Implement and validate the API snapshot pipeline and Winner API/manual behavior under a dedicated TFT-MATCH-V1 design and plan. Freeze the normalized snapshot interface before Post-Match implementation.

### Phase 2: Graphics foundation

Add persisted broadcast context, reusable Tournament Selection, the graphics layout/provider, scene navigation, shared context actions, and independent route/output shells.

### Phase 3: Global

Add Match Name and Game Name editing, explicit Save, dirty feedback, and the guarded tournament-switch transaction.

### Phase 4: Winner separation

Move the existing Winner control and renderer to dedicated routes, connect it to the shared context and isolated Winner context, and preserve `/gfx` compatibility aliases.

### Phase 5: HUD

Implement the static transparent overlay, exact preview, saved state, immutable publication, independent version endpoint, and OBS route.

### Phase 6: Post-Match

Implement validated snapshot selection, the read-only eight-player preview, immutable publication, independent version endpoint, and OBS route.

### Phase 7: Production verification

Run server, component, route, E2E, and 1920×1080 visual checks. Rehearse independent scene control with the actual OBS configuration and verify that API/network failures preserve live frames.

## Completion Criteria

- TFT-MATCH-V1 supplies persisted validated snapshots and Winner retains a working manual path.
- Tournament Selection is implemented once and used by every graphics control page.
- Tournament, Match Name, and Game Name persist as one broadcast-wide context.
- Global, HUD, Winner, and Post-Match controls have isolated scene state and commands.
- HUD, Winner, and Post-Match have independent immutable publications and OBS routes.
- Post-Match is read-only and refuses invalid or incomplete snapshots.
- API and scene failures preserve all unaffected saved and live state.
- Existing `/gfx` Winner browser sources continue to work.
- All automated and 1920×1080 visual acceptance checks pass.
