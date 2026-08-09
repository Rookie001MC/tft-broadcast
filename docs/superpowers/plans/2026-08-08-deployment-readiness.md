# Deployment Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Remove scaffold artifacts, establish a deny-by-default client-IP trust boundary for Better Auth, and make the adapter-node standalone release smoke test the final remediation gate.

**Architecture:** The server hook resolves the client address only through SvelteKit event.getClientAddress and overwrites a private internal header only on the Better Auth path. Better Auth reads that one header; clients cannot supply it. A standalone smoke runner owns a temporary database/media root, migrations, deterministic seed, adapter-node process, Playwright child process, and cleanup.

**Tech Stack:** SvelteKit adapter-node, Better Auth 1.6, JavaScript with JSDoc, Node child_process/fs/net APIs, Drizzle/libSQL SQLite, Playwright, Vitest, pnpm.

## Global Constraints

- This is the final workstream and depends on all preceding workstreams.
- Direct deployment has no ADDRESS_HEADER. It uses the adapter socket-derived event.getClientAddress result.
- Reverse-proxy deployment sets ADDRESS_HEADER only when its proxy overwrites/sanitizes that exact header and direct Node-origin access is blocked. X-Forwarded-For additionally requires exact positive XFF_DEPTH.
- Do not enable trusted proxy host/protocol headers in Better Auth. ORIGIN stays explicit.
- The private header passed to Better Auth is x-tft-client-address; discard a client-supplied copy before auth handles the request.
- Configuration remains runtime environment variables. Required production values include DATABASE_URL, MEDIA_ROOT, ORIGIN, BETTER_AUTH_SECRET, BODY_SIZE_LIMIT=30M, and catalog archive limits; HOST/PORT/ADDRESS_HEADER/XFF_DEPTH are optional.
- Keep existing Vite-backed E2E as the fast workflow. The release command must start node build, never Vite preview.
- The release runner never uses an operator database or media root, logs no auth secret/request/upload bytes, and removes only paths verified beneath its own temporary root.
- The prior internal VLAN/firewall rehearsal is accepted; document it as complete. The standalone smoke remains open until it passes.

---

## File Structure

- src/hooks.server.js, src/lib/server/auth.js, and src/lib/server/auth/client-address.js: resolve, sanitize, and supply the client address to Better Auth.
- src/hooks.server.test.js and src/lib/server/auth/client-address.test.js: direct, proxy, spoofing, failure, and independent-rate-limit identities.
- src/routes/healthz/+server.js: unauthenticated readiness response used only by the smoke runner.
- src/routes/demo and src/lib/vitest-examples: removed scaffold routes/examples and associated test files.
- vite.config.js, playwright.config.js, tests/manual-winner-graphics.test.js: retain real browser project and production-navigation coverage after cleanup.
- playwright.release.config.js and tests/release-smoke.e2e.js: release-only Playwright project and completed workflow.
- scripts/release-smoke.js and scripts/release-seed.js: temporary environment, migrations/seed, standalone server lifecycle, Playwright invocation, and verified cleanup.
- package.json, .env.example, README.md, docs/TODO.md, and docs/AUDIT-TODO.md: command, runtime contract, direct/proxy runbook, and updated audit state.

---

### Task 1: Remove scaffold artifacts while preserving production coverage

**Files:**

- Delete: src/routes/demo/+page.svelte
- Delete: src/routes/demo/playwright/+page.svelte
- Delete: src/routes/demo/playwright/page.svelte.e2e.js
- Delete: src/lib/vitest-examples/greet.js
- Delete: src/lib/vitest-examples/greet.spec.js
- Delete: src/lib/vitest-examples/Welcome.svelte
- Delete: src/lib/vitest-examples/Welcome.svelte.spec.js
- Modify: vite.config.js
- Modify: playwright.config.js
- Modify: tests/manual-winner-graphics.test.js

**Interfaces:**

- Produces no demo route or template test, while retaining the named client browser Vitest project and all production sidebar destinations.

- [ ] **Step 1: Prove real browser tests run before removal**

Run:

~~~powershell
pnpm exec vitest run --project client
~~~

