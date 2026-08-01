# Manual Winner Graphics Design

## Status

Approved design draft for the manual-first TFT production graphics MVP.

## Context

This project is an internal broadcast tool for HCMUSEC TFT tournament livestreams. The MVP must not depend on TFT-MATCH-V1 because we do not yet know whether Riot match history can reliably identify the tournament winner for our use case.

The critical path is a manual production workflow:

- Operators build a winner board from tournament roster data.
- Operators select TFT champions and augments from a pinned CommunityDragon or Data Dragon catalog.
- Operators publish only after review.
- The broadcast route renders only the currently published board.

Riot API work remains a later experiment. The MVP must work without `RIOT_API_KEY`.

## External References

- `docs/riotgames/tftpolicy.html`
  - Avoid dynamic real-time gameplay information, scouting, or decision-prescriptive overlays.
  - Post-game and static data workflows are the safer fit for this project.
  - Match history can expose useful post-game fields, but it is not part of the MVP critical path.
- `docs/riotgames/riotid_format.md`
  - Riot ID is useful to store for future automation.
  - The UI should treat it as optional during MVP setup.
- `docs/communitydragon/assets.md`
  - CommunityDragon asset paths can move.
  - Directory JSON listings and CDragon TFT JSON are useful sync inputs.
  - DDragon and CDragon (Especially CDragon) may lag behind patches because publishing is manual.

## Goals

- Provide a production-safe manual winner graphic workflow.
- Let operators reuse tournament/player data instead of typing everything each time.
- Pin a TFT asset catalog per tournament so graphics do not shift during a show.
- Let operators compose a rich winner graphic with winner, optional player image, champion list with levels, and optional augments.
- Keep draft editing isolated from the live `/gfx` output.

## Non-Goals

- No Riot match-history automation in the MVP.
- No live client integration.
- No real-time scouting or gameplay recommendations.
- No win-rate or statistical overlays.
- No full tournament bracket or standings management.
- No `.xlsx` import in the MVP.

## Architecture

The SvelteKit app has two primary surfaces.

`/admin` is the private operator surface. It owns tournament setup, catalog sync, player import, roster management, winner board composition, preview, publish, and hide actions.

`/gfx` is the public broadcast browser source. It renders a fixed 1920x1080 scene from the currently published graphic state. It does not expose editing and does not fetch Riot data.

Server-side modules are split by responsibility:

- `catalog`: syncs and stores pinned CommunityDragon/Data Dragon snapshots and asset references.
- `players`: stores reusable player records and handles CSV import preview/write.
- `tournaments`: stores tournament records and tournament roster membership.
- `winnerBoards`: stores draft and published winner board state.
- `uploads`: stores optional operator-uploaded player images under a controlled local directory.

## Data Model

### Catalog

`catalog_snapshots`

- `id`
- `source`
- `source_url`
- `locale`
- `patch_label`
- `set_label`
- `synced_at`
- `is_available`
- `metadata_json`

Each tournament references the intended active snapshot. Sync failure or missing latest patch must not delete or replace the previous usable snapshot.

`catalog_champions`

- `id`
- `catalog_snapshot_id`
- `external_id`
- `display_name`
- `icon_path`
- `tier`
- `metadata_json`

`catalog_augments`

- `id`
- `catalog_snapshot_id`
- `external_id`
- `display_name`
- `icon_path`
- `tier`
- `metadata_json`

### Players And Rosters

`players`

- `id`
- `riot_id`
- `riot_game_name`
- `riot_tagline`
- `full_name`
- `display_name`
- `image_path`
- `created_at`
- `updated_at`

Riot identity fields are optional in the MVP. `riot_id` stores the normalized display form, such as `GameName#TAG`. `riot_game_name` and `riot_tagline` store the split values needed by future ACCOUNT-V1 lookups. `display_name` is separate from `full_name` because broadcast names and real names often differ.

`tournaments`

- `id`
- `name`
- `slug`
- `active_catalog_snapshot_id`
- `created_at`
- `updated_at`

`tournament_players`

- `tournament_id`
- `player_id`
- `display_order`
- `notes`

The roster table allows players to be reused across tournaments while keeping each event's selection and ordering separate.

### Winner Boards

`winner_boards`

- `id`
- `tournament_id`
- `winner_player_id`
- `title`
- `status`
- `created_at`
- `updated_at`
- `published_at`

`status` supports at least `draft`, `published`, and `hidden`. Only one board is effectively live for `/gfx` at a time.

`winner_board_champions`

- `id`
- `winner_board_id`
- `catalog_champion_id`
- `star_level`
- `display_order`

`star_level` is nullable when not set.

`winner_board_augments`

- `id`
- `winner_board_id`
- `catalog_augment_id`
- `display_order`

Augments are optional for publishing.

