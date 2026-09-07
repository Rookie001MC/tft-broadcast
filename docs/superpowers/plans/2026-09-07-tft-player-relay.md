# TFT Player Relay Implementation Plan

Date: 2026-09-07

Status: Proposed; the `players-lcu-client/` Avalonia skeleton exists, but relay feature implementation has not started.

Specification: [TFT Player Relay Design](../specs/2026-09-07-tft-player-relay-design.md).

## Objective and boundaries

Deliver a Windows 10/11 x64 Avalonia executable that automatically captures local TFT EOG observations and reliably sends them to a configured LAN/VLAN server. Defaults are Host `127.0.0.1`, Port `5173`, with a configurable auth token. Extend the existing `players-lcu-client/` project; do not create a separate client under `apps/player-relay/`.

The coworker owns production receiver implementation, data interpretation, and web integration. This plan produces the desktop client, a reviewable contract, and a development mock receiver. It does not implement graphics scenes or change the existing Winner workflow.

Work in the sequence below. Each task has evidence required before checking it off; Windows-only evidence cannot be replaced with Linux or mock execution. Run tasks locally unless delegation is separately requested.

## Task 1: Freeze the proposed receiver contract

Files: `players-lcu-client/contracts/v1/README.md`, `capture.schema.json`, `handshake.schema.json`, `acknowledgment.schema.json`, and `examples/`.

- [ ] Translate the specification's handshake, capture envelope, acknowledgments, and safe error responses into schemas and examples.
- [ ] Specify exact string/number/null types, required fields, UTF-8 hash calculation, encoded/decoded size limits, and timestamp meanings.
- [ ] Include stored, duplicate, ID/content conflict, expired token, oversized payload, invalid envelope, and retryable responses.
- [ ] Document device-token provisioning/revocation and event/server identity as receiver responsibilities. Keep these separate from web operator login roles.
- [ ] Include a receiver checklist for transaction-before-acknowledgment, duplicate replay, cross-PC observations, and safe treatment of stale/unknown-context captures.
- [ ] Record coworker agreement or concrete differences when supplied; do not label an unreviewed proposal final.

Validation: schema-check all examples and exercise matching/mismatched IDs and hash vectors. Contract freeze gates real integration; local scaffolding and capture exploration can proceed independently.

## Task 2: Extend the existing client skeleton and prove deployment early

Files: `players-lcu-client/players-lcu-client.csproj`, its existing `App.axaml`, `Program.cs`, `Views/`, and `ViewModels/`; later `players-lcu-client.sln`, local `global.json`, `README.md`, and root ignore/tooling exclusions where required.

- [ ] Retain the existing `net10.0`, Avalonia `11.3.11`, nullable-reference, and compiled-binding setup. Retain the pinned `Thresh.Extensions` `1.0.0` LCU dependency; add compatible SQLite, test, and Windows-interop packages only after checking support for venue OS builds.
- [ ] Add `Core/`, `Infrastructure/`, `contracts/`, and application-composition boundaries within the current project. Add adjacent test and mock-receiver projects only when needed, with one-way dependency rules equivalent to the specification.
- [ ] Keep compiled UI bindings, add package lock files, and document deterministic restore/build instructions.
- [ ] Ignore scoped `bin/`, `obj/`, publish, test-output, and local runtime files. Keep root pnpm tooling from traversing generated desktop artifacts.
- [ ] Build a minimal window and tray; prove a self-contained executable launches on a clean Windows machine without installed runtime or administrator rights.
- [ ] Record application-data/native-extraction paths and dependency packaging behavior. Keep Native AOT optional until baseline deployment works.

Validation: `dotnet restore`, release build, basic UI launch, tray recovery, exit, and clean-machine publish smoke. Record exact Windows build and package versions. Do not require changes to the Node runtime for desktop development.

## Task 3: Characterize real LCU behavior

Files: `players-lcu-client/Infrastructure/Lcu/`, `players-lcu-client/tests/Fixtures/`, `players-lcu-client/docs/lcu-verification.md`.

- [ ] Implement an exploratory read-only `ILcuGateway` adapter using the pinned `Thresh.Extensions` `1.0.0` library. Verify its discovery behavior with process metadata/lockfile evidence and non-default install paths.
- [ ] Use the gateway's local HTTP/WebSocket handling; prove loopback binding, changing credentials, certificate handling, and normal-user permissions.
- [ ] Observe the installed types' EOG endpoint and event on actual TFT sessions; record timing after elimination and final finish, revisions, null/deletion events, startup recovery, and client restart.
- [ ] Verify account/platform identity sources and detect identity changes across reads. Never infer platform from UI locale.
- [ ] Create sanitized fixtures for the observed sequences; derive automated fixtures from the existing repository sample without shipping real participant identity in app assets.
- [ ] Record inaccessible-client and multiple-client behavior, polling fallback cadence, and limits supported by observed payload sizes.