Expected: PASS with src/lib/components/admin/admin-components.svelte.test.js and any completed workstream component tests. Record the output count in the task log.

- [ ] **Step 2: Add route/navigation smoke assertions**

Extend the production E2E suite to visit Dashboard, Players, Tournaments, Game Resources, Graphics, and Settings via each visible Sidebar link. Assert a real heading and no demo link/route is present.

- [ ] **Step 3: Delete only scaffold files and related configuration**

Remove the two demo routes/test and all vitest example files. Remove a Vite/Vitest include or ignore only if it exists solely for those examples. Preserve the client project configuration:

~~~js
{
	name: 'client',
	browser: {
		enabled: true,
		provider: playwright(),
		instances: [{ browser: 'chromium', headless: true }]
	},
	include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
	exclude: ['src/lib/server/**']
}
~~~

- [ ] **Step 4: Verify cleanup**

Run:

~~~powershell
pnpm exec vitest run
pnpm test:e2e
rg --files src/routes/demo src/lib/vitest-examples
~~~

Expected: both test commands PASS; the final command returns no files.

- [ ] **Step 5: Commit**

~~~powershell
git rm src/routes/demo/+page.svelte src/routes/demo/playwright/+page.svelte src/routes/demo/playwright/page.svelte.e2e.js src/lib/vitest-examples/greet.js src/lib/vitest-examples/greet.spec.js src/lib/vitest-examples/Welcome.svelte src/lib/vitest-examples/Welcome.svelte.spec.js
git add vite.config.js playwright.config.js tests/manual-winner-graphics.test.js
git commit -m "chore: remove scaffold demo artifacts"
~~~

### Task 2: Sanitize the Better Auth client-address boundary

**Files:**

- Create: src/lib/server/auth/client-address.js
- Create: src/lib/server/auth/client-address.test.js
- Modify: src/hooks.server.js
- Modify: src/lib/server/auth.js
- Modify: src/hooks.server.test.js

**Interfaces:**

- Produces BETTER_AUTH_CLIENT_ADDRESS_HEADER equal to x-tft-client-address.
- Produces resolveClientAddress(event) and withSanitizedAuthRequest(event, address).
- Better Auth is configured to read only x-tft-client-address for IP tracking/rate limiting.

- [ ] **Step 1: Write direct/proxy/spoof/failure tests**

Use event stubs whose getClientAddress returns a socket address, a proxy-resolved address, or throws. Assert a client-supplied x-tft-client-address is replaced, unrelated headers/cookies remain, direct and proxy addresses reach auth, and an address failure returns a safe auth failure rather than forwarded-header fallback.

~~~js
const authEvent = withSanitizedAuthRequest(event, '198.51.100.42');
expect(authEvent.request.headers.get('x-tft-client-address')).toBe('198.51.100.42');
expect(authEvent.request.headers.get('x-forwarded-for')).toBe('203.0.113.9');
~~~

Add a test path proving two resolved addresses generate distinct Better Auth rate-limit identity inputs.

- [ ] **Step 2: Implement the header replacement helper**

Clone request headers, delete any incoming internal header, set the resolved address, and replace only request on a proxy event object passed to svelteKitHandler. Do not read X-Forwarded-For, X-Real-IP, or provider headers in application code.

~~~js
export const BETTER_AUTH_CLIENT_ADDRESS_HEADER = 'x-tft-client-address';

export function withSanitizedAuthRequest(event, address) {
	const headers = new Headers(event.request.headers);
	headers.delete(BETTER_AUTH_CLIENT_ADDRESS_HEADER);
	headers.set(BETTER_AUTH_CLIENT_ADDRESS_HEADER, address);
	return Object.assign(Object.create(event), {
		request: new Request(event.request, { headers })
	});
}
~~~

- [ ] **Step 3: Resolve before Better Auth**

In the hook, call event.getClientAddress only for Better Auth handling. If it throws or returns no address, return a generic 503 auth-path response and do not invoke Better Auth with a forged fallback. Continue existing session/local/admin behavior after sanitized auth succeeds.

- [ ] **Step 4: Pin Better Auth to the private header**

