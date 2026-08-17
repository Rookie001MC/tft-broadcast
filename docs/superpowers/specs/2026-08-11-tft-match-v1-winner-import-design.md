# TFT-MATCH-V1 Winner Import Design

## Status

Approved design for fetching recent TFT matches through Twisted, reviewing one participant's champion board, and importing it into the existing Winner composer without changing the database during browsing. This revision incorporates the completed ordered-unit-instance and helper-unit requirements from `2026-08-15-winner-composer-unit-instances-design.md`.

This design is the authoritative TFT-MATCH-V1 contract for the immediate API work. It supersedes provisional assumptions in the later Broadcast Graphics Scenes design that Winner must select the first-place participant, that API data is non-editable, or that match history supplies augments. The later Post-Match design must consume the champion-only snapshot contract defined here.

## Goals

- Add a safe **Fetch API Data** workflow beside the existing Live and Reset controls.
- Let an operator choose any eligible player from the selected tournament roster.
- Fetch only that player's ten newest TFT matches through Twisted.
- Let the operator choose any returned match regardless of placement.
- Preview the selected participant's champions and star levels before changing the composer.
- Preserve Riot's ordered unit instances, including repeated champion IDs and helper, summon, or minion units.
- Populate the existing editable composer without saving, publishing, or otherwise writing during browsing.
- Persist an immutable, normalized eight-player snapshot only when the operator uses the existing composer Save action.
- Preserve the existing manual title, augment editing, Save, Live, and Reset workflow.
- Ensure every fetch, mapping, validation, cache, and save failure leaves saved state and live graphics unchanged.

## Non-Goals

- Importing or persisting augments from TFT-MATCH-V1.
- Historical backfill or fetching more than ten recent matches.
- Background refresh, polling, or automatic match selection.
- Supporting multiple Riot regions in one running deployment.
- Calling Riot directly with `fetch` or another HTTP client outside Twisted.
- Persisting match-list browsing state or pending previews.
- Building the future Post-Match control or graphic in this phase.
- Inferring a winner from `win` or requiring placement 1.

## Architecture Decision

Use Twisted as the only Riot API client, a small process-local preview cache for transient validated responses, and the existing Winner Save boundary for all persistence.

The cache is intentionally disposable. A restart, eviction, or expiration may require the operator to fetch again. Pending previews do not need to survive because the application is expected to run as one local or otherwise single-process server and the data can be fetched again cheaply. SQLite remains the source of truth only for completed saves.

A signed client payload and a refetch-on-save workflow were rejected. Signed payloads add key management and transport complexity that this deployment does not need. Refetching on Save adds latency, spends more Riot requests, and can fail after the operator has already reviewed a board.

## Runtime Configuration and Riot Routing

The API feature uses two configuration values with different ownership:

- `RIOT_API_KEY` remains a private server environment value already represented in `.env.example`.
- The active TFT platform region is an application setting selected by an authenticated operator under `/admin/settings` and persisted in SQLite.

The Settings page renders one **TFT platform region** dropdown containing every entry from Twisted's `Constants.Regions` enum. The server derives the safe `{ value, label }` options from that enum; the Svelte component must not maintain a second hard-coded region list. The stored value is the enum's platform code, such as `VN2`. Saving requires an exact supported value and takes effect for the next API request without restarting the process.

The selected region is not secret and may be included in authenticated page data and availability DTOs. The API key remains server-only and must never be serialized into page data, action data, logs, cache tokens, or error messages.

Both the private key and one persisted region selection are required for **Fetch API Data**, but neither is required for the application to boot or for the manual Winner workflow to operate. Missing or invalid configuration disables only the API control and exposes its reason in a hover/focus popover.

The server revalidates the persisted region against Twisted's platform enum whenever it builds API configuration. It derives the TFT match routing group with `Constants.regionToRegionGroup` and the Account API routing group with `Constants.regionToRegionGroupForAccountAPI`. Operators configure one active platform region; they do not configure separate routing groups.

