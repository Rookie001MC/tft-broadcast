# TDMU Post-Event Operator Workflow TODO

Date: 2026-09-07

Status: Agreed backlog; implementation pending.

Source: FPT Shop Uni Tour 2026 — Thủ Dầu Một University feedback in `docs/TODO.md`.

## Scope and decisions

- Address all five post-event issues: management usability, operator accounts, sample player ZIP, persistent import success feedback, and unclear import errors.
- Use edit dialogs opened from compact lists for players, tournaments, and champion/augment corrections.
- Restrict account management to administrators. Migrate the existing first operator to administrator.
- Persist explicit numeric roles: `OPERATOR = 0`, `ADMINISTRATOR = 1`. Authorize through named-role equality or membership checks, never numeric ordering. Reject unsupported values with a database constraint and default new accounts to operator.
- Separate GFX routes and scenes belong to a teammate and are outside this backlog. LCU TFT End of Game capture and transport will have a separate plan.

## Implementation checklist

- [ ] Replace embedded editing forms with dialogs.
  - Apply to player, tournament, champion, and augment maintenance.
  - Keep compact lists focused on identifying information, status, and explicit actions.
  - Mount only the active editor to reduce DOM and reactive-state overhead.
- [ ] Preserve editing safeguards.
  - Retain searches, active tabs, roster scope, and entered values after validation failure.
  - Confirm discarded edits, manage keyboard focus, and restore focus on close.
  - Preserve Reset-required checks and immutable live publications.
- [ ] Add numeric administrator and operator roles.
  - Migrate the existing first operator to administrator; fresh first-user setup creates an administrator.
  - Keep normal broadcast operations available to both roles.
  - Enforce account-management authorization server-side, including direct endpoint requests.
- [ ] Add an operator-management page.
  - Allow administrators to list, create, and remove accounts and manage administrator access.
  - Use Better Auth's supported account/password handling and keep public signup closed.
  - Revoke removed users' sessions and prevent removing or demoting the last administrator, including concurrent requests.
  - Planning assumption: administrator-created credentials for LAN use; email invitations are outside this pass.
- [ ] Provide a downloadable sample `players.zip`.
  - Include fictional players, valid CSV headers, and small matching example images.
  - Explain UTF-8 CSV encoding, supported image names, optional images, and ZIP-root structure beside the download.
  - Keep instructions outside the importable ZIP unless the parser explicitly allows them.
  - Test the actual downloadable archive through the importer.
- [ ] Separate transient success feedback from persisted import status.
  - Show a dismissible success notice only for the just-completed import; dismiss after ten seconds or navigation.
  - Preserve committed records and server protection against repeated confirmation.
  - Expose the previous result through an explicitly opened "Last import" summary.
  - Clean up timers on dismissal and component destruction; do not replay an old success notice on reload.
- [ ] Make import errors actionable.
  - Carry structured validation errors through ZIP inspection, server actions, and the import panel.
  - Identify archive problems, missing columns, CSV rows, invalid Riot IDs, and image filenames with correction guidance.
  - Display warnings separately and retain generic messages for unexpected internal failures.
- [ ] Align upload limits and documentation.
  - Preserve the current 60 MiB application ZIP limit.
  - Configure production request limits with multipart overhead allowance; `.env.example` currently specifies only `30M`.
  - Align sample instructions, environment examples, README, and affected historical guidance.
- [ ] Verify and close the backlog.
  - Cover dialog behavior, role migration, direct authorization, last-administrator protection, and session revocation.
  - Cover the downloadable ZIP, detailed diagnostics, notice dismissal, navigation, reload, and repeat-confirmation rejection.
  - Exercise representative and oversized uploads against standalone adapter-node output.
  - Regression-test live-publication preservation during maintenance and import operations.
  - Resolve the existing five `autoFitText.js` typing diagnostics before requiring a clean type-check gate.
  - Run server tests, browser-component tests, type checks, lint, and E2E workflows; mark only verified items complete.

## Inspection baseline

- 2026-09-07: Server tests passed: 34 files, 374 tests.
- 2026-09-07: `pnpm check` reported five errors in `src/lib/utils/autoFitText.js`.
- Browser-component, lint, E2E, and standalone deployment checks were not run during this inspection.