Validation: capture one real result and document its lifecycle. If no suitable Windows/League environment is available, leave this gate open and continue only the independent mock-backed tasks.

## Task 4: Implement capture and connection lifecycle

Files: `players-lcu-client/Core/Capture/`, `players-lcu-client/Core/Models/`, `players-lcu-client/Infrastructure/Lcu/`; tests for lifecycle and payload handling.

- [ ] Define typed capture metadata with an opaque original JSON string; preserve unknown fields and large identifiers without lossy number conversion.
- [ ] Implement connection generations, cancellation, account switch handling, startup/reconnect reads, and event-triggered retrieval.
- [ ] Use one read in flight plus a rescan flag; enforce streamed response limits and bounded fallback polling from Task 3 evidence.
- [ ] Classify event/recovery observations and reject mismatched local identity. Do not invent game-end timestamps or require an eight-player schema.
- [ ] Define hash and deduplication inputs exactly as in the spec; changed observations retain independent capture IDs and sequence values.
- [ ] Ensure pause/resume and deleted/null resources never mutate existing queued data.

Validation: deterministic tests for duplicate notifications, changes during an in-flight read, account-switch races, old connection callbacks, malformed/oversized JSON, unknown fields, duplicate/helper units, and recovery data. Confirm every canceled generation releases its resources.

## Task 5: Add durable settings, credentials, and queue

Files: `players-lcu-client/Infrastructure/Storage/`, `players-lcu-client/Infrastructure/Configuration/`, `players-lcu-client/Infrastructure/Security/`; on-disk integration tests.

- [ ] Create versioned SQLite schema for installation metadata, destination profiles, captures, delivery state, attempts, acknowledgment metadata, and deduplication retention.
- [ ] Insert identity/sequence/hash/payload/destination in one transaction before waking the uploader; recover interrupted sending records after restart.
- [ ] Persist non-secret settings atomically and protect tokens with Windows user-bound storage. Fail visibly if protection/storage is unavailable.
- [ ] Bind pending records to their original destination profile; distinguish same-profile token rotation from changed server/event scope using handshake identity.
- [ ] Enforce count and byte limits including rejected captures; implement acknowledged-payload cleanup and bounded metadata retention.
- [ ] Add explicit export/removal of rejected or blocked records; do not automatically drop pending records. Report disk-full and corruption without deleting the database.
- [ ] Test schema upgrades with pending records and rejection of unsupported future schema versions.

Validation: real temporary SQLite files, process-restart simulation, transaction failures, duplicate insert races, queue capacity, disk/write failure injection, protected-token errors, and destination changes. Use kill/relaunch tests on Windows for persistence beyond in-memory unit coverage.

## Task 6: Implement delivery and the fault-injectable receiver

Files: `players-lcu-client/Core/Delivery/`, `players-lcu-client/Infrastructure/Transport/`, `players-lcu-client/tools/mock-receiver/`, transport tests.

- [ ] Build a loopback-only mock receiver with deterministic handshake, durable test receipt storage, and configurable failure modes.
- [ ] Implement authenticated handshake and immutable-envelope POST using the frozen contract, normal server TLS validation, and redirects disabled.
- [ ] Implement a single uploader with response/body bounds, timeout, backoff/jitter, and bounded Retry-After handling.
- [ ] Parse acknowledgments strictly; update local state only on a matching stored/duplicate receipt. Preserve immutable envelope and capture ID through all retries.
- [ ] Separate endpoint/authentication failures from record rejection and temporary outage. Allow later records past an individually rejected observation.
- [ ] Implement safe settings changes, token refresh, manual retry, and cancellation without concurrent duplicate workers.

Validation: server commits then drops connection, retries after app restart, duplicate receipts, conflicting IDs, HTML on port 5173, oversized/malformed responses, mismatched IDs, 202, redirects, 401/403, 404, 408, 409, 413, 422, 429, 5xx, and timeout. Assert the mock stores one receipt for a replayed capture and that no secrets enter logs.

Milestone: capture through the local adapter, persist, deliver to the mock, restart, and show acknowledgment. This is not yet proof of production receiver integration.

## Task 7: Build the operator-facing Avalonia UI

Files: `players-lcu-client/Views/`, `players-lcu-client/ViewModels/`, `players-lcu-client/App.axaml`, `players-lcu-client/Program.cs`, and UI tests.

- [ ] Build compact settings with Host `127.0.0.1`, Port `5173`, scheme, masked token, Save, and Test connection; explain localhost inline.
- [ ] Display independent League, capture, and server status; detected player; queue counts; and last capture/acknowledgment metadata.
- [ ] Add bounded history and actionable failure messages without rendering raw payloads or secrets by default.
- [ ] Wire Pause/Resume, Retry, diagnostic export, and explicit blocked-record recovery controls to typed application commands.
- [ ] Implement hide-to-tray with first-use explanation, tray-failure fallback, Show/Exit, graceful cancellation, and single-instance activation.
- [ ] Keep UI updates on the UI dispatcher and all I/O asynchronous; clean up subscriptions on window/view lifecycle changes.

