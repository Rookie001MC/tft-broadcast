# LAN relay password rotation design

## Goal

Replace the environment-configured relay token with a shared relay password that Player LCU clients can type or generate. The relay must reject unauthenticated requests, require no environment variable, and allow an operator to rotate the shared password from a client.

## Scope

The relay server and Player LCU clients run on separate machines on a private event LAN. The LAN is trusted enough to permit the first client to initialize an unconfigured relay, but the capture and handshake routes remain password protected after initialization.

This is not account management, per-player credentials, remote administration, or internet-facing security.

## Credential lifecycle

1. A new relay has no credential file.
2. An operator enters a password or clicks Generate in a Player LCU client. Generate creates a cryptographically random, copyable shared password.
3. Saving the first password calls a bootstrap endpoint. It succeeds only while the relay is unconfigured and atomically persists a random salt and a memory-hard password verifier under the relay data directory. Plaintext passwords never reach persistent server storage.
4. Every handshake and capture uses the password in the existing Bearer header. The receiver compares a derived verifier in constant time and returns only generic authentication failures.
5. The desktop client stores the active password in its existing Windows DPAPI-backed secret store.
6. Other player clients receive the shared password through the event operator workflow and save it locally.

## Password rotation

If the desktop client already has a saved password, clicking Generate opens a modal confirmation dialog with this warning: rotating the password will stop all other clients from delivering data until they are updated.

On confirmation, the client generates a new password and sends it to an authenticated rotation endpoint. The server atomically replaces its stored verifier. The client writes the new password to DPAPI only after the server confirms the rotation, then reveals it long enough for the operator to copy to the remaining Player LCU clients.

There is no persistent server-to-client control channel. Rotation therefore does not push a literal disconnect message. Other clients are invalidated on their next handshake, connection test, or capture upload and receive a generic HTTP 401 response. The desktop UI surfaces this as an authentication failure without revealing why the server rejected it.

## Relay endpoints and persistence

- `POST /api/player-relay/v1/auth/bootstrap`: accepts a candidate password only when no credential has been initialized; otherwise returns a safe conflict response.
- `POST /api/player-relay/v1/auth/rotate`: requires the current Bearer password and accepts a new password; atomically replaces the verifier.
- `GET /api/player-relay/v1/handshake` and `POST /api/player-relay/v1/captures`: require the current Bearer password after bootstrap.
- The verifier document belongs below `MEDIA_ROOT/player-relay/`; removing it directly on the relay host is the deliberate event-reset procedure.

The server uses Node's `crypto.scrypt` with a fresh salt and a timing-safe comparison. It never logs, returns, or stores the plaintext password. The player-relay routes no longer read `EOG_INGEST_TOKEN`; the variable remains available to the unrelated legacy post-game collector.

## Desktop UI

The current device-token field becomes **Relay password**. It remains a masked textbox, with Generate and Show/Copy controls. The status banner and connection badge continue to show configuration, bootstrap, rotation, and generic authentication states.

Generate when there is no saved password fills a new password for the operator to save/bootstrap. Generate when a password is already saved opens the rotation confirmation dialog. Cancelling does not change the visible or stored password. A failed bootstrap or rotation leaves the saved password untouched.

## Failure handling

- Bootstrap races are resolved by the server accepting exactly one first password; later attempts receive a conflict and must use the password established by the winning client.
- A wrong or absent password is rejected with a generic authentication response.
- A network failure while rotating preserves the old locally saved password and assumes the server state is unchanged unless a success response was received.
- If a request could have succeeded but its response was lost, the client must test the old password before overwriting its local value; the operator may use the direct server-side reset procedure if recovery is impossible.
- Password authentication protects the relay application, not a public or hostile network. The Vite relay must remain bound/firewalled to the event LAN.

## Verification

Add focused tests or validation for bootstrap single-winner behavior, authentication rejection, successful rotation, stale-password rejection after rotation, and no plaintext password in the stored verifier document. Build the Player LCU desktop project and validate the relay JSON contracts.
