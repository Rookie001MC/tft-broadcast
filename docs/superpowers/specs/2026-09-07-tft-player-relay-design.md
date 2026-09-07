# TFT Player Relay Design

Date: 2026-09-07

Status: Product choices agreed; technical specification proposed for implementation. The `players-lcu-client/` Avalonia skeleton exists; feature implementation and the receiver contract remain proposed.

Implementation plan: [TFT Player Relay Implementation Plan](../plans/2026-09-07-tft-player-relay.md).

Inspiration: <https://github.com/RCVolus/league-observer-tool>

## Purpose

Provide a Windows application that a player opens before a tournament game. After configuration, it automatically discovers the local League client, captures TFT End of Game (EOG) results, persists them locally, and forwards them to the broadcast server with visible delivery confirmation.

The first milestone is one real TFT result captured, persisted, uploaded, and acknowledged. Reliability under client restarts and network failures is part of the release requirement.

## Agreed product decisions

- C# and Avalonia UI in the existing `players-lcu-client/` project in this repository. Extend that project in place; do not create a second client under `apps/player-relay/`.
- The current client targets `net10.0`, uses Avalonia `11.3.11` with compiled bindings, and pins `Thresh.Extensions` `1.0.0` as its LCU library.
- Windows 10/11 x64, a portable self-contained executable, manual launch, and minimize-to-tray support.
- Avalonia-rendered desktop controls are accepted; an embedded browser is not part of the architecture.
- Configurable Host, Port, and auth token. Defaults: Host `127.0.0.1`, Port `5173`.
- LAN/VLAN deployment with a reachable server listening port. `127.0.0.1` targets the Player PC itself; venue configuration uses the server's actual reachable address.
- Automatic capture and upload while running; no per-result player confirmation.
- The coworker owns received-data interpretation, server ingestion, and web integration. Separate GFX routes and scenes are outside this work.

## Scope

In scope: Windows client discovery, read-only LCU access, result capture, durable local queue, authenticated delivery, settings, status UI, diagnostics, tests, packaging, and a proposed receiver contract with a test receiver.

Out of scope: game-data normalization, champion mapping, eight-player result reconciliation, tournament roster mapping, winner selection, publishing graphics, Riot web API imports, game automation, process-memory reading, game configuration edits, remote administration, automatic app updates, installers, Windows services, and additional operating systems.

The desktop client transports observations. Delivery success means the server durably received an observation; it does not mean the observation was accepted as a tournament result or published.

## Architecture and repository boundaries

```text
Local League client
  -> LCU discovery and authenticated local connection
  -> EOG capture coordinator
  -> durable SQLite queue
  -> HTTP uploader
  -> coworker's ingestion endpoint

Avalonia UI <-> application status and commands
```

The existing `players-lcu-client/players-lcu-client.csproj` is a single Avalonia desktop project. Keep the following boundaries as folders/namespaces within that project first; extract them into adjacent projects only when a concrete build or test need justifies it:

- `Core/`: capture envelopes, lifecycle rules, queue/transport interfaces, and retry policy. It has no Avalonia or Thresh dependencies.
- `Infrastructure/Lcu/`: the `Thresh.Extensions` `1.0.0` adapter behind `ILcuGateway`; Windows discovery, local LCU HTTP/WebSocket access, and its lifecycle handling.
- `Infrastructure/Storage/`, `Infrastructure/Configuration/`, `Infrastructure/Security/`, `Infrastructure/Transport/`, and `Infrastructure/Diagnostics/`: SQLite, credentials, settings, receiver delivery, and diagnostics.
- `Views/`, `ViewModels/`, `App.axaml`, and `Program.cs`: Avalonia views/view models, tray, composition, and single-instance lifecycle. The skeleton already supplies these entry points.
- `contracts/v1/`: versioned schema, example requests/responses, and receiver responsibilities.
- `tests/`: future unit, persistence, transport-integration, and Avalonia UI test projects/fixtures.
- `tools/mock-receiver/`: future development-only receiver and fault scenarios; never a production server.
- `docs/` and `scripts/`: client-specific evidence, verification, and publish documentation.