Add the locked Better Auth configuration supported by installed 1.6 types:

~~~js
advanced: {
	ipAddress: {
		ipAddressHeaders: [BETTER_AUTH_CLIENT_ADDRESS_HEADER]
	}
}
~~~

Run pnpm check immediately. If the installed 1.6 type surface differs, use the equivalent documented 1.6 option and add its exact locked-version test; do not fall back to a generic forwarded header.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
pnpm exec vitest run --project server src/hooks.server.test.js src/lib/server/auth/client-address.test.js
pnpm check
~~~

Expected: PASS.

~~~powershell
git add src/hooks.server.js src/hooks.server.test.js src/lib/server/auth.js src/lib/server/auth/client-address.js src/lib/server/auth/client-address.test.js
git commit -m "fix: sanitize Better Auth client addresses"
~~~

### Task 3: Add readiness and release-only Playwright coverage

**Files:**

- Create: src/routes/healthz/+server.js
- Create: playwright.release.config.js
- Create: tests/release-smoke.e2e.js
- Modify: tests/manual-winner-graphics.test.js

**Interfaces:**

- GET /healthz returns 200 with ready true after app initialization.
- Release tests use E2E_BASE_URL and do not run under the ordinary Playwright config.

- [ ] **Step 1: Add health readiness test**

Write a request-handler test for a fixed response:

~~~js
export function GET() {
	return Response.json({ ready: true }, { headers: { 'Cache-Control': 'no-store' } });
}
~~~

The handler must not expose database paths, environment values, or credentials.

- [ ] **Step 2: Create release Playwright configuration**

Use a dedicated config with only the release test, one worker, the existing browser settings, and a base URL supplied by E2E_BASE_URL.

~~~js
export default defineConfig({
	testDir: '.',
	testMatch: ['tests/release-smoke.e2e.js'],
	workers: 1,
	use: { baseURL: process.env.E2E_BASE_URL }
});
~~~

Do not provide a webServer or Vite preview in this configuration.

- [ ] **Step 3: Write the completed release workflow**

Cover setup/login, one player/tournament/catalog correction mutation, an accepted valid player bundle larger than 512 KiB, an application-rejected bundle larger than 25 MiB, saved singleton board, Live-on gfx render, save-live publication update without gfx refresh, hide/reset transparent canvas, and unchanged/changed ETag behavior.

Use an image fixture whose first bytes are valid PNG signature and whose random remainder makes the ZIP exceed 512 KiB. For the over-limit upload, use a File over 25 MiB; the app must return its ZIP-limit message rather than a body-size rejection.

- [ ] **Step 4: Verify independent project selection**

Run:

~~~powershell
pnpm exec playwright test -c playwright.release.config.js --list
pnpm exec playwright test --list
~~~

Expected: the first lists only release-smoke.e2e.js; the second lists ordinary Vite E2E tests and not release smoke.

- [ ] **Step 5: Commit**

~~~powershell
git add src/routes/healthz playwright.release.config.js tests/release-smoke.e2e.js tests/manual-winner-graphics.test.js
git commit -m "test: add standalone release smoke coverage"
~~~

### Task 4: Build the isolated adapter-node smoke runner

**Files:**

- Create: scripts/release-seed.js
- Create: scripts/release-smoke.js
- Modify: package.json
- Modify: scripts/e2e-server.js
- Create: scripts/release-smoke.test.js

**Interfaces:**

- Produces pnpm test:e2e:release.
- The runner creates a temporary root, returns a free port, starts node build, runs release Playwright, then always terminates the child/removes only temporary database/media.

- [ ] **Step 1: Test path containment and lifecycle helpers**

Cover that cleanup rejects a resolved path outside the generated temporary root, port allocation returns a connectable free port, startup timeout includes sanitized child output, and child termination happens on both success and failure.

~~~js
export function assertWithinRoot(root, target) {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error('Release cleanup path escapes temporary root');
	}
	return path.resolve(target);
}
~~~

- [ ] **Step 2: Extract deterministic release seed**

Create a seed module that applies Drizzle migrations and inserts only deterministic tournament/catalog records required by the release test. It receives database URL and media root from the runner and does not read normal .env files.

