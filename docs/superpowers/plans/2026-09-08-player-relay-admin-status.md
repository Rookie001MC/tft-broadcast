# Player Relay Admin Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give broadcast operators a password-safe Player Relay setup and activity status card on the post-game admin page.

**Architecture:** The authenticated server load reads only relay verifier existence and receipt metadata directly from `MEDIA_ROOT/player-relay/`. The existing post-game page auto-refreshes every three seconds, so it renders current relay state without a new public endpoint. The old direct collector controls remain but are explicitly labeled legacy.

**Tech Stack:** SvelteKit server load and Svelte 5 page component, Node.js filesystem APIs, existing admin authorization.

## Global Constraints

- Never return relay passwords, salts, verifiers, raw capture envelopes, or game JSON to the admin page.
- Treat missing relay files as `Waiting for first Player LCU client`.
- Treat unreadable or malformed relay files as a safe storage-unavailable state.
- Do not create a public player-relay status endpoint.
- Preserve the unrelated `EOG_INGEST_TOKEN` legacy direct-collector workflow.
- Automated tests are waived by the operator; run Svelte checks, formatting/diff checks, and manual helper inspection only.
- Commit all implementation changes for this task together.

---

### Task 1: Load and render safe Player Relay operations status

**Files:**
- Create: `src/lib/server/player-relay/status.js`
- Modify: `src/routes/(admin)/admin/post-game/+page.server.js`
- Modify: `src/routes/(admin)/admin/post-game/+page.svelte`
- Create: `docs/superpowers/plans/2026-09-08-player-relay-admin-status.md`

**Interfaces:**
- Produces `readRelayOperatorStatus(mediaRoot)` returning `{ passwordState, receiptCount, latestReceipt }`.
- `passwordState` is one of `waiting`, `configured`, or `unavailable`.
- `latestReceipt` is `null` or `{ gameId, captureId, receivedAt }`; it excludes capture payloads.
- The post-game `load` returns `relay: { url, passwordState, receiptCount, latestReceipt }` only after `requireAdmin(event)` succeeds.

- [x] **Step 1: Implement the bounded, payload-free status reader.**

```js
export async function readRelayOperatorStatus(mediaRoot) {
	const relayRoot = path.resolve(mediaRoot, 'player-relay');
	const verifier = await readVerifierState(path.join(relayRoot, 'relay-password.json'));
	const receipts = await readReceiptSummary(path.join(relayRoot, 'receipts'));
	return { passwordState: verifier, receiptCount: receipts.count, latestReceipt: receipts.latest };
}
```

Check only that the verifier document is valid enough to contain its expected format, salt, and verifier strings. Enumerate at most 1,000 `.json` receipt files, read only the newest candidate, and return only its `capture.gameId`, `capture.captureId`, and `receivedAt` values. Missing files return `waiting`/empty activity; malformed or inaccessible data returns `unavailable` without throwing into the admin page.

- [x] **Step 2: Add relay status to the authenticated post-game load.**

```js
requireAdmin(event);
const relay = await readRelayOperatorStatus(env.MEDIA_ROOT || 'media');
return {
	// existing preview state
	relay: { ...relay, url: event.url.origin }
};
```

Keep `collectorToken` for the legacy collector details block. Do not put it in the new relay data object.

- [x] **Step 3: Replace the misleading collector guidance with operator-facing relay UI.**

Render a Player LCU Relay card above file import with a color-coded password state, copyable broadcast URL, receipt count, last game/capture/time, and four-step desktop setup instructions. Keep the existing page invalidation timer. Rename the old details summary to `Legacy direct collector` and state that `EOG_INGEST_TOKEN` does not configure Player Relay.

- [x] **Step 4: Validate and commit the task.**

Run:

```powershell
pnpm exec prettier --write src/lib/server/player-relay/status.js "src/routes/(admin)/admin/post-game/+page.server.js" "src/routes/(admin)/admin/post-game/+page.svelte"
pnpm check
git diff --check
```

Expected: the modified relay/admin files have no new diagnostics; the project may retain its known unrelated Svelte errors. Automated tests are intentionally skipped. Commit the status helper, admin page changes, and this plan together:

```powershell
git add src/lib/server/player-relay/status.js "src/routes/(admin)/admin/post-game/+page.server.js" "src/routes/(admin)/admin/post-game/+page.svelte" docs/superpowers/plans/2026-09-08-player-relay-admin-status.md
git commit -m "feat: add player relay admin status"
```

## Plan self-review

- Implementation executed inline; automated tests intentionally skipped as requested.
- Used installed local CLI binaries because pnpm is unavailable on PATH. Prettier and git diff checks passed; Svelte autofixer returned no issues or suggestions.
- SvelteKit sync and svelte-check completed: 38 errors in 8 unrelated files, with no diagnostics in the changed relay/admin files.
- Manual helper inspection confirmed missing storage, configured password, receipt metadata-only output, and malformed receipt fallback. Temporary inspection data was removed.

- Spec coverage: the task adds password-safe configuration state, broadcast URL, receipt activity, setup guidance, legacy collector separation, bounded reads, and no new public endpoint.
- Placeholder scan: no deferred work or unspecified handling remains.
- Type consistency: the status helper output matches the `data.relay` shape rendered by the post-game page.