The region setting uses a dedicated singleton `tft_match_settings` table. No row means no region is selected. Changing the row invalidates pending previews through the existing region cache binding, but does not delete immutable snapshots, change saved Winner state, or affect any published graphic.

## Twisted Request Boundary

Application code creates `RiotApi` and `TftApi` clients with the configured key. It does not issue a separate raw request to Riot.

Every discovery endpoint remains inside the authenticated admin boundary and calls the existing admin guard. The browser submits only a local roster player ID. The server verifies that player still belongs to the selected tournament and reads the normalized Riot ID from SQLite; it does not accept an arbitrary Riot ID or PUUID from the browser. The history endpoint requests details only for IDs returned by Twisted's preceding ten-match list call. The browser cannot submit an arbitrary match ID for lookup, so the endpoint cannot be used as a general Riot API proxy.

Choosing an eligible player performs:

1. `RiotApi.Account.getByRiotId(gameName, tagline, accountRegionGroup)` to resolve the stored Riot ID to a PUUID.
2. `TftApi.Match.list(puuid, matchRegionGroup, { count: 10 })` to obtain exactly the ten newest available match IDs.
3. One `TftApi.Match.get(matchId, matchRegionGroup)` per returned ID to obtain the summary and participant board required by the dialog.

Match details are fetched sequentially with an independent failure boundary per ID. This is deliberately simple and rate-limit-friendly. A failed detail request disables only that match row; it does not discard other successful matches. Successful summaries are sorted by `game_datetime` descending instead of trusting response order. The workflow does not set `startTime`, `endTime`, or any backfill range. It applies no additional age cutoff: the ten-result window and displayed match timestamp are the complete freshness policy.

Twisted performs the HTTP traffic internally. The application unwraps Twisted's response DTOs and translates transport, authentication, not-found, rate-limit, and service errors into safe operator messages.

## Actual Response Contract

The supplied current response demonstrates a newer shape than Twisted's declarations and portions of the local OpenAPI description:

- `metadata.data_version`, `metadata.match_id`, and `metadata.participants` identify the payload.
- `info.game_datetime`, `game_length`, `game_version`, `queue_id`/`queueId`, `tft_game_type`, `tft_set_core_name`, and `tft_set_number` describe the match.
- `info.participants` contains eight participants.
- Participant identity uses `puuid`, with `riotIdGameName` and `riotIdTagline` when available.
- `placement` is authoritative for display.
- `units[].character_id` identifies a unit and `units[].tier` supplies its star level.
- `augments` is absent.
- `win` is not authoritative; the example has multiple non-first-place participants with `win: true`.
- Non-playable entities such as summoned units may appear in `units`.

The validator therefore consumes a stable subset and permits unknown additional fields. It does not require augments, `win`, item fields, traits, missions, companion details, or one exact spelling for redundant queue fields.

## Canonical Snapshot Contract

Successful normalization produces a versioned immutable JSON value with this logical shape:

```js
{
	contractVersion: 1,
	source: {
		provider: 'riot',
		region: 'VN2',
		matchId: 'VN2_5609022365',
		dataVersion: '6',
		fetchedAt: '2026-08-11T00:00:00.000Z'
	},
	match: {
		completedAt: '2026-07-26T08:22:44.044Z',
		durationSeconds: 1920.063,
		gameVersion: 'Linux Version 16.14.794.9266',
		queueId: 1100,
		gameType: 'standard',
		setNumber: 17,
		setCoreName: 'TFTSet17'
	},
	participants: [
		{
			puuid: 'example-puuid',
			riotId: { gameName: 'Player', tagline: 'TAG' },
			placement: 1,
			level: 9,
			champions: [
				{
					externalId: 'TFT17_Aatrox',
					catalogChampionId: 'catalog-champion-aatrox',
					displayName: 'Aatrox',
					iconPath: 'catalog-assets/snapshot/champions/aatrox.png',
					starLevel: 2,
					displayOrder: 0
				}
			]
		}
	]
}
```

