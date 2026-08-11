# TFT Production Graphics Status

The production MVP is manual-first. Riot match-history automation remains outside the critical path until its reliability can be evaluated separately.

## Completed

- [x] Combined auth, catalog, player, tournament, import, winner-board, and live-state schema.
- [x] Safe ZIP player import preview, expiring token confirmation, and controlled managed images.
- [x] CommunityDragon/Data Dragon normalization, fallback, and transactional catalog activation.
- [x] Authenticated Skeleton UI operator control surface with scoped roster and board composition.
- [x] Shared exact 1920×1080 preview and public `/gfx` broadcast renderer.
- [x] Transactional publish/hide controls and one-second ETag polling.
- [x] Server, browser-component, and multi-page end-to-end workflow coverage.
- [x] Standalone Node build and trusted LAN/VLAN deployment runbook.

## Follow-up

- [x] Rehearse the deployment on the final production VLAN and firewall rule before the first show.
- [ ] Experiment with TFT-MATCH-V1 separately; do not couple it to manual publishing until reliability is proven.
- [ ] Consider motion and additional graphic layouts after the static workflow has operated successfully in production.
