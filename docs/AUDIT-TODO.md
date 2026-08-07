# TFT Broadcast Audit TODO

Created from the 2026-08-08 merge-readiness audit of `feat/manual-winner-graphics`.

## Release blockers

- [x] Configure production request-body limits for player bundles.
  - Add `BODY_SIZE_LIMIT=30M` (or another value safely above the 25 MiB application limit) to the deployment environment and `.env.example`.
  - Document the setting in the trusted LAN/VLAN runbook.
  - Exercise the standalone `node build` server with a valid bundle larger than 512 KiB.
  - Confirm bundles over the application's 25 MiB limit are still rejected.
  - Reference: <https://svelte.dev/docs/kit/adapter-node#Environment-variables-BODY_SIZE_LIMIT>

- [ ] Make published graphics immutable and consistently versioned.
  - Snapshot the winner's display name, Riot ID, and managed image reference when publishing, or define an equivalent versioned-data design.
  - Ensure player imports cannot silently change an already-published board.
  - Ensure newly opened and already-open `/gfx` clients always render the same published version.
  - Add image cache busting or validation so an updated player image cannot remain stale under the stable player media URL.
  - Add regression coverage for updating a player while their board is live.

- [ ] Enforce ZIP expansion limits using actual streamed bytes.
  - Do not rely only on `entry.uncompressedSize` from ZIP metadata.
  - Count decompressed bytes while reading each entry and abort when per-entry or total limits are exceeded.
  - Keep the existing compressed-size, entry-count, path, symlink, encryption, and nested-archive checks.
  - Add a test whose declared size is smaller than its actual decompressed content.

## Before production rehearsal

- [x] Resolve incomplete admin navigation.
  - Remove or disable links to `/admin/players`, `/admin/tournaments`, `/admin/game-resources`, `/admin/graphics`, and `/admin/settings` until those routes exist, or implement the routes.
  - Add a navigation smoke test so every visible sidebar destination returns a real page.

- [ ] Apply the 12-character password rule inside Better Auth.
  - Set `emailAndPassword.minPasswordLength` to `12` so direct `/sign-up/email` requests cannot bypass the `/setup` validation.
  - Add coverage for direct first-user sign-up with an 8–11 character password.
  - Reference: <https://better-auth.com/docs/reference/options>

- [ ] Stop presenting committed import previews as commit-ready.
  - Use the stored preview status when rendering the import panel.
  - Hide or disable confirmation after a preview is committed.
  - Add component or E2E coverage for the post-commit state.

- [ ] Define and enforce winner-board capacity limits.
  - Decide the maximum supported champion and augment counts for the fixed 1920×1080 layout.
  - Enforce the limits in the server repository, not only in the UI.
  - Disable additional selections in the composer and explain the limit to the operator.
  - Add boundary tests and visually verify the maximum-size board.

## Deployment hardening and cleanup

- [ ] Configure Better Auth client-IP handling for the final network topology.
  - For direct deployment, verify how client addresses reach Better Auth.
  - Behind a reverse proxy, configure a sanitized trusted IP header or `trustedProxies`; do not trust spoofable forwarded headers from arbitrary clients.
  - Confirm login rate limiting no longer falls back to one shared unidentified-client bucket.
  - Reference: <https://better-auth.com/docs/concepts/rate-limit>

- [ ] Add an E2E smoke path that runs the standalone adapter-node output.
  - Start the built application with `node --env-file=.env build` or an isolated equivalent.
  - Cover login, one form action, a representative ZIP upload, and `/gfx` polling against that server.
  - Keep Vite preview tests for fast UI feedback, but do not use them as the only deployment verification.

- [ ] Remove scaffold/demo artifacts from the production build.
  - Remove `/demo`, `/demo/playwright`, and their template E2E test unless they are intentionally retained.
  - Remove the unused `src/lib/vitest-examples` files when they are no longer needed as test configuration smoke checks.

## Completion gate

- [ ] `pnpm check` passes with zero diagnostics.
- [ ] `pnpm lint` passes.
- [ ] `pnpm exec vitest run` passes.
- [ ] `pnpm test:e2e` passes.
- [ ] The standalone Node deployment smoke test passes with the production environment contract.
- [ ] The final VLAN/firewall rehearsal in `docs/TODO.md` is completed.