`players-lcu-client` already enables nullable reference types and compiled Avalonia bindings. Preserve both. Keep `Thresh.Extensions` pinned at `1.0.0` behind the gateway boundary so a rehearsal-proven replacement remains localized if needed. Add and pin compatible SQLite, test, and Windows-specific packages only when their implementation work starts. The existing web project remains JavaScript/JSDoc. Keep desktop build artifacts, local captures, and credentials out of Git and web build inputs.

## Desktop workflow

On first launch show Host, Port, auth token, and an HTTP/HTTPS choice. Default scheme is HTTP for the requested trusted LAN workflow. Explain localhost inline. Validate host syntax and port range 1–65535; construct the destination without allowing credentials or paths in the Host field.

Save persists settings; Test connection calls the authenticated receiver handshake. Once configured, capture starts automatically even when the server is unavailable. A missing or rejected token blocks uploads, not local capture. HTTP carries the token without encryption; use a device-scoped ingestion token and support HTTPS with normal certificate validation when the venue provides it.

The main window shows independently:

- League: searching, connected, reconnecting, or actionable discovery failure.
- Detected player identity, including changes after account switching.
- Capture: waiting, capturing, paused, or storage/capture error.
- Server: unchecked, connected, retrying, authentication required, or incompatible.
- Pending/rejected counts, last capture time, last acknowledged capture, and a bounded recent-history list.

Controls: Settings, Test connection, Pause/Resume, Retry pending, Export diagnostics, Show last result metadata, and Exit. Pause suspends both new captures and uploads; explain that results can be missed while paused. Resume performs a recovery read and resumes pending delivery.

Closing the window hides it to the tray after a first-use explanation. Tray commands expose Show, Pause/Resume, and Exit. If tray initialization fails, keep the window accessible and do not hide on close. Exit cancels background tasks, completes or rolls back local writes, and leaves queued captures for the next launch. A second process activates the existing window instead of starting another collector.

## LCU connection and capture

The repository's `@hasagi/types` reference declares both GET `/lol-end-of-game/v1/tft-eog-stats` and `OnJsonApiEvent_lol-end-of-game_v1_tft-eog-stats`. The local JSON fixture contains `gameId`, `localPlayer`, and `players`, including board pieces. These establish a candidate API, not proof of lifecycle behavior on current Windows clients.

Implement LCU discovery, local HTTP/WebSocket connection, and subscription through the pinned `Thresh.Extensions` `1.0.0` adapter behind `ILcuGateway`. The first Windows spike must verify its discovery behavior against real client process/lockfile evidence, including non-default install paths. Never assume a fixed LCU port or password. Local LCU authentication material remains in process memory and is never uploaded, logged, or included in diagnostics.

Bind local requests to the discovered loopback endpoint and verified client lifetime. Isolate any LCU-specific certificate handling to that connection; do not weaken validation for the broadcast-server HTTP client. Try normal-user access first. Report access-denied or multiple-client ambiguity rather than silently connecting to an arbitrary process or automatically elevating.

Subscribe to relevant EOG events, perform a recovery GET after connecting, and use bounded fallback polling only when needed. On a result event, retrieve the current endpoint JSON with one request in flight. Preserve a dirty/rescan flag for events arriving during a fetch so the latest revision is fetched afterward. Null/deleted resources mean no result is currently available; they never clear queued data.

Validate only the transport minimum: bounded valid JSON object, usable game identity, and local player identity consistent with the capture context. Preserve unknown fields, duplicate board units, helpers, empty augment lists, and the complete EOG object. Do not enforce the Riot TFT-MATCH-V1 canonical schema or require eight complete participants here.

Assign each distinct observation a capture ID and monotonically increasing local sequence within one installation. Preserve the original response JSON string and SHA-256 of its UTF-8 bytes. Identical bytes for the same destination, source platform, game, and local PUUID reuse the stored observation within the deduplication retention window. Changed bytes are a new observation; a formatting-only change may create an extra observation and is safe. Do not overwrite prior captures or claim every observation is final.

Record discovery mode as `event` or `recovery`. A startup/reconnect/resume read can expose an older game: transmit it as a recovery observation without inventing a game-end timestamp or associating it with the server's current game. Capture time is observation time only. Read source platform metadata where available; allow unknown explicitly rather than guessing from language or host.

