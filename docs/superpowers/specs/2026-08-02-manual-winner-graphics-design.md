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
  - Data Dragon is Riot's official static data and asset source for LoL/TFT where Riot publishes supported JSON and image bundles.
  - CommunityDragon is a community-maintained export of LoL/TFT client and game files. It is broader than Data Dragon for many TFT assets, but it is not official, not guaranteed complete, and paths can move.
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
  - Must work without any internet data first, as reliability has not been proven for TFT-MATCH-V1.
- No live client integration.
  - Unfeasble in anyway, the LCU API doesn't even spit out TFT data.
- No real-time scouting or gameplay recommendations.
- No win-rate or statistical overlays.
- No full tournament bracket or standings management.
- No `.xlsx` import in the MVP.

## Architecture

The SvelteKit app has two primary surfaces.

`/admin` is the private operator surface. It owns tournament setup, catalog sync, player import, roster management, winner board composition, preview, publish, and hide actions.

`/gfx` is the public broadcast browser source. It renders a fixed 1920x1080 scene from the currently published graphic state. It does not expose editing and does not fetch Riot data.

The application runs as one SvelteKit service backed by libSQL. Operators and broadcast machines may access that service from separate hosts on the same trusted network or VLAN; workflows must not depend on access to the server's local filesystem from the browser machine.

Server-side modules are split by responsibility:

- `catalog`: syncs and stores pinned CommunityDragon/Data Dragon snapshots and asset references.
- `players`: stores reusable player records and handles CSV import preview/write.
- `tournaments`: stores tournament records and tournament roster membership.
- `winnerBoards`: stores draft and published winner board state.
- `uploads`: stores optional operator-uploaded player images under a controlled local directory.

All multi-step writes use libSQL transactions. In particular, draft replacement, catalog snapshot activation, publish, and hide operations either complete fully or leave the previous persisted and live state unchanged.

## Authentication And Access

- `/gfx` remains public for OBS/vMix browser sources.
- `/admin` and all of its server actions require an authenticated Better Auth session.
- `/setup` is available only while the Better Auth `user` table is empty. It creates the first operator account and redirects to `/admin`.
- Once any user exists, `/setup` redirects to `/login` and cannot create another account.
- `/login` is the only public sign-in surface. Public self-registration is not exposed.
- The Better Auth sign-up API itself rejects registration after the first user exists; hiding a registration page is not considered enforcement.
- `/admin` provides a POST-only logout action.

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
   - upload players from a ZIP player import bundle
   - preview CSV rows and image matches before writing
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

## Player Import Bundle

MVP import content is a directory bundle transported as a `.zip` upload, not a raw CSV alone and not a server filesystem path.

Bundle structure:

- `players.csv`
- `player_images/`

The ZIP root contains those entries directly. Absolute paths, `..` traversal, symlinks, encrypted entries, nested archives, and entries outside those two locations are rejected. Upload size, entry count, and expanded byte limits are enforced before preview extraction.

`players.csv` contains structured player data only. It does not set app-owned internal media paths directly.

Required CSV columns:

- `full_name`
- `display_name`
- `riot_id`

Optional CSV columns:

- `riot_game_name`
- `riot_tagline`

Import must have a preview step that shows:

- parsed rows
- missing required fields
- duplicate candidates
- matched player images
- players with no matching image
- image files that do not match any CSV Riot ID
- duplicate image candidates
- invalid Riot IDs
- rows that will create players
- rows that will update existing players
- rows that will be skipped

Preview stores the validated ZIP in an app-controlled staging directory and returns an opaque, expiring import token. Confirmation accepts only that token, revalidates its digest and expiry, and commits the exact bytes that were previewed. Expired staging records and files are removed opportunistically.

CSV import normalizes Riot identity from `riot_id`. Split columns are accepted as optional redundant data only when they match the normalized `riot_id`.

Image matching uses Riot ID. Image files may use the Riot ID directly or the legacy underscore
separator:

```txt
GameName#TAG.ext
GameName_TAG.ext
```

Example:

```txt
players.csv: riot_id = EarlGreyTeemo#sip
image file: player_images/EarlGreyTeemo#sip.png
legacy form: player_images/EarlGreyTeemo_sip.png
```

Supported image extensions:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

On confirmed import, the app copies matched images from `player_images/` into the managed media directory and stores the resulting internal `image_path`. Unmatched players still import without images. Extra image files are reported in preview and are not copied.

CSV parsing supports quoted fields, escaped quotes, commas inside quoted values, and CRLF/LF input. Riot IDs and image-key matching are case-insensitive for duplicate detection while preserving normalized display casing. Optional split Riot ID columns must match `riot_id` when present.

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