Valid snapshots contain exactly eight participants sorted by placement. Each participant's champions preserve Riot's unit order and remain separate instances even when multiple entries share one champion identity. The embedded champion identity and presentation metadata make the contract stable for later read-only consumers without another Riot request. Augments are not present in the contract.

## Validation and Catalog Mapping

A match is eligible only when all of these conditions hold:

- The response match ID equals the requested match ID.
- When `endOfGameResult` is present, its value is exactly `GameComplete`.
- There are exactly eight participants.
- Participant PUUIDs are non-empty and unique.
- Placements are unique integers covering 1 through 8.
- The chosen player's resolved PUUID appears exactly once.
- Required match timestamps, duration, version, queue, and set fields have valid primitive values.
- Every unit has a non-empty `character_id` and an integer tier from 1 through 3.
- Every unit maps to a champion row in the tournament's active catalog snapshot.

Catalog mapping uses exact `character_id` to `catalog_champions.external_id` matching inside the active snapshot. It preserves every mapped unit as a separate ordered instance, including repeated champion IDs and rows marked `isExcluded`; that catalog flag remains a maintenance/operator concern and is not evidence that Riot's match unit should be discarded. The normalizer must not maintain or infer a whitelist of playable units. Any missing mapping blocks that match instead of constructing a partial snapshot. The disabled match popover lists the unresolved external IDs so the operator can correct the catalog deliberately.

The normalizer ignores `win`, augments, traits, items, companion data, and missions. It never guesses a champion by display name.

## Process-Local Preview Cache

The cache is a module-level `Map` keyed by a cryptographically random opaque token. One entry represents one player-history fetch and contains:

- creation and expiration timestamps
- configured region
- tournament ID
- active catalog snapshot ID
- selected local player ID
- selected Riot PUUID
- successfully normalized snapshots keyed by Riot match ID
- per-match safe failure reasons for details that could not be loaded or normalized

Entries expire after 15 minutes. The cache retains at most 32 player-history batches and evicts the oldest batch when the cap is exceeded. Expired entries are removed lazily during cache reads and writes; no timer or background job is required.

The browser receives the opaque token plus safe match summaries and the selected participant's mapped champion preview for each valid match. It never receives the API key. Returning normalized preview fields is acceptable because the server does not trust them as the persisted snapshot; Save resolves the authoritative cache entry again.

The cache entry is removed only after a successful API-backed Save. A failed Save leaves it available until normal expiration or eviction.

## Database Model and Write Boundary

Browsing, player selection, match loading, match selection, and **Use this board** perform no database writes.

The API work adds an append-only `tft_match_snapshots` table containing:

- snapshot UUID
- Riot match ID
- configured platform region
- tournament ID
- selected local player ID
- active catalog snapshot ID
- contract version
- normalized payload JSON
- Riot fetch timestamp
- save timestamp

Winner state gains a nullable source snapshot reference. The reference means the Winner draft was API-assisted from that snapshot; it does not make the editable Winner board a second immutable copy of the snapshot.

The existing `saveBoard` form accepts optional preview token and Riot match ID fields. When present, the server:

1. Resolves the cache entry.
2. Verifies the tournament, selected player, configured region, and active catalog snapshot still match.
3. Revalidates the canonical snapshot contract.
4. Inserts the immutable snapshot and saves the current composer values in the same database transaction.
5. Preserves the existing behavior that saving while Winner is Live advances the immutable Winner publication.
6. Removes the cache entry only after the complete save succeeds.

The operator may adjust the populated composer before Save. The persisted snapshot remains the exact validated Riot snapshot; the Winner board persists the operator-reviewed composer values. A later manual Save without a valid API preview clears the Winner source reference but does not delete prior immutable snapshots.

An expired, evicted, restarted-away, or stale preview returns a conflict without falling back silently to an API-linked save. The operator must fetch again before saving that API-assisted draft. Composer sessions that did not import an API preview continue through the unchanged manual Save path.

