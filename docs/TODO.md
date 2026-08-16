# TFT Production Graphics Status

The production MVP remains manual-safe, but TFT-MATCH-V1 is now the immediate priority. The scene-based Broadcast Graphics work begins after the API produces validated, persisted match snapshots; no scene may depend on a live Riot response to remain on-air.

## Completed

- [x] Combined auth, catalog, player, tournament, import, winner-board, and live-state schema.
- [x] Safe ZIP player import preview, expiring token confirmation, and controlled managed images.
- [x] CommunityDragon/Data Dragon normalization, fallback, and transactional catalog activation.
- [x] Authenticated Skeleton UI operator control surface with scoped roster and board composition.
- [x] Shared exact 1920×1080 preview and public `/gfx` broadcast renderer.
- [x] Transactional publish/hide controls and one-second ETag polling.
- [x] Server, browser-component, and multi-page end-to-end workflow coverage.
- [x] Standalone Node build and trusted LAN/VLAN deployment runbook.

## MUST FIX - Winner Composer

As of right now, this implementation does not allow any duplicates in the player's board. However, in normal TFT, any player can have a multiple of the same champions
on the playing field, either for strategy, or simply because they don't have enough champions, and the game auto fills the first 2 units in the queue.

These blockers must be fixed BEFORE any of the TFT-Match-V1 APIs are implemented:

- [x] Allow the board to have multiple instance of the same champion in the API.
- [x] Redesign the UI to have 2 different sections of the champion/augment select: one for the list of available units, and one for Selected Units.
- [x] For instances where there would be helper champions, or minion units/units that belong to a champion, do not disallow the user to select them.
  - Maintaining a whitelist will take too long, and is inconsistent, the API does not return what champions are what type, and only the operator, who plays the game more, can determine if it's a valid unit.

## Immediate Priority — TFT-MATCH-V1

- [ ] Design and implement the secure TFT-MATCH-V1 discovery, fetch, normalization, validation, and persisted-snapshot pipeline.
- [ ] Integrate validated match snapshots into Winner while retaining an explicit **Set up manually** path and the existing manual composer.
- [ ] Define the immutable eight-player snapshot contract consumed later by the read-only Post-Match scene.
- [ ] Ensure fetch, mapping, validation, and freshness failures preserve the last valid snapshot and every currently published graphic.

## After TFT-MATCH-V1 — Broadcast Graphics Scenes

Detailed design: `docs/superpowers/specs/2026-08-11-broadcast-graphics-scenes-design.md`.

- [ ] Extract Tournament Selection into a reusable, route-agnostic `TournamentSelector` component for every current and future GFX control page.
- [ ] Add one persisted broadcast context for the selected tournament, free-form Match Name, and free-form Game Name; expose it through a typed Svelte `createContext` provider.
- [ ] Split the operator surface into `/admin/graphics/global`, `/admin/graphics/hud`, `/admin/graphics/winner`, and `/admin/graphics/post-match`, with isolated scene contexts and commands.
- [ ] Build Global controls for tournament selection, Match Name, and Game Name with draft/save behavior and guarded tournament switching.
- [ ] Move the existing Winner workflow to its dedicated route without changing its preview/save/publish/hide safety model or its API/manual fallback.
- [ ] Build the HUD control and transparent 1920×1080 GFX overlay showing tournament, match, and game names with preview/save/publish/hide controls.
- [ ] Build a read-only Post-Match control and GFX scene for all eight players' placements, augments, and champions from validated match snapshots; do not permit operator edits to API match data.
- [ ] Separate OBS outputs into `/gfx/hud`, `/gfx/winner`, and `/gfx/post-match`, with independent immutable publications and ETag/version polling channels.
- [ ] Keep `/gfx` and `/gfx/version` as backward-compatible aliases for Winner.
- [ ] Verify that an API or scene failure never clears another scene or replaces its last successful live publication.

## Later

- [x] Rehearse the deployment on the final production VLAN and firewall rule before the first show.
- [ ] Consider motion only after the static HUD, Winner, and Post-Match workflows have operated successfully in production.
