# Release Remediation Roadmap Design

## Status

Approved design for the release-remediation program derived from the 2026-08-08 audit.

## Objective

Move the manual-first TFT broadcast application from a working MVP to a production-ready operator tool without expanding into Riot match-history automation, motion graphics, or additional broadcast layouts.

## Delivery Structure

The remediation is split into four independently reviewable workstreams. Each workstream receives its own implementation plan and must leave the application in a working, testable state.

1. [Integrity foundation](./2026-08-08-integrity-foundation-design.md)
   - Enforce ZIP expansion limits from streamed bytes.
   - Replace draft collections with one installation-wide saved board state.
   - Publish immutable board versions with immutable media.
   - Enforce a maximum of three Hextech Augments and no champion maximum.
2. [Operator workflow and data maintenance](./2026-08-08-operator-workflow-data-maintenance-design.md)
   - Put Save, Live, and Reset controls directly in the composer.
   - Add complete player, tournament, and catalog-resource maintenance.
   - Preserve explicit catalog corrections across synchronization of the same TFT set.
   - Render committed import previews as committed.
3. [Search and interface organization](./2026-08-08-search-interface-design.md)
   - Add Fuse.js-based catalog search.
   - Split Game Resources into Champion and Augment tabs.
   - Split the Graphics composer into Champion and Augment tabs.
4. [Deployment readiness](./2026-08-08-deployment-readiness-design.md)
   - Remove scaffold/demo artifacts.
   - Configure client-IP handling with a deny-by-default proxy trust boundary.
   - Add a standalone adapter-node release smoke path.

Workstreams are executed in this order. The deployment smoke path validates the completed behavior from the preceding workstreams.

## Program-Wide Decisions

- The application keeps exactly one saved board state for the entire installation.
- Selecting a different tournament while a saved state exists requires an explicit Reset.
- Operators edit locally and press Save as the deliberate double-check gate.
- When Live is off, Save changes only the saved state.
- When Live is on, Save also publishes a new immutable version immediately.
- Published graphics never resolve mutable player or catalog records.
- Champions have no count limit. Hextech Augments have a server-enforced maximum of three.
- Players, tournaments, champions, and augments are operator-maintainable.
- Catalog exclusions are reversible and catalog corrections remain traceable.
- Manually added catalog resources may omit an image and render a deliberate placeholder.
- Search uses derived display-name and engine-ID forms. Stored aliases are not part of this scope.
- Proxy headers are not trusted unless the deployment explicitly configures the adapter and prevents direct origin access.
- The completed internal VLAN/firewall rehearsal is accepted as satisfying the network rehearsal gate.

## Deferred Work

- Riot TFT-MATCH-V1 experiments remain separate from manual publishing.
- Motion and additional graphics layouts remain post-production improvements.
- A broader structured logging and retention policy remains outside this remediation program.
- MiniSearch remains a possible future replacement if search grows beyond the small in-browser catalog use case.
- Champion-density policy or automatic layout scaling is not treated as a validation limit in this program.

## Program Completion

The program is complete when all four workstreams pass their focused tests, the existing Vitest/check/lint/Vite E2E gates remain green, and the standalone adapter-node release smoke path passes with the documented production environment contract.