## Dialog Interaction

### Entry control

**Fetch API Data** appears in the existing control row beside Live and Reset. It follows the current Skeleton visual language rather than introducing a separate page style.

The control is unavailable when the key, region, selected tournament, active catalog, or roster is missing. Its wrapper exposes the reason through the same hover/focus popover pattern used for other unavailable choices.

### Stage 1: choose a player

The control opens a padded full-screen native dialog. The heading asks, “Which player do you want to fetch data from?” It shows the selected tournament's roster in its existing display order.

Players with both normalized Riot game name and tagline are selectable. Players without a complete Riot ID remain visible but are greyed out. Hovering or keyboard-focusing their wrapper opens a popover explaining that a Riot ID is required.

### Stage 2: load recent matches

Choosing a player replaces the body with a centered spinner and “Please wait…”. The status is announced through an ARIA live region.

After loading, the dialog shows at most ten matches newest first. A successful row shows completed date/time, placement for the selected player, game type, set, and Riot match ID. A failed or invalid row remains visible and unavailable. Hovering or focusing it opens a popover containing its concise reason, including missing champion external IDs when relevant.

### Stage 3: verify the board

Choosing a valid row displays:

- “Please double-check this is the correct board.”
- selected local player and Riot ID
- match date/time, placement, game type, set, and match ID
- a vertical flex-column champion list with icon, display name, and star level

The actions are **Back** and **Use this board**. There is no double-click or second confirmation.

### Stage 4: return to the composer

**Use this board** closes the dialog without a server request. It replaces only:

- winner player ID
- champion IDs and order
- champion star levels
- hidden API preview token and match ID

It preserves the existing title and manually managed augments. The composer becomes an unsaved draft and displays “API board loaded. Review it, then Save.” Focus moves to the composer review/save area. Only the original composer Save persists or updates a live publication.

The dialog supports Escape, explicit Back/Close controls, focus containment, and focus restoration to the trigger when dismissed without importing.

## Failure Isolation and Operator Messages

All expected failures stay inside the dialog or the existing composer action feedback:

- Missing or invalid API configuration disables the entry control with a configuration reason.
- Riot ID lookup failure keeps the roster stage available for another selection.
- Authentication and authorization errors report that the Riot key is unavailable or invalid without exposing it.
- Rate limits report that Riot is temporarily limiting requests and invite a retry.
- Service, timeout, and transport failures report temporary unavailability.
- A failed match list keeps the selected player context and permits Back or Retry.
- A failed match detail disables only that match row.
- Mapping or validation failures disable the affected match and expose exact safe reasons in its popover.
- Cache expiry, eviction, or restart loss asks the operator to fetch again.
- A changed tournament, region, player identity, or active catalog rejects the stale preview.
- A database or publication-preparation failure rolls back both the snapshot and Winner save.

No API-related failure resets the composer, deletes an older snapshot, changes the saved board, clears a live pointer, advances the graphics version, or replaces an immutable publication.

## Server and Component Boundaries

Implementation is divided by responsibility:

- Region settings: Twisted-derived safe choices, singleton persistence, and the authenticated Settings form.
- Riot gateway: Twisted clients, region derivation, account lookup, match IDs, and match details.
- Match contract: response validation, canonical normalization, and catalog mapping.
- Preview cache: token lifecycle, bounded process-local entries, and lookup binding.
- Snapshot repository: append-only snapshot insertion integrated with Winner Save.
- Fetch dialog: roster, loading, history, verification, popovers, and draft handoff.
- Winner composer: accepts an API-derived draft and optional preview source while retaining all current manual controls.

The gateway receives its Twisted clients as dependencies so tests never contact Riot. Normalization and cache modules remain independent of Svelte components and database globals.

## Testing and Acceptance

### Contract and normalization tests