Account switching cancels the previous connection generation. Queued captures retain the identity originally captured; they must not be rewritten using the newly signed-in player. Reject inconsistent reads and reconnect when account/client identity changes during capture.

## Durable local storage and limits

Store settings, credentials, queue, and rotating diagnostics under `%LOCALAPPDATA%/TftPlayerRelay/`, not beside the executable. Store the server token using Windows user-bound protection. The executable is portable; its user data remains machine/user scoped. Generate a random installation ID, not a hardware fingerprint.

Use SQLite transactions for capture payload, ID, sequence, hash, destination binding, and delivery state. Commit before scheduling an upload. On restart, recover interrupted `sending` records as pending. Storage schema upgrades must preserve pending captures; refuse unsupported newer schemas instead of recreating the database.

Proposed initial bounds, to be measured during the spike:

| Resource | Bound / behavior |
| --- | --- |
| EOG JSON | 4 MiB per observation, enforced while reading |
| Pending and rejected captures | 1,000 records or 256 MiB payload bytes, whichever comes first |
| Acknowledged payloads | Remove payload after durable local acknowledgment update |
| Acknowledged metadata/deduplication | 30 days, maximum 10,000 records |
| Logs | Five files of 2 MiB each; no payloads or secrets |
| UI history | Latest 100 records, loaded incrementally |
| Upload concurrency | One request; no unbounded task/channel backlog |
| HTTP response body | 64 KiB maximum |

At queue capacity or disk failure, preserve existing pending data, stop accepting additional captures, and show that new results may be missed. Do not silently evict unacknowledged captures. Rejected records remain visible and can be exported or explicitly removed with confirmation. Bound database file growth and reclaim free space opportunistically outside active capture; include WAL and temporary files in disk measurements.

Destination edits create a new destination profile. Pending captures stay bound to their original profile and never move automatically to a different server/event. Token replacement may update the same profile only after a handshake confirms the same server and event identifiers. Before the first handshake, captures are held under an unverified destination profile; the server must not automatically attach these recovery/unknown-context observations to a current match.

## Proposed receiver contract v1

These routes do not exist yet. The coworker must implement the receiver side or agree changes before integration. The desktop implementation can proceed against the mock after the contract is frozen.

### Handshake

`GET /api/player-relay/v1/handshake`, authenticated with `Authorization: Bearer <token>`.

Success returns JSON with `protocolVersion: 1`, stable `serverId`, `eventId`, and `maxPayloadBytes`. This validates credentials and identifies destination scope without submitting game data. An ordinary successful web-page response does not count as a successful handshake.

### Capture delivery

`POST /api/player-relay/v1/captures`, with Bearer authentication, `Content-Type: application/json`, and `Idempotency-Key: <captureId>`.

| Field | Contract |
| --- | --- |
| `protocolVersion` | Integer `1` |
| `captureId` | UUID, persisted once and reused on retry |
| `installationId` | Random persistent UUID |
| `sequence` | Monotonic installation-local integer encoded as a decimal string |
| `capturedAt` | UTC ISO timestamp; not asserted game completion time |
| `appVersion` | Packaged application version |
| `observationKind` | `event` or `recovery` |
| `sourcePlatform` | LCU-derived platform identifier or null |
| `gameId` | Original game identifier represented as a string |
| `localPlayer` | PUUID and Riot ID components when available |
| `context` | Captured server/event IDs when verified, otherwise null |
| `payloadSha256` | Lowercase hex SHA-256 of UTF-8 `payloadJson` |
| `payloadJson` | Original EOG JSON as a string; receiver parses it for interpretation |

Using a JSON string preserves the original observed payload and makes hash verification independent of outer-envelope serialization. Allow up to 32 MiB for the encoded request body so a 4 MiB payload remains transportable after escaping; both sides also enforce the decoded payload bound. Do not upload local LCU secrets or machine paths.

Receiver authenticates a revocable device-scoped ingestion token, validates envelope/hash/size, and atomically persists the capture and its deduplication identity. It returns `201` with `{ captureId, status: "stored", receivedAt }` only after durable storage. Repeating the same capture ID and content returns `200` with `status: "duplicate"`; the same ID with different content returns `409`. Deduplication is scoped by server/device identity and capture ID, not game ID alone.