## Operator Workflow

1. Select or create tournament.
2. Pin or sync the CommunityDragon/Data Dragon catalog for that tournament.
3. Build the tournament roster:
   - add players manually
   - import players from CSV
   - preview CSV rows before writing
   - search/filter existing players
   - checkbox-select multiple players
   - batch add selected players to the active tournament roster
   - reorder roster for faster winner selection
4. Compose a winner board:
   - pick winner from tournament roster
   - use the player image when available
   - allow publish without an image
   - select champions from the pinned catalog
   - set champion star levels where needed
   - select augments from the pinned catalog when available
5. Preview the exact `/gfx` output inside admin.
6. Publish, hide, or replace the live board.

Draft edits must never leak to `/gfx`. The broadcast route changes only when the operator presses publish or hide.

## CSV Import

MVP import format is CSV only.

Required columns:

- `full_name`
- `display_name`

Optional columns:

- `riot_id`
- `riot_game_name`
- `riot_tagline`
- `image_path`

Import must have a preview step that shows:

- parsed rows
- missing required fields
- duplicate candidates
- rows that will create players
- rows that will update existing players
- rows that will be skipped

CSV import normalizes Riot identity when either `riot_id` or both split Riot ID columns are present. The MVP leaves actual image file upload and manual image matching outside CSV import; `image_path` is accepted only as metadata for pre-existing managed files.

## Catalog Sync And Fallback

Catalog sync is explicit per tournament.

CommunityDragon is the preferred source for selectable TFT assets. Data Dragon is the fallback source where it provides stable champion or augment data.

CommunityDragon endpoint template:

- `https://raw.communitydragon.org/{patch}/cdragon/tft/{locale}.json`

Initial locale default:

- `vi_vn` for Vietnamese tournament production
- fallback to `en_us` when `vi_vn` is unavailable

Data Dragon fallback endpoint templates:

- `https://ddragon.leagueoflegends.com/cdn/{patch}/data/{locale}/tft-champion.json`
- `https://ddragon.leagueoflegends.com/cdn/{patch}/data/{locale}/tft-augments.json`

Because CommunityDragon and Data Dragon can lag behind game release patches, missing latest patch data is not a hard error. The app must:

- keep the last usable snapshot active
- show the operator that the requested/latest patch was not available
- allow the tournament to continue with the pinned previous snapshot

Network failure must leave the current active catalog untouched.

## Publishing Rules

Publishing requires:

- tournament selected
- winner selected
- at least one champion selected

Publishing does not require:

- winner image
- augments
- Riot ID
- Riot API result

Admin actions fail closed. Failed save, upload, import, catalog sync, publish, or hide actions must not corrupt the live graphic state.

## Upload Rules

Uploads are for optional player images.

- Accept image MIME types only.
- Store files under an app-controlled local upload directory.
- Store DB references to local paths.
- Serve player images through a controlled SvelteKit media route by database id.
- Do not let `/gfx` render arbitrary external image URLs.
- If a player has no image, the graphic uses a deliberate empty state.

## Broadcast Rendering

`/gfx` renders the current published board at 1920x1080.

When no board is published, or the board is hidden, `/gfx` renders a clean empty state suitable for OBS/vMix.

The admin preview renders the same component or data contract as `/gfx` so operators see what will go live.

## Testing And Validation

Database and schema tests:

- catalog snapshot can be active per tournament
- players can be reused across tournaments
- winner boards keep ordered champions and augments
- publishing one board does not mutate drafts unexpectedly

CSV import tests:

- valid CSV creates players
- duplicate Riot ID or display name is detected in preview
- missing required fields are reported before writing
- batch add does not duplicate existing tournament roster rows

Catalog sync tests:

- successful sync stores champions/augments and asset references
- unavailable latest patch falls back to last available snapshot
- network failure leaves existing active catalog untouched

Route/action tests:

- incomplete publish is rejected when tournament, winner, or champions are missing
- publish works without winner image
- publish works without augments
- `/gfx` renders empty state when hidden or unpublished

Manual visual validation:

- admin preview and `/gfx` render the same winner board
- 1920x1080 graphics fit OBS/vMix browser source without scrollbars

## Implementation Decisions For Planning

- First graphic layout is a fixed 1920x1080 winner board with winner identity, optional player image, champion list with nullable star levels, and optional augment list.
- MVP does not require motion. Animation can be added after the static graphic is production-safe.
- Player images are stored in a controlled upload directory and served through a SvelteKit media route, not directly from arbitrary external URLs.
- Riot ID is stored both as normalized display text and split game-name/tagline fields for later ACCOUNT-V1 automation.
- Catalog ingestion starts from CommunityDragon `{patch}/cdragon/tft/{locale}.json`, with Data Dragon champion and augment JSON as fallback.
