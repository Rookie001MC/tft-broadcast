# LAN Relay Password Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace environment-configured relay authentication with a client-managed shared password that can bootstrap and rotate the LAN relay securely enough for the event workflow.

**Architecture:** The Vite relay persists a salt and `crypto.scrypt`-derived verifier under `MEDIA_ROOT/player-relay/`, while Player LCU clients retain the plaintext password in the existing Windows DPAPI store. A first LAN client can bootstrap an unconfigured receiver; later clients authenticate with Bearer credentials. Rotation atomically replaces the verifier, so stale clients receive a generic 401 on their next request.

**Tech Stack:** SvelteKit server routes, Node.js `crypto` and filesystem APIs, Avalonia 11, C# .NET 10, CommunityToolkit.Mvvm, Windows DPAPI.

## Global Constraints

- Player LCU client and Vite relay run on separate private event-LAN machines.
- Do not use `EOG_INGEST_TOKEN` or any environment variable for player-relay authentication; retain it for the unrelated legacy post-game collector.
- The existing DPAPI-backed credential store remains the local at-rest protection.
- Server storage must contain only salt, verifier, format/version metadata, and no plaintext password.
- Handshake and capture failures must use generic authentication responses and must not disclose rotation state.
- Automated tests are explicitly waived by the operator due to time constraints; run the desktop build, contract validation, and focused manual request checks instead.
- Produce one implementation commit after all tasks, not a commit per subtask.

---

## File structure

- `src/lib/server/player-relay/password-store.js` — Owns verifier document validation, atomic bootstrap, authenticated rotation, and constant-time password verification.
- `src/lib/server/player-relay/receiver.js` — Uses the password store to protect handshake and capture endpoints; no longer reads an environment credential.
- `src/routes/api/player-relay/v1/auth/bootstrap/+server.js` — Accepts first-time password initialization only.
- `src/routes/api/player-relay/v1/auth/rotate/+server.js` — Authenticates the current password and atomically rotates to a new one.
- `.env.example` — Retains the legacy collector variable without using it in player-relay authentication.
- `players-lcu-client/Core/Security/DeviceToken.cs` — Renames operator-facing terminology to relay password or adds a password-compatible façade without weakening validation or DPAPI use.
- `players-lcu-client/Infrastructure/Transport/RelayReceiverHttpClient.cs` — Adds bootstrap/rotate client operations and maps generic authentication outcomes safely.
- `players-lcu-client/ViewModels/MainWindowViewModel.cs` — Generates high-entropy passwords, coordinates bootstrap/rotate with the protected store, and surfaces generic failure states.
- `players-lcu-client/Views/MainWindow.axaml` — Renames the field, adds Generate/Show/Copy controls, and starts password-rotation confirmation.
- `players-lcu-client/Views/PasswordRotationDialog.axaml` and `.axaml.cs` — Modal warning dialog that requires an explicit confirmation before an existing password is replaced.
- `players-lcu-client/Composition/ServiceCollectionExtensions.cs` — Registers the dialog service only if a service abstraction is used.

### Task 1: Persisted relay password verifier and protected routes

**Files:**
- Create: `src/lib/server/player-relay/password-store.js`
- Modify: `src/lib/server/player-relay/receiver.js`
- Create: `src/routes/api/player-relay/v1/auth/bootstrap/+server.js`
- Create: `src/routes/api/player-relay/v1/auth/rotate/+server.js`
- Modify: `.env.example`

**Interfaces:**
- Produces `createRelayPasswordStore(mediaRoot)` with `bootstrap(password)`, `rotate(currentPassword, nextPassword)`, and `verify(password)` methods.
- `bootstrap` returns `{ status: 'initialized' | 'already_initialized' | 'invalid' }`.
- `rotate` returns `{ status: 'rotated' | 'authentication_failed' | 'invalid' }`.
- `verify` returns `boolean` and is the single authentication gate used by `requireRelayAuthentication(request)`.

- [ ] **Step 1: Implement a versioned verifier document and safe password derivation.**