- The provided real response shape validates with absent augments and additional unknown fields.
- Exactly eight unique PUUIDs and placements normalize in placement order.
- The selected participant is found by resolved PUUID, not display name or `win`.
- Multiple `win: true` values do not affect placement or eligibility.
- `character_id` maps exactly and `tier` becomes star level.
- Duplicate champion IDs remain distinct ordered instances.
- Mapped helpers, summons, minions, and `isExcluded` catalog rows are preserved without a unit-type whitelist.
- Unknown champions, invalid tiers, missing selected PUUID, invalid placement sets, incomplete matches, and malformed primitives are rejected.

### Gateway and cache tests

- Region option generation exposes every `Constants.Regions` entry exactly once, settings persistence rejects arbitrary values, and no API key reaches Settings page data or action results.
- Region helpers receive the configured platform region.
- Account lookup, `count: 10`, newest-first summaries, and sequential detail requests use Twisted only.
- No backfill time parameters are sent.
- One failed detail preserves other matches and returns a disabled reason.
- Authentication, rate-limit, not-found, timeout, and service failures become safe messages.
- Cache tokens are unpredictable, expire after 15 minutes, cap at 32 batches, bind to their tournament/player/catalog/region, and survive a failed Save until expiry.
- A successful Save removes its cache batch.

### Repository and action tests

- Browsing endpoints do not write to SQLite.
- Manual Winner Save remains unchanged when no preview token is supplied.
- API-backed Save inserts one immutable snapshot and Winner state atomically.
- Saving while live retains the existing publication-advance behavior.
- Expired, unknown, mismatched, or stale previews change neither saved nor live state.
- Failed snapshot insertion, Winner replacement, media preparation, or publication advancement leaves no partial snapshot and preserves the prior live publication.

### Component tests

- The Settings dropdown contains the server-derived Twisted region choices, displays the persisted selection, and reports save validation failures without losing the current value.
- **Fetch API Data** appears beside Live and Reset.
- Ineligible players and invalid matches are greyed out and cannot be activated.
- Their reasons appear on hover and keyboard focus.
- Loading and failure statuses are announced.
- Match history renders no more than ten rows newest first.
- Verification renders the selected participant's champions in a flex column.
- Repeated champion IDs render as separate rows and populate separate composer instances in Riot order.
- **Use this board** replaces winner, champions, and star levels while preserving title and augments.
- Dismissing the dialog makes no composer or database change and restores focus.
- An imported draft is visibly unsaved and the original Save remains the only persistence control.

### End-to-end acceptance

- An authenticated operator can select an eligible roster player, review ten recent matches, preview any valid placement, import its champion board, and save through the existing composer.
- The workflow uses a fake injected Riot gateway and never a real key or live Riot service in automated tests.
- Missing configuration leaves manual Winner fully functional.
- Restart-lost previews fail safely and can be fetched again.
- API, cache, validation, mapping, and save failures never blank or mutate the current live graphic.

## Documentation Updates

Implementation documents `RIOT_API_KEY` as the only private environment value for this feature, describes region selection under `/admin/settings`, and records the ten-match/no-backfill policy. `.env.example` must not contain `RIOT_REGION`.

After verification, `docs/TODO.md` marks the TFT-MATCH-V1 discovery, validation, persistence, and Winner integration items complete. It also removes augment expectations from the immediate snapshot contract and defers any future augment source to a separate design.

## Completion Criteria

- The API button and full-screen review dialog implement the approved four-stage workflow.
- Riot access goes exclusively through Twisted using one configured platform region.
- An authenticated operator can select any Twisted platform region under Settings without restarting the process.
- Only ten fresh matches are requested and no historical backfill occurs.
- Current responses without augments validate and import champion boards correctly.
- Any unmapped unit blocks only the affected match with a hover/focus reason; duplicate and mapped helper/minion instances remain intact.
- Browsing and **Use this board** write nothing to SQLite.
- The original Save atomically stores the eight-player champion snapshot and Winner state.
- The existing manual composer and Save/Live/Reset behavior remain intact.
- All failure paths preserve saved state and live publications.
- Contract, gateway, cache, repository, component, and end-to-end tests pass.