The client accepts only a matching capture ID and recognized status on the specified success codes. HTML, malformed JSON, `202`, a mismatched ID, or an unexpected success body is not an acknowledgment. A lost acknowledgment results in a retry of the same immutable envelope.

Timeouts, connection failures, `408`, `429`, and `5xx` retry with exponential backoff and jitter, starting around 1 second and capped at 60 seconds; honor bounded `Retry-After` values up to five minutes. Use a 10-second request timeout. Authentication failures pause delivery until settings are corrected. `400`, `409`, `413`, and `422` retain the record as rejected with a safe error code; `404`, redirects, unsupported versions, and malformed acknowledgments surface endpoint/protocol problems without tight retry loops. Do not follow redirects with credentials. Later eligible records may proceed past an individually rejected capture; receiver processing must tolerate out-of-order observations.

Receiver owns cross-PC duplicates, changed observations of one match, platform identity ambiguity, stale recovery data, and tournament association. The client never treats a handshake event ID or timestamp as proof that a game belongs to that event. Receiver storage does not publish or overwrite any live graphic automatically.

## Performance and reliability acceptance

No game data reads, disk operations, or HTTP waits may block the UI thread. Reuse transport clients and bound buffers. Each reconnect cancels/disposes old sockets, subscriptions, timers, and cancellation sources. Redact auth headers, local passwords, raw results, and personally identifying payload fields from routine logs and diagnostic export.

Measure CPU, private bytes, working set, handles, threads, network activity, and queue/database growth on an actual venue-class PC. Proposed budgets: idle average CPU below 1% of total machine capacity, steady-state private bytes below 150 MiB, and no sustained growth across 100 reconnects or an eight-hour soak after warmup. Record hardware and sampling method. These are release targets, not measured claims; investigate misses before changing them.

## Packaging and release gates

Publish a release `win-x64` self-contained single-file executable, embedding resources and native dependencies as required. Native dependency extraction and app data may still write to user storage; a single distributable is not a zero-write application. Native AOT is an optional measured packaging experiment, not a prerequisite. Manual replacement of the executable is the first-release update method.

Verify on the actual Windows 10/11 builds used by the venue, without a separately installed .NET runtime, Node, SDK, or administrator launch. Confirm file dialogs, tray, Unicode paths, protected token storage, writable user storage, and clean shutdown. A Linux build or mock test does not prove Windows runtime behavior. Signing/distribution acceptance must be checked on venue PCs before rehearsal; do not prescribe disabling platform protections.

Required scenarios: real EOG capture, early elimination, eventual first-place finish, result revisions, null/no-result, launch after a result, League restart, account switch, server outage, lost acknowledgment, full queue, disk failure, process kill/relaunch, changed destination, invalid credentials, duplicate process, and overnight idle operation.

## Coordination and evidence gates

1. Freeze receiver routes, envelope, authentication issuance, server/event scope, acknowledgment, limits, and rejection semantics with the coworker. This is an integration dependency, not authorization to send messages or implement their server.
2. Verify current LCU discovery, event timing, platform metadata, and retention on Windows; document evidence and any necessary revisions before relying on event-only capture.
3. Pin runtime/package versions and prove clean-machine packaging before declaring the client standalone.
4. Integrate with the real receiver and demonstrate durable acknowledgment plus duplicate replay handling. Mock success alone is insufficient for release.

## References

- [League Observer Tool](https://github.com/RCVolus/league-observer-tool): workflow inspiration for configurable local API forwarding; its Electron implementation is not the selected desktop stack.
- [Avalonia on Windows](https://docs.avaloniaui.net/docs/platform-specific-guides/windows): Win32 platform integration and Skia rendering.
- [Avalonia TrayIcon](https://docs.avaloniaui.net/controls/navigation/trayicon/): Windows tray and native menu integration.
- [.NET single-file deployment](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview): self-contained publishing and native-library extraction.
- [Local LCU type notes](../../hasagi-lcu-api/types.md) and [EOG fixture](../../lcu-tft-eog-stats-example.json): repository evidence for the capture boundary.