```js
const PASSWORD_FORMAT = 1;
const SCRYPT_KEY_LENGTH = 32;

export function createRelayPasswordStore(mediaRoot) {
  const credentialPath = path.join(mediaRoot, 'player-relay', 'relay-password.json');
  return {
    bootstrap: (password) => bootstrapPassword(credentialPath, password),
    rotate: (currentPassword, nextPassword) => rotatePassword(credentialPath, currentPassword, nextPassword),
    verify: (password) => verifyPassword(credentialPath, password)
  };
}
```

Validate a non-empty UTF-8 password with a bounded byte length. Derive `scrypt` output with a fresh 16-byte random salt. Persist only `{ format: 1, salt: base64, verifier: base64 }` through a temporary file and atomic link/rename strategy. Reject malformed verifier files rather than overwriting them.

- [ ] **Step 2: Implement first-client bootstrap and authenticated rotation.**

```js
const bootstrap = await passwordStore.bootstrap(candidatePassword);
if (bootstrap.status === 'initialized') return json({ status: 'initialized' }, { status: 201 });
if (bootstrap.status === 'already_initialized') return json({ error: 'already_initialized' }, { status: 409 });
return json({ error: 'invalid_password' }, { status: 400 });
```

Allow only one bootstrap winner under concurrent requests. Rotation must verify the current password before atomically replacing the document; return 401 for invalid current credentials and 400 for invalid next passwords. Never include a password, hash, salt, or rotation reason in a response or log.

- [ ] **Step 3: Gate handshake and capture requests.**

```js
export async function requireRelayAuthentication(request) {
  const value = request.headers.get('authorization');
  const password = value?.startsWith('Bearer ') ? value.slice(7) : null;
  return password && await passwordStore.verify(password);
}
```

Return a generic 401 before processing the handshake or capture body when password verification fails. Remove `EOG_INGEST_TOKEN` reads from player-relay code only; retain the example variable because the unrelated legacy post-game collector still uses it.

- [ ] **Step 4: Run manual server checks.**

Run the Vite relay locally and use `curl` or PowerShell requests to verify: an uninitialized relay permits exactly one bootstrap; a missing/wrong password gets 401; a correct password gets a valid handshake; rotation invalidates the old password; and `relay-password.json` contains no submitted plaintext. Automated tests remain skipped under the operator waiver.

### Task 2: Password bootstrap and rotation transport from Player LCU

**Files:**
- Modify: `players-lcu-client/Infrastructure/Transport/RelayReceiverHttpClient.cs`
- Modify: `players-lcu-client/ViewModels/MainWindowViewModel.cs`
- Modify: `players-lcu-client/Core/Security/DeviceToken.cs`

**Interfaces:**
- Produces `Task<RelayPasswordConfigurationResult> BootstrapPasswordAsync(RelayDestination, DeviceToken, CancellationToken)`.
- Produces `Task<RelayPasswordRotationResult> RotatePasswordAsync(RelayDestination, DeviceToken currentPassword, DeviceToken nextPassword, CancellationToken)`.
- `RelayPasswordConfigurationResult` distinguishes `Initialized`, `AlreadyInitialized`, `AuthenticationFailed`, `InvalidPassword`, and safe transport failure detail.
- `RelayPasswordRotationResult` distinguishes `Rotated`, `AuthenticationFailed`, `InvalidPassword`, and safe transport failure detail.

- [ ] **Step 1: Add the two bounded HTTP operations.**

```csharp
Task<RelayPasswordConfigurationResult> BootstrapPasswordAsync(
    RelayDestination destination, DeviceToken password, CancellationToken cancellationToken);

Task<RelayPasswordRotationResult> RotatePasswordAsync(
    RelayDestination destination, DeviceToken currentPassword, DeviceToken nextPassword, CancellationToken cancellationToken);
```

Send the candidate password only in a JSON request body to bootstrap. Send the current password through the existing Bearer header and the next password in the rotation JSON body. Reuse the existing timeout, redirect rejection, response-size bounds, and safe error mapping. Zero temporary UTF-8 byte buffers after use.

- [ ] **Step 2: Generate an operator-copyable password securely.**

```csharp
private static string GenerateRelayPassword()
{
    var bytes = RandomNumberGenerator.GetBytes(24);
    try { return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }
    finally { CryptographicOperations.ZeroMemory(bytes); }
}
```