Validation: view-model tests and Avalonia UI tests for settings errors, pending/offline/auth/rejected states, accurate acknowledgment labels, pause/resume, history bounds, keyboard navigation, and contrast. Manually verify tray, second launch, scaling, and focus on Windows.

## Task 8: Add diagnostics and prove resource bounds

Files: `players-lcu-client/Infrastructure/Diagnostics/`, stress tests, `players-lcu-client/docs/performance-verification.md`.

- [ ] Add structured rotating logs with safe capture IDs and error codes; exclude tokens, LCU credentials, raw payloads, and participant details.
- [ ] Export bounded diagnostics containing version, safe status, counters, and redacted logs; keep any explicit result export separate.
- [ ] Measure idle and capture CPU, private bytes, working set, handles, threads, queue growth, WAL size, and upload traffic.
- [ ] Exercise 100 reconnects, repeated view opening, maximum queue/history, and an eight-hour soak on recorded hardware.
- [ ] Investigate misses against proposed budgets: average idle CPU below 1%, steady-state private bytes below 150 MiB, and no sustained post-warmup resource growth.

Validation: measured report with baseline, peak, end values, and leak investigation evidence. A bounded queue alone does not establish leak freedom.

## Task 9: Integrate with the coworker's receiver

Files: `players-lcu-client/contracts/` examples, integration tests, `players-lcu-client/docs/receiver-integration.md`; no production web implementation in this task.

- [ ] Obtain a configured receiver/test token and verify handshake server/event scope.
- [ ] Run the frozen request/response fixtures against the real receiver and resolve deviations in the versioned contract.
- [ ] Demonstrate durable receipt, replay after lost acknowledgment, source-platform ambiguity, stale recovery observations, and changed revisions of the same game.
- [ ] Exercise two Player PCs reporting overlapping data; confirm receiver-owned reconciliation does not erase observations or auto-publish graphics.
- [ ] Verify LAN/VLAN routing, actual Node listening address/port, and the receiver's request-body limit for the encoded envelope.

Validation: recorded client/server receipt IDs and retry evidence using authorized test data. If the receiver is unavailable, keep integration/release incomplete while retaining a working mock-tested executable.

## Task 10: Package, rehearse, and document release

Files: `players-lcu-client/scripts/publish.ps1`, `players-lcu-client/scripts/verify.ps1`, `players-lcu-client/README.md`, publish profile, Windows CI configuration when available, and release checklist.

- [ ] Automate locked restore, release build, unit/integration/UI checks, and self-contained `win-x64` single-file publishing.
- [ ] Include native libraries/resources correctly, produce a versioned executable and checksum, and record third-party notices.
- [ ] Verify fresh Windows 10/11 venue builds without .NET/Node/SDK installed, including Unicode user paths and a non-writable executable directory.
- [ ] Rehearse before/after League launch, early elimination, account switch, cable/network interruption, server restart, disk failure, tray recovery, and reboot/manual relaunch.
- [ ] Document launch, host/port/token setup, localhost versus server address, status meanings, HTTP/HTTPS behavior, diagnostics, manual updates, and queue recovery.
- [ ] Validate executable distribution/signing requirements on actual venue PCs; do not instruct users to bypass protections.
- [ ] Record final evidence and mark only completed deliverables in `docs/TODO.md`.

Expected verification commands after the client-specific solution and test projects are added:

```powershell
Set-Location players-lcu-client
dotnet restore players-lcu-client.sln --locked-mode
dotnet build players-lcu-client.sln -c Release --no-restore
dotnet test players-lcu-client.sln -c Release --no-build
dotnet publish players-lcu-client.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

Publish profiles/scripts must resolve any dependency-specific requirements found in the clean-machine spike; the command alone is not a release guarantee. Keep existing web tests as a regression gate if shared root tooling changes, without treating pre-existing web diagnostics as desktop regressions.

## Completion gate

- [ ] Reviewed contract and real-receiver interoperability evidence exist.
- [ ] Real Windows LCU capture and recovery behavior are documented.
- [ ] One self-contained executable runs with the agreed settings and native desktop UI.
- [ ] Captures survive outage/restart and matching durable acknowledgments drive delivery status.
- [ ] Destination/account changes do not rewrite or misroute pending observations.
- [ ] Resource bounds and lifecycle cleanup pass measured stress/soak checks.
- [ ] Windows venue rehearsal passes and support instructions are complete.

No implementation or verification checkbox is complete merely because these planning documents exist.
