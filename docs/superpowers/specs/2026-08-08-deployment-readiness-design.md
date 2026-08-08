# Deployment Readiness Design

## Status

Approved design for the fourth release-remediation workstream. It is the final release gate and validates the behavior delivered by the preceding workstreams.

## Goals

- Remove scaffold/demo artifacts from the production application and test suite.
- Give Better Auth an authoritative client address without trusting arbitrary forwarded headers.
- Keep proxy trust explicit and deployment-controlled through environment variables.
- Exercise the standalone adapter-node output under the production environment contract.
- Preserve the existing fast Vite-based feedback loop.

## Non-Goals

- No hosting-provider selection or deployment execution.
- No public-internet exposure of the application.
- No broad logging, retention, or external observability policy.
- No multi-instance catalog-sync coordination.
- No replacement of the existing adapter-node target.
- No repeat of the already completed internal VLAN/firewall rehearsal unless the topology changes.

## Scaffold Removal

Remove:

- `/demo`
- `/demo/playwright`
- the template Playwright test associated with those routes
- `src/lib/vitest-examples`

Before removing the Vitest examples, confirm the real admin component tests execute the browser Vitest project. Remove any configuration references that exist only for the scaffold. Navigation and route smoke coverage must continue to verify every production sidebar destination.

## Client-IP Trust Boundary

Forwarded client-IP headers are untrusted by default.

### Direct adapter-node deployment

When no address-header environment variable is configured, adapter-node derives the address from the connected socket through `event.getClientAddress()`. The application does not read `X-Forwarded-For`, `X-Real-IP`, or provider-specific headers directly.

### Reverse-proxy deployment

The deployment may set adapter-node's documented `ADDRESS_HEADER`. If that header is `X-Forwarded-For`, it must also set an exact `XFF_DEPTH` matching the controlled proxy chain.

The runbook requires:

- the proxy overwrites or sanitizes the configured address header
- clients cannot connect directly to the Node origin
- the configured depth represents the actual number of trusted hops
- broad private-network ranges are not treated as proof that a sender is the proxy

### Better Auth integration

The SvelteKit server hook calls `event.getClientAddress()` and overwrites a private application-only header value for the Better Auth request path. Better Auth is configured to read only that sanitized header for IP tracking and rate limiting. A client-supplied value using the same header name is discarded before authentication runs.

If client-address resolution fails because deployment configuration is incomplete, authentication emits a safe diagnostic and fails closed for address-dependent handling rather than trusting a fallback forwarded value. Tests ensure distinct resolved clients no longer share the unidentified-client rate-limit bucket.

Configuration remains in runtime environment variables and `.env.example`. No JSON configuration file is introduced.

## Production Environment Contract

The standalone server contract includes at least:

- `DATABASE_URL`
- `MEDIA_ROOT`
- `ORIGIN`
- `BETTER_AUTH_SECRET`
- `BODY_SIZE_LIMIT=30M`
- catalog archive limits
- optional adapter-node `HOST` and `PORT`
- optional `ADDRESS_HEADER` and `XFF_DEPTH` for a controlled reverse proxy

`ORIGIN` remains explicit. Trusted proxy host/protocol headers are not enabled as a substitute for the configured origin.

## Standalone Release Smoke Path

Add a dedicated command that:

1. builds the application with adapter-node
2. creates an isolated database and media directory under a test-owned temporary root
3. applies migrations and deterministic catalog seed data
4. selects a free local port and starts `node build` with the production environment contract
5. waits for a health/readiness response
6. runs the release Playwright project against that server
7. terminates the child process and removes test-owned data in success and failure paths

The release Playwright path covers:

- first-operator setup or deterministic authenticated login
- one player, tournament, or catalog correction action
- a valid player bundle larger than 512 KiB
- a bundle over the 25 MiB application limit being rejected while the adapter accepts the request body under `BODY_SIZE_LIMIT=30M`
- loading and saving the singleton board
- enabling Live and observing `/gfx`
- saving a correction while Live and observing a new publication version without refreshing `/gfx`
- hiding or resetting and observing a transparent canvas
- distinct ETag/version behavior for unchanged and changed state

The existing Vite-backed E2E command remains the fast UI workflow. The standalone command is the release gate and must not be silently replaced with Vite preview.

## Error Handling and Cleanup

- Server-start timeout prints captured process output without secrets.
- Child-process termination runs from a `finally` path.
- Cleanup targets are resolved and verified inside the test-owned temporary root before removal.
- Test data never uses the operator's normal database or media directory.
- A failed release test leaves production build output intact for diagnosis but removes transient database/media state.
- Request bodies, credentials, uploaded contents, and auth secrets are not printed.

## Documentation and Audit State

Update the deployment runbook with direct and reverse-proxy examples, `BODY_SIZE_LIMIT`, address-header rules, and the standalone release command.

Record the user's completed internal VLAN/firewall rehearsal as complete. Keep the standalone adapter-node smoke gate open until the new command passes after all remediation workstreams.

## Verification

Focused hook/auth tests cover:

- direct socket-derived address propagation
- client-supplied internal header overwrite
- explicit proxy-derived address propagation
- invalid or missing proxy-depth configuration
- two clients receiving independent Better Auth rate-limit identities

Cleanup tests cover the absence of demo routes and template examples while retaining real browser-project coverage.

Final commands include:

- all Vitest projects
- Svelte check
- lint and formatting checks
- existing Vite E2E
- standalone adapter-node release smoke

The workstream and overall remediation program complete only when every command passes with the documented production environment contract.