Keep `DeviceToken` as an internal compatibility type if that minimizes churn, but change all UI and operator-facing messages to “relay password.” Preserve its UTF-8 validation and DPAPI storage boundary.

- [ ] **Step 3: Coordinate save, bootstrap, and rotation without losing the active password.**

On first save, validate the current field and call bootstrap before writing it to DPAPI. On rotation, retain the loaded DPAPI password until the server returns `Rotated`; only then save the new generated password. A bootstrap conflict must leave the client password unsaved and tell the operator to enter the shared password already established on the relay. A generic 401 must say only that the relay password was rejected.

- [ ] **Step 4: Build the desktop project.**

Run:

```powershell
$env:AVALONIA_TELEMETRY_OPTOUT='1'; dotnet build players-lcu-client\players-lcu-client.csproj --no-restore
```

Expected: exit code 0 with zero compiler errors. Automated tests are intentionally not run.

### Task 3: Password controls and rotation confirmation UI

**Files:**
- Modify: `players-lcu-client/Views/MainWindow.axaml`
- Modify: `players-lcu-client/ViewModels/MainWindowViewModel.cs`
- Create: `players-lcu-client/Views/PasswordRotationDialog.axaml`
- Create: `players-lcu-client/Views/PasswordRotationDialog.axaml.cs`
- Modify: `players-lcu-client/Composition/ServiceCollectionExtensions.cs` only if a dialog service is introduced.

**Interfaces:**
- Produces `GenerateRelayPasswordCommand`, `ShowRelayPasswordCommand`, `CopyRelayPasswordCommand`, and `SaveSettingsCommand` behavior with explicit rotation confirmation.
- Produces `Task<bool> PasswordRotationDialog.ShowDialog<bool>(Window owner)` where `true` means the operator accepted the warning.

- [ ] **Step 1: Replace token labels with relay-password controls.**

Render a masked **Relay password** input, `Generate`, `Show/Hide`, and `Copy` buttons. Disable Copy until a password is present in the field. After a successful generate or rotation, show the generated value temporarily in the field so it can be copied to other player clients; the protected store remains the authoritative local persistence.

- [ ] **Step 2: Add an explicit modal confirmation for existing credentials.**

```xml
<TextBlock Text="This will change the relay password and stop every other client from delivering data until it is updated." TextWrapping="Wrap" />
<Button Content="Cancel" IsCancel="True" />
<Button Content="Rotate password" IsDefault="True" />
```

Clicking Generate with no saved password only fills a candidate. Clicking Generate with a saved password must open this dialog. Cancellation must preserve the existing local password and field. Confirmation calls rotation and reports only its safe outcome in the existing alert banner and color badge.

- [ ] **Step 3: Preserve operational connection feedback.**

Continue to show the existing connection badge and alert banner. Use a clear private-LAN warning near the password controls. On a stale client’s next test or upload, the generic 401 maps to “Relay password rejected; enter the current shared password,” not “disconnected” or “password rotated.”

- [ ] **Step 4: Validate and commit one focused change.**

Run:

```powershell
$env:AVALONIA_TELEMETRY_OPTOUT='1'; dotnet build players-lcu-client\players-lcu-client.csproj --no-restore
node players-lcu-client\contracts\v1\validate-examples.mjs
git diff --check
```

Expected: all commands exit 0. Do not run automated tests under the operator’s test waiver. Commit the implementation and this plan together:

```powershell
git add .env.example src/lib/server/player-relay src/routes/api/player-relay players-lcu-client docs/superpowers/plans/2026-09-08-lan-relay-password-rotation.md
git commit -m "feat: add LAN relay password rotation"
```

## Plan self-review

- Spec coverage: Tasks 1–3 cover verifier persistence, one-time bootstrap, constant-time authentication, server-side rotation, no push-disconnect claim, DPAPI retention, password generation, confirmation, UI status, reset documentation, and required validation.
- Placeholder scan: no TBD/TODO markers; every code task names target paths, interfaces, commands, and expected behavior.
- Type consistency: Task 1 produces the HTTP endpoint behavior that Task 2 consumes; Task 2 produces commands/results that Task 3 renders.
