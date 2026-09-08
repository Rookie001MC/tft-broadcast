# Player relay admin status design

## Goal

Replace the misleading Player LCU collector guidance on the broadcast admin post-game page with a password-safe Player Relay status card and setup instructions.

## Scope

The status card belongs on the authenticated `/admin/post-game` page. It describes the new Player LCU relay only; the existing `EOG_INGEST_TOKEN` collector remains a separately labeled legacy workflow.

## Status data

The server-side page load reads files below `MEDIA_ROOT/player-relay/` directly. It returns safe, minimal metadata:

- relay password state: `Waiting for first Player LCU client`, `Relay password configured`, or `Relay storage unavailable`;
- the current broadcast relay URL, derived from the admin request origin;
- receipt count;
- latest receipt's game ID, capture ID, and received-at timestamp, if any.

It never returns the relay password, verifier, salt, full capture envelope, or raw game JSON. The page's existing three-second invalidation refresh keeps this status current without adding a public API endpoint.

## Operator UI

Place a prominent **Player LCU Relay** card above the manual JSON import area. It shows a colored configuration badge, the broadcast relay URL, recent receipt activity, and this setup sequence:

1. Open TFT Player Relay on one Player PC.
2. Enter or Generate a relay password, then save settings to initialize the relay.
3. Copy the shared password into every other Player LCU client and save settings.
4. Use Test connection before matches; inspect the latest received game data here after a match.

Retain the existing details block only for the legacy direct collector and explicitly state that its `EOG_INGEST_TOKEN` does not configure Player Relay.

## Error handling

Missing verifier and receipt directories represent a newly started relay, not an error. Malformed or unreadable verifier/receipt files surface a safe storage-unavailable state and omit latest capture metadata. Receipt enumeration is bounded to the existing relay retention limit and ignores non-JSON files.

## Verification

Automated tests are waived due to the event time constraint. Verify the page type-checks without introducing new relay diagnostics, run formatting/diff checks, and manually inspect the status helper with absent, configured, and recent-receipt file states.