The lookup order is CommunityDragon requested locale, CommunityDragon `en_us`, Data Dragon requested locale, then Data Dragon `en_US`. CommunityDragon `latest` is resolved through `content-metadata.json` to an immutable major/minor patch path before catalog or asset URLs are stored. Data Dragon `latest` is resolved through its version list before using CDN endpoints. A Data Dragon snapshot is usable when champions load; augments may be empty because augments are optional for publishing.

Catalog icon references are normalized into renderable HTTPS URLs during ingestion. `/gfx` never receives raw client asset paths such as `/lol-game-data/assets/...`.

Network failure must leave the current active catalog untouched.

## Publishing Rules

Publishing requires:

- tournament selected
- winner selected
- at least one champion selected
- winner belongs to the selected tournament roster
- every champion and augment belongs to the tournament's active catalog snapshot

Publishing does not require:

- winner image
- augments
- Riot ID
- Riot API result

Admin actions fail closed. Failed save, upload, import, catalog sync, publish, or hide actions must not corrupt the live graphic state.

Saving a draft creates or replaces a selected draft transactionally and returns its ID to the admin page. Publishing that ID transactionally hides the previous published board and publishes the selected draft. Operators never type board IDs manually.

## Upload Rules

Uploads are for optional player images.

- Accept image MIME types only.
- Verify image content signatures for PNG, JPEG, and WebP instead of trusting filename extensions or browser-provided MIME alone.
- Store files under an app-controlled local upload directory.
- Store DB references to local paths.
- Serve player images through a controlled SvelteKit media route by database id.
- Do not let `/gfx` render arbitrary external image URLs.
- If a player has no image, the graphic uses a deliberate empty state.

## Broadcast Rendering

`/gfx` renders the current published board at 1920x1080.

When no board is published, or the board is hidden, `/gfx` renders a clean empty state suitable for OBS/vMix.

The admin preview renders the same component or data contract as `/gfx` so operators see what will go live.

An already-open `/gfx` client polls a lightweight published-state version endpoint once per second. The endpoint uses ETag/304 responses when unchanged; a changed version invalidates and reloads the published board. This supports several OBS/vMix and operator machines on the same VLAN without process-local pub/sub state.

## Testing And Validation

Database and schema tests:

- catalog snapshot can be active per tournament
- players can be reused across tournaments
- winner boards keep ordered champions and augments
- publishing one board does not mutate drafts unexpectedly
- failed transactional publish leaves the previous board live

Player import bundle tests:

- valid CSV creates players
- duplicate Riot ID or display name is detected in preview
- missing required fields are reported before writing
- Riot ID keyed image files are matched in preview
- unmatched image files are reported
- matched image files are copied into managed media only after confirmed import
- batch add does not duplicate existing tournament roster rows
- ZIP traversal, symlinks, unsupported content signatures, expired tokens, and digest mismatches are rejected

Catalog sync tests:

- successful sync stores champions/augments and asset references
- unavailable latest patch falls back to last available snapshot
- network failure leaves existing active catalog untouched

Route/action tests:

- incomplete publish is rejected when tournament, winner, or champions are missing
- publish works without winner image
- publish works without augments
- `/gfx` renders empty state when hidden or unpublished
- `/setup` works only before the first user exists
- anonymous `/admin` requests redirect to `/login`
- tournament roster and pinned-catalog boundaries are enforced server-side
- unchanged published-state version requests return HTTP 304

Manual visual validation:

- admin preview and `/gfx` render the same winner board
- 1920x1080 graphics fit OBS/vMix browser source without scrollbars

## Implementation Decisions For Planning

- First graphic layout is a fixed 1920x1080 winner board with winner identity, optional player image, champion list with nullable star levels, and optional augment list.
- MVP does not require motion. Animation can be added after the static graphic is production-safe.
- Player images are stored in a controlled upload directory and served through a SvelteKit media route, not directly from arbitrary external URLs.
- Riot ID is stored both as normalized display text and split game-name/tagline fields for later ACCOUNT-V1 automation.
- Player import is a bundle containing `players.csv` and `player_images/`; image filenames must match normalized Riot ID as `GameName_TAG.ext`.
- Catalog ingestion starts from CommunityDragon `{patch}/cdragon/tft/{locale}.json`, with Data Dragon champion and augment JSON as fallback.
- Keep the existing `@libsql/client` Drizzle driver and existing Vitest browser/server project configuration.
- Transport player import bundles as ZIP uploads with staged, expiring preview tokens.
- Enforce Better Auth for `/admin`; bootstrap the first account through one-time `/setup`.
- Refresh open broadcast sources with one-second ETag/version polling.