- [ ] **Step 3: Implement the standalone runner**

Build with pnpm build, create the temporary root using mkdtemp beneath os.tmpdir, allocate a port, migrate/seed, then spawn process.execPath with build as its sole child command. Pass this minimum environment:

~~~js
{
	DATABASE_URL: 'file:' + databasePath,
	MEDIA_ROOT: mediaRoot,
	ORIGIN: 'http://127.0.0.1:' + port,
	BETTER_AUTH_SECRET: 'release-test-secret-at-least-32-chars',
	BODY_SIZE_LIMIT: '30M',
	CATALOG_MAX_ARCHIVE_GIB: '4',
	CATALOG_MAX_EXTRACTED_GIB: '16',
	HOST: '127.0.0.1',
	PORT: String(port)
}
~~~

Poll /healthz until success or timeout, start Playwright with E2E_BASE_URL, and use a finally path to terminate process and recursively remove only database/media paths verified by assertWithinRoot. Preserve build output after failures. Captured server output must omit environment and request bodies.

- [ ] **Step 4: Add script wiring**

Add:

~~~json
"test:e2e:release": "node scripts/release-smoke.js"
~~~

Keep test:e2e and scripts/e2e-server.js as the Vite build/preview fast path. Do not replace them with the release runner.

- [ ] **Step 5: Run the actual standalone gate**

Run:

~~~powershell
pnpm test:e2e:release
~~~

Expected: adapter-node build starts with node build, release tests pass, and test-owned database/media disappear while build remains.

- [ ] **Step 6: Commit**

~~~powershell
git add scripts/release-seed.js scripts/release-smoke.js scripts/release-smoke.test.js scripts/e2e-server.js package.json
git commit -m "test: run adapter-node release smoke"
~~~

### Task 5: Document the environment contract and execute final verification

**Files:**

- Modify: .env.example
- Modify: README.md
- Modify: docs/TODO.md
- Modify: docs/AUDIT-TODO.md

**Interfaces:**

- Produces a runbook with direct and reverse-proxy deployment examples and the standalone release command.

- [ ] **Step 1: Document required and optional environment values**

Update .env.example with BODY_SIZE_LIMIT=30M and clear labels for database, media root, ORIGIN, Better Auth secret, catalog archive limits, HOST, PORT, ADDRESS_HEADER, and XFF_DEPTH. Do not put a real secret in the file.

- [ ] **Step 2: Document direct deployment**

Document that direct adapter-node deployment leaves ADDRESS_HEADER and XFF_DEPTH unset, sets explicit ORIGIN, binds the selected host/port, and derives address from the connection socket.

- [ ] **Step 3: Document reverse proxy requirements**

Document a concrete conditional example:

~~~env
ADDRESS_HEADER=X-Forwarded-For
XFF_DEPTH=1
~~~

State that the proxy must overwrite the configured header, block direct origin access, and set the depth to the actual trusted hops. Do not use broad private-network ranges as sender proof or enable trusted proxy host/protocol headers.

- [ ] **Step 4: Update audit state only after a passed release command**

Mark the completed internal VLAN/firewall rehearsal complete. Leave the standalone smoke gate unchecked until pnpm test:e2e:release exits successfully, then mark it complete and record its command/date.

- [ ] **Step 5: Run final commands**

Run:

~~~powershell
pnpm exec vitest run
pnpm check
pnpm lint
pnpm test:e2e
pnpm test:e2e:release
~~~

Expected: every command PASS.

- [ ] **Step 6: Commit**

~~~powershell
git add .env.example README.md docs/TODO.md docs/AUDIT-TODO.md
git commit -m "docs: define production release contract"
~~~

## Workstream Exit Criteria

- No demo route or template Vitest examples remain, and the real browser project still executes.
- Better Auth receives only a server-overwritten client-address header derived by event.getClientAddress.
- Direct and reverse proxy contracts are documented and no proxy headers are trusted by default.
- pnpm test:e2e:release starts node build and passes all release workflow assertions.
- pnpm exec vitest run, pnpm check, pnpm lint, pnpm test:e2e, and pnpm test:e2e:release pass.
