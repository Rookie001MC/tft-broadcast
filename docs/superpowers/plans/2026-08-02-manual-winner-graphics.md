# Manual Winner Graphics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manual-first TFT winner graphic tool where authenticated operators manage tournaments, preview and commit ZIP roster bundles, pin TFT asset catalogs, compose winner boards, and publish a live-updating 1920x1080 `/gfx` browser source without Riot match history.

**Architecture:** Keep `@libsql/client` and the existing Drizzle/libSQL connection. All production writes stay in server-only modules and SvelteKit form actions; multi-step mutations use libSQL transactions. `/admin` reads tournament-scoped roster and catalog data, while `/gfx` reads a singleton published-graphic state and refreshes through a one-second ETag/version poll.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, JavaScript with JSDoc, Drizzle ORM, libSQL via `@libsql/client`, Better Auth, Tailwind CSS/Skeleton 5, pnpm, Vitest 4, Playwright.

## Global Constraints

- Keep the existing `@libsql/client` database driver; do not add or migrate to `better-sqlite3`.
- Preserve the existing Vitest browser/server projects and the existing Playwright test command.
- MVP must work without `RIOT_API_KEY`; no Riot match history, live-client integration, scouting, recommendations, statistics, bracket, standings, or `.xlsx` import.
- `/admin` and every admin action require Better Auth. `/setup` creates only the first user; `/login` is the only public sign-in surface.
- Operators upload a ZIP whose root contains `players.csv` and `player_images/`; they never enter a server filesystem path.
- Import always has preview and confirm phases. Confirm commits the exact staged bytes identified by an opaque, expiring token.
- Supported player images are PNG, JPEG, and WebP. Validate file signatures, not only extensions or multipart MIME.
- A tournament's winner must come from its roster. Board champions and augments must come from its active catalog snapshot.
- Publishing requires a tournament, roster winner, and at least one champion. Image, augments, Riot ID, and Riot API data remain optional.
- Draft changes never affect `/gfx`. Publish/hide are atomic and increment a singleton graphic-state version.
- CommunityDragon lookup order is requested locale then `en_us`; Data Dragon is the fallback. Total failure keeps the prior active snapshot and returns a warning.
- `/gfx` is public, fixed at 1920x1080, and checks the graphic version once per second using ETag/304 responses.
- Admin preview and `/gfx` render the same `WinnerBoardGraphic.svelte` component and data contract.

---

## File Structure

- `package.json`: retain current scripts; add streaming ZIP/CSV/file-signature dependencies and a focused server-test alias.
- `vite.config.js`: retain browser/server Vitest projects unchanged.
- `src/lib/vitest-examples/greet.js`: fix the existing JSDoc baseline error.
- `src/lib/server/db/schema/{catalog,players,tournaments,winner-boards,imports}.js`: application tables.
- `src/lib/server/db/schema/index.js`: combined Better Auth and application schema.
- `src/lib/server/auth/guards.js`: setup-state and authenticated-admin guards.
- `src/lib/server/import/{riot-id,player-bundle,staging}.js`: pure parsing plus staged preview/commit.
- `src/lib/server/media/player-images.js`: signature validation, managed writes, and contained reads.
- `src/lib/server/catalog/catalog-sync.js`: CDragon/DDragon normalization and fail-safe activation.
- `src/lib/server/winner-boards/repository.js`: tournament-scoped draft, publish, hide, read, and version operations.
- `src/routes/{setup,login}/`: first-user setup and sign-in pages/actions.
- `src/routes/admin/+layout.server.js`: admin authentication guard.
- `src/routes/admin/+page.server.js`: scoped loading and named actions.
- `src/lib/components/admin/*.svelte`: tournament, import, roster, composer, and publish controls.
- `src/lib/components/WinnerBoardGraphic.svelte`: shared admin/broadcast renderer.
- `src/routes/media/player-images/[playerId]/+server.js`: controlled media response.
- `src/routes/gfx/+page.server.js`: published board loader.
- `src/routes/gfx/+page.svelte`: renderer plus version polling.
- `src/routes/gfx/version/+server.js`: lightweight ETag/version response.
- `src/**/*.test.js`: server unit/integration tests.
- `tests/*.test.js`: Playwright workflow tests.

---

### Task 1: Preserve Tooling Baseline And Add Application Schema

**Files:**

- Modify: `.prettierignore`
- Modify: `package.json`
- Modify: `src/lib/vitest-examples/greet.js`
- Modify: `src/lib/server/db/schema/index.js`
- Create: `src/lib/server/db/schema/catalog.js`
- Create: `src/lib/server/db/schema/players.js`
- Create: `src/lib/server/db/schema/tournaments.js`
- Create: `src/lib/server/db/schema/winner-boards.js`
- Create: `src/lib/server/db/schema/imports.js`
- Create: `src/lib/server/db/schema/schema.test.js`

**Interfaces:**

- Produces tables `catalogSnapshots`, `catalogChampions`, `catalogAugments`, `players`, `tournaments`, `tournamentPlayers`, `winnerBoards`, `winnerBoardChampions`, `winnerBoardAugments`, `graphicState`, and `playerImportPreviews`.
- Preserves Better Auth exports from `schema/auth.js` and the libSQL `db` export.

- [ ] **Step 1: Establish the real baseline**

Run:

```powershell
pnpm exec vitest run --project server
pnpm check
pnpm lint
```

Expected: server Vitest passes; `pnpm check` fails only because `greet.js` has an implicit `any` parameter; `pnpm lint` reports the existing formatting baseline. If other semantic failures appear, resolve them before feature work.

- [ ] **Step 2: Fix the existing check failure**

Change `greet.js` to:

```js
/** @param {string} name */
export function greet(name) {
	return 'Hello, ' + name + '!';
}
```

Add generated/reference paths to `.prettierignore`:

```text
/docs/communitydragon/
/src/lib/openapi/
/src/lib/server/db/schema/auth.js
```

Format the remaining baseline files reported by Prettier:

```powershell
pnpm exec prettier --write README.md docs/TODO.md src/lib/layouts/AdminLayout.svelte src/lib/layouts/GraphicsLayout.svelte src/lib/server/db/index.js src/lib/server/db/schema/index.js src/routes/+page.svelte src/routes/admin/+layout.svelte src/routes/gfx/+layout.svelte
```

Run `pnpm check` and `pnpm lint`. Expected: PASS.

- [ ] **Step 3: Add only the required dependencies and script**

Run:

```powershell
pnpm add csv-parse file-type yauzl
pnpm add -D @types/yauzl fflate
```

Add without replacing current scripts:

```json
"test:server": "vitest run --project server"
```

Do not replace `test`, `test:unit`, `test:e2e`, or the Vitest `projects` configuration.

- [ ] **Step 4: Write the failing schema smoke test**

Create `schema.test.js`:

```js
import { describe, expect, test } from 'vitest';
import * as schema from './index.js';

describe('manual winner graphics schema', () => {
	test('exports every application table', () => {
		for (const name of [
			'catalogSnapshots',
			'catalogChampions',
			'catalogAugments',
			'players',
			'tournaments',
			'tournamentPlayers',
			'winnerBoards',
			'winnerBoardChampions',
			'winnerBoardAugments',
			'graphicState',
			'playerImportPreviews'
		])
			expect(schema[name]).toBeDefined();
	});
});
```

Run `pnpm exec vitest run --project server src/lib/server/db/schema/schema.test.js`.
Expected: FAIL because the tables do not exist.

- [ ] **Step 5: Add catalog, player, and tournament tables**

Define these exact catalog/player/tournament columns:

```js
// catalogSnapshots
id, source, sourceUrl, locale, patchLabel, setLabel, syncedAt, isAvailable, metadataJson

// catalogChampions and catalogAugments
id, catalogSnapshotId, externalId, displayName, iconPath, tier, metadataJson

// players
id, riotId, riotIdKey, riotGameName, riotTagline, fullName, displayName,
imagePath, createdAt, updatedAt

// tournaments
id, name, slug, activeCatalogSnapshotId, createdAt, updatedAt

// tournamentPlayers
tournamentId, playerId, displayOrder, notes

// required indexes/constraints
uniqueIndex('catalog_champions_snapshot_external_uq')
	.on(table.catalogSnapshotId, table.externalId),
uniqueIndex('catalog_augments_snapshot_external_uq')
	.on(table.catalogSnapshotId, table.externalId)

// players.js
riotIdKey: text('riot_id_key').unique(), // lowercase duplicate key; nullable

activeCatalogSnapshotId: text('active_catalog_snapshot_id')
	.references(() => catalogSnapshots.id, { onDelete: 'set null' })

// tournamentPlayers composite primary key
primaryKey({ columns: [table.tournamentId, table.playerId] })
```

Keep `riotId`, `riotGameName`, and `riotTagline` nullable so manual players without Riot IDs remain valid.

- [ ] **Step 6: Add winner-board and singleton live-state tables**

Define these exact winner-board columns:

```js
// winnerBoards
(id, tournamentId, winnerPlayerId, title, status, createdAt, updatedAt, publishedAt);

// winnerBoardChampions
(id, winnerBoardId, catalogChampionId, starLevel, displayOrder);

// winnerBoardAugments
(id, winnerBoardId, catalogAugmentId, displayOrder);
```

Both child tables reference `winnerBoards` with cascade delete; catalog references use restrict delete. Add the singleton table:

```js
export const graphicState = sqliteTable('graphic_state', {
	id: text('id').primaryKey(), // always "live"
	publishedWinnerBoardId: text('published_winner_board_id').references(() => winnerBoards.id, {
		onDelete: 'set null'
	}),
	version: integer('version').notNull().default(0),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
```

The repository will create the singleton lazily with `id: 'live'`; migrations do not rely on seed data.

- [ ] **Step 7: Add staged-import table**

Create `imports.js`:

```js
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const playerImportPreviews = sqliteTable('player_import_previews', {
	token: text('token').primaryKey(),
	stagedPath: text('staged_path').notNull(),
	sha256: text('sha256').notNull(),
	previewJson: text('preview_json').notNull(),
	status: text('status', { enum: ['previewed', 'committed'] })
		.notNull()
		.default('previewed'),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});
```

- [ ] **Step 8: Export the combined schema and verify**

`schema/index.js` must export `auth.js` plus all five application schema modules. Do not modify `src/lib/server/db/index.js` away from `drizzle-orm/libsql`.

Run:

```powershell
pnpm exec vitest run --project server src/lib/server/db/schema/schema.test.js
pnpm check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add .prettierignore package.json pnpm-lock.yaml README.md docs/TODO.md src/lib/vitest-examples/greet.js src/lib/layouts src/lib/server/db src/routes/+page.svelte src/routes/admin/+layout.svelte src/routes/gfx/+layout.svelte
git commit -m "feat: add manual graphics schema"
```

---

### Task 2: First-User Setup, Login, Logout, And Admin Guard

**Files:**

- Create: `src/lib/server/auth/guards.js`
- Create: `src/lib/server/auth/guards.test.js`
- Create: `src/routes/setup/+page.server.js`
- Create: `src/routes/setup/+page.svelte`
- Create: `src/routes/login/+page.server.js`
- Create: `src/routes/login/+page.svelte`
- Create: `src/routes/admin/+layout.server.js`
- Modify: `src/lib/server/auth.js`

**Interfaces:**

- Produces `hasAnyUser(db): Promise<boolean>` and `requireAdmin(event): void`.
- Setup/login call `auth.api.signUpEmail` and `auth.api.signInEmail`; the existing `sveltekitCookies` plugin writes session cookies.

- [ ] **Step 1: Write failing guard tests**

Test with stub events and an in-memory libSQL client that `hasAnyUser` returns false for an empty user table and true after insertion, that `requireAdmin` throws a 303 redirect to `/login?next=...` for anonymous requests, and that it returns normally when `event.locals.user` exists.

Run the focused test. Expected: FAIL because `guards.js` is missing.

- [ ] **Step 2: Implement guard helpers**

```js
import { redirect } from '@sveltejs/kit';
import { user } from '$lib/server/db/schema/auth.js';

/** @param {any} db */
export async function hasAnyUser(db) {
	const rows = await db.select({ id: user.id }).from(user).limit(1);
	return rows.length > 0;
}

/** @param {{ locals: App.Locals, url: URL }} event */
export function requireAdmin(event) {
	if (!event.locals.user) {
		const next = encodeURIComponent(event.url.pathname + event.url.search);
		redirect(303, `/login?next=${next}`);
	}
}
```

- [ ] **Step 3: Add setup actions**

`/setup` load redirects to `/login` when `hasAnyUser(db)` is true. Its default action rechecks immediately before calling:

```js
await auth.api.signUpEmail({
	headers: request.headers,
	body: { name, email, password }
});
redirect(303, '/admin');
```

Validate trimmed name/email and a password of at least 12 characters with `fail(400, { message })`. Convert Better Auth API errors into a generic setup failure; never return secrets.

- [ ] **Step 4: Block the public Better Auth sign-up endpoint after setup**

Modify `src/lib/server/auth.js` to add a Better Auth `before` hook for `/sign-up/email`. The hook calls `hasAnyUser(db)` and throws `new APIError('FORBIDDEN')` when a user already exists. This applies even when a caller posts directly to `/api/auth/sign-up/email`.

- [ ] **Step 5: Add login actions**

`/login` redirects authenticated users to `/admin`. Its action calls:

```js
await auth.api.signInEmail({ headers: request.headers, body: { email, password } });
redirect(303, safeNext);
```

`safeNext` is `/admin` unless the `next` parameter starts with `/admin`; never allow an external URL.

- [ ] **Step 6: Add the admin layout guard**

```js
import { requireAdmin } from '$lib/server/auth/guards.js';

/** @type {import('./$types').LayoutServerLoad} */
export function load(event) {
	requireAdmin(event);
	return { user: event.locals.user };
}
```

- [ ] **Step 7: Build setup/login pages and run the Svelte autofixer**

Both pages use labeled email/password controls, render `form?.message`, and post normally without exposing registration elsewhere. Run `svelte_autofixer` on each until it reports no issues.

- [ ] **Step 8: Verify and commit**

Run `pnpm exec vitest run --project server`, `pnpm check`, and `pnpm lint`. Expected: PASS.

```powershell
git add src/lib/server/auth src/routes/setup src/routes/login src/routes/admin/+layout.server.js
git commit -m "feat: protect operator routes"
```

---

### Task 3: ZIP Bundle Parsing And Import Preview

**Files:**

- Create: `src/lib/server/import/riot-id.js`
- Create: `src/lib/server/import/player-bundle.js`
- Create: `src/lib/server/import/player-bundle.test.js`

**Interfaces:**

- Produces `normalizeRiotId(raw)` with preserved display casing plus lowercase `riotIdKey` and `imageKey`.
- Produces `inspectPlayerBundle(zipBytes, existingPlayers): Promise<PlayerImportPreview>`.
- Pure inspection performs no database or managed-media writes.

- [ ] **Step 1: Write Riot ID and CSV tests**

Cover valid IDs, missing tags, invalid lengths, case-insensitive duplicates, optional split-field mismatch, quoted commas, CRLF, duplicate display names, and missing required columns. Expected duplicate keys use lowercase but returned `riotId` preserves the normalized display form.

- [ ] **Step 2: Write ZIP safety tests**

Build fixtures in memory with `fflate.zipSync`. Assert that a root `players.csv` plus `player_images/` succeeds; absolute and dot-dot paths throw `Unsafe ZIP entry path`; UNIX symlink entries throw `ZIP symlinks are not supported`; entry count over 500 throws `ZIP contains too many entries`; declared expanded bytes over 100 MiB throws `ZIP expanded size is too large`; unmatched and duplicate images appear in preview; and an extension/signature mismatch appears in `preview.errors`.

Run the test. Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement normalization**

`normalizeRiotId` trims both segments, enforces one `#`, Game Name length 3-16, tagline length 3-5, and the locally documented Riot ID character rule. It returns:

```js
{
	riotId: `${gameName}#${tagline}`,
	riotIdKey: `${gameName}#${tagline}`.toLocaleLowerCase('en-US'),
	gameName,
	tagline,
	imageKey: `${gameName}_${tagline}`.toLocaleLowerCase('en-US')
}
```

- [ ] **Step 4: Implement bounded ZIP inspection**

Use `yauzl.fromBuffer` in lazy-entry mode after rejecting multipart files larger than 25 MiB. Reject encrypted entries, UNIX symlink mode bits, more than 500 entries, or more than 100 MiB total declared uncompressed bytes before reading entry contents. Normalize every entry with POSIX separators and reject entries when:

```js
path.posix.isAbsolute(name) ||
	name.split('/').includes('..') ||
	(!name.startsWith('player_images/') && name !== 'players.csv');
```

Reject more than 500 entries or more than 100 MiB combined expanded bytes. Require exactly one `players.csv`.

- [ ] **Step 5: Parse CSV and inspect images**

Use `csv-parse/sync` with:

```js
parse(csvText, {
	columns: true,
	bom: true,
	skip_empty_lines: true,
	trim: true,
	relax_column_count: false
});
```

Use `fileTypeFromBuffer` to require `image/png`, `image/jpeg`, or `image/webp`, and require the detected type to agree with the filename extension. Return rows with `create`, `update`, or `skip`, plus errors, warnings, matched images, and unmatched images. Any error makes preview non-committable.

- [ ] **Step 6: Verify and commit**

Run focused tests and `pnpm check`. Expected: PASS.

```powershell
git add src/lib/server/import package.json pnpm-lock.yaml
git commit -m "feat: preview uploaded player bundles"
```

---

### Task 4: Staged Preview Tokens, Managed Images, And Transactional Commit

**Files:**

- Create: `src/lib/server/import/staging.js`
- Create: `src/lib/server/import/staging.test.js`
- Create: `src/lib/server/media/player-images.js`
- Modify: `src/lib/server/import/player-bundle.js`

**Interfaces:**

- Produces `stagePlayerImport({ db, zipBytes, mediaRoot, existingPlayers })`.
- Produces `commitStagedPlayerImport({ db, token, mediaRoot })`.
- Produces `resolveContainedPath(root, relativePath)` and managed image read/write helpers.

- [ ] **Step 1: Write failing staging tests**

Cover successful stage/commit, expired token, already-used token, digest mismatch, validation errors, rollback on database failure, and orphan staging cleanup. Assert that preview performs no player or managed-image writes.

- [ ] **Step 2: Implement safe path and image helpers**

Containment uses `path.relative`, not string prefixes:

```js
export function resolveContainedPath(root, relativePath) {
	const absoluteRoot = path.resolve(root);
	const target = path.resolve(absoluteRoot, relativePath);
	const relative = path.relative(absoluteRoot, target);
	if (relative.startsWith('..') || path.isAbsolute(relative))
		throw new Error('Path escapes managed root');
	return target;
}
```

Managed filenames are generated from player ID plus detected extension; never reuse an uploaded path segment.

- [ ] **Step 3: Implement staging**

Before staging, remove expired preview rows and their contained files. Stage the original ZIP at `MEDIA_ROOT/import-staging/<token>.zip`, store only the relative path `import-staging/<token>.zip`, calculate SHA-256, store preview JSON and a 30-minute expiry in `playerImportPreviews`, and return `{ token, preview }`. Delete the file if inserting the DB record fails.

- [ ] **Step 4: Implement transactional commit**

Commit reads the preview record, requires `status === 'previewed'`, checks expiry and SHA-256, and re-runs inspection against current players. If the normalized preview differs from `previewJson`, reject with `Import preview is stale` and require a new preview. Write each validated image to a new, unique final managed filename before the database transaction, without overwriting an existing path. Inside `db.transaction(async (tx) => ...)`, upsert players by `riotIdKey`, point rows at the new files, and mark the token committed. If the transaction fails, delete only the newly written files. After success, delete the staged ZIP; a failed staging-file cleanup is harmless because the committed token cannot be reused and later cleanup removes it. Old unreferenced player images may also be cleaned up opportunistically. This ordering never commits a database path before its file exists.

- [ ] **Step 5: Verify and commit**

Run focused tests, all server tests, and `pnpm check`. Expected: PASS.

```powershell
git add src/lib/server/import src/lib/server/media
git commit -m "feat: commit staged player imports"
```

---

### Task 5: Catalog Normalization, Fallback, And Safe Activation

**Files:**

- Create: `src/lib/server/catalog/catalog-sync.js`
- Create: `src/lib/server/catalog/catalog-sync.test.js`

**Interfaces:**

- Produces `syncAndActivateCatalog({ db, tournamentId, patch, locale, fetchJson })`.
- Returns `{ activated, snapshotId, source, locale, champions, augments, warning }`.

- [ ] **Step 1: Add representative CDragon and DDragon fixtures**

Fixtures must include raw client paths, missing augments, multiple CDragon set keys in non-numeric insertion order, and localized names.

- [ ] **Step 2: Write failing fallback tests**

Assert this exact order:

1. CDragon requested locale.
2. CDragon `en_us` when different.
3. Resolve CommunityDragon `latest` through `/latest/content-metadata.json` and extract immutable major/minor patch `N.N` before storing source or icon URLs.
4. Resolve Data Dragon `latest` through `/api/versions.json` when needed.
5. DDragon requested locale.
6. DDragon `en_US` when different.

Also assert that total failure returns `activated: false`, preserves the tournament's prior snapshot ID, and writes no partial snapshot.

- [ ] **Step 3: Implement asset URL normalization**

Map CDragon `/lol-game-data/assets/...` paths to the documented lowercased `plugins/rcp-be-lol-game-data/global/default/...` URL under the requested patch. Preserve already-HTTPS URLs. Build DDragon image URLs from the resolved version and image filename. Reject non-HTTPS output.

- [ ] **Step 4: Implement source normalization**

Select the active CDragon set deterministically from numeric set keys and exclude empty/placeholder champion records. A DDragon result is usable when at least one champion exists; augment failure becomes an empty optional list plus warning.

- [ ] **Step 5: Implement transactional activation**

Only after a usable normalized result exists, create the snapshot and its children and update `tournaments.activeCatalogSnapshotId` inside one `db.transaction`. Verify the tournament exists before network work. A transaction failure leaves the previous active snapshot unchanged.

- [ ] **Step 6: Verify and commit**

Run focused tests, server tests, and `pnpm check`. Expected: PASS.

```powershell
git add src/lib/server/catalog
git commit -m "feat: sync fail-safe TFT catalogs"
```

---

### Task 6: Tournament-Scoped Winner Board Repository

**Files:**

- Create: `src/lib/server/winner-boards/repository.js`
- Create: `src/lib/server/winner-boards/repository.test.js`

**Interfaces:**

- Produces `saveDraftWinnerBoard(db, input)`.
- Produces `publishWinnerBoard(db, boardId)`, `hidePublishedBoard(db)`, `getPublishedWinnerBoard(db)`, and `getGraphicVersion(db)`.
- Produces the `WinnerBoardView` contract consumed by admin preview and `/gfx`.

- [ ] **Step 1: Create complete in-memory libSQL test schema**

Use `@libsql/client` with `url: ':memory:'` and create every column referenced by the Drizzle tables. Do not hand-create partial tables that omit timestamps.

- [ ] **Step 2: Write failing scope and ordering tests**

Assert the exact repository errors `Winner must belong to tournament roster`, `Champion does not belong to active catalog`, and `Augment does not belong to active catalog`. Also assert returned champion rows preserve submitted star levels/order and that replacing a draft leaves one board with exactly the replacement child rows.

- [ ] **Step 3: Implement transactional draft save**

Input is:

```js
{
	boardId: string | null,
	tournamentId: string,
	winnerPlayerId: string,
	title: string,
	champions: Array<{ catalogChampionId: string, starLevel: number | null }>,
	augmentIds: string[]
}
```

Validate tournament, roster membership, active snapshot, nonempty champions, unique IDs, star levels `1..3`, and catalog ownership before writing. Insert or replace the draft and all child rows in one transaction. Never update a board whose status is `published`.

- [ ] **Step 4: Write publish/hide/version tests**

Assert that publish hides the old live board, publishes the selected draft, points `graphicState.publishedWinnerBoardId` at it, and increments `version` once. Failed publish leaves old board and version unchanged. Hide clears the pointer, hides the board, and increments once. Repeated hide with nothing live is idempotent and does not increment.

- [ ] **Step 5: Implement publish and hide transactions**

Use `graphicState` as the source of truth. Create `{ id: 'live', version: 0 }` lazily with `onConflictDoNothing`. Do not infer the live board by selecting an arbitrary `status = 'published'` row.

- [ ] **Step 6: Implement published view and version reads**

`getPublishedWinnerBoard` follows the singleton pointer and returns:

```js
{
	id, title, tournamentId, publishedAt,
	winner: { id, displayName, riotId, imagePath },
	champions: [{ id, displayName, iconPath, starLevel, displayOrder }],
	augments: [{ id, displayName, iconPath, displayOrder }]
}
```

Children are ordered by `displayOrder`. `getGraphicVersion` returns the singleton version or `0`.

- [ ] **Step 7: Verify and commit**

Run focused tests, server tests, and `pnpm check`. Expected: PASS.

```powershell
git add src/lib/server/winner-boards
git commit -m "feat: enforce scoped winner publishing"
```

---

### Task 7: Authenticated Admin Data And Actions

**Files:**

- Create: `src/lib/server/tournaments/repository.js`
- Create: `src/lib/server/tournaments/repository.test.js`
- Create: `src/lib/server/players/repository.js`
- Create: `src/routes/admin/+page.server.js`
- Create: `src/routes/admin/admin-actions.test.js`

**Interfaces:**

- Page load accepts `?tournament=<id>` and returns selected tournament, ordered roster, active-snapshot assets, drafts, live board, and import preview state.
- Actions: `createTournament`, `createPlayer`, `previewBundle`, `commitBundle`, `addRosterPlayers`, `removeRosterPlayer`, `moveRosterPlayer`, `syncCatalog`, `saveBoard`, `publishBoard`, `hideBoard`, `logout`.

- [ ] **Step 1: Implement and test roster repository**

Batch add uses one transaction and ignores existing composite-key rows. Remove and move operations require the selected tournament. Moving rewrites contiguous `displayOrder` values transactionally.

`players/repository.js` implements manual player creation with required full/display names, optional normalized Riot ID, and the same `riotIdKey` uniqueness rules as ZIP import.

- [ ] **Step 2: Write action authorization tests**

Call each action with anonymous locals and assert redirect/rejection before any write. Put a shared `requireAdmin(event)` call at the start of every action even though the layout is guarded; actions must be safe when invoked directly.

- [ ] **Step 3: Implement scoped page loading**

Choose the query-string tournament only if it exists; otherwise select the first tournament. Load players for roster selection separately from the ordered selected roster. Load champions/augments only where `catalogSnapshotId === selectedTournament.activeCatalogSnapshotId`. Load only drafts for the selected tournament.

- [ ] **Step 4: Implement validated actions**

Every expected validation/network error returns `fail(400|409|422, { action, message, ...safeData })`. No action returns raw stack traces. `previewBundle` accepts only a `File` named `.zip`, enforces 25 MiB before reading, and returns `{ action: 'previewBundle', token, preview }`. `commitBundle` accepts the token only.

- [ ] **Step 5: Implement logout**

Call `auth.api.signOut({ headers: request.headers })`, then redirect to `/login`.

- [ ] **Step 6: Verify and commit**

Run route/action tests, server tests, and `pnpm check`. Expected: PASS.

```powershell
git add src/lib/server/tournaments src/routes/admin/+page.server.js src/routes/admin/admin-actions.test.js
git commit -m "feat: wire authenticated admin actions"
```

---

### Task 8: Operator UI And Exact Graphic Preview

**Files:**

- Modify: `src/lib/layouts/AdminLayout.svelte`
- Modify: `src/routes/admin/+page.svelte`
- Create: `src/lib/components/admin/TournamentControls.svelte`
- Create: `src/lib/components/admin/PlayerImportPanel.svelte`
- Create: `src/lib/components/admin/RosterManager.svelte`
- Create: `src/lib/components/admin/WinnerBoardComposer.svelte`
- Create: `src/lib/components/admin/LiveControls.svelte`
- Create: `src/lib/components/admin/admin-components.svelte.test.js`
- Create: `src/lib/components/WinnerBoardGraphic.svelte`

**Interfaces:**

- Components receive scoped page data and submit named form actions.
- Composer posts structured champion IDs and matching `starLevel:<championId>` fields.
- Saved `form.boardId` selects the draft automatically; no manual ID field exists.

- [ ] **Step 1: Build the shared fixed-canvas renderer**

Render optional player image, winner identity, ordered champions with nullable stars, and optional augments. Constrain long names with explicit max widths/overflow behavior. All remote catalog images come from normalized HTTPS paths; player images use `/media/player-images/<id>` only.

- [ ] **Step 2: Build tournament and catalog controls**

Changing tournament navigates to `/admin?tournament=<id>`. Empty states disable dependent controls. Catalog status shows active source/patch/locale and nonfatal fallback warnings.

- [ ] **Step 3: Build ZIP preview/confirm UI**

Use a labeled `<input type="file" accept=".zip,application/zip">`. Preview displays row actions, errors, image matches, and unmatched images. Confirm posts the opaque token and is disabled when preview contains errors or is expired.

- [ ] **Step 4: Build searchable ordered roster management**

Provide a manual-player form, client-side search/filter over reusable players, batch checkbox add, per-row remove, and up/down reorder buttons. Winner choices come only from `data.roster`.

- [ ] **Step 5: Build scoped board composer and live controls**

Champion and augment choices come only from the active snapshot arrays. Each selected champion exposes a 1/2/3-star select. The same `WinnerBoardGraphic` renders the selected draft preview at a scaled 16:9 size. Save exposes/updates the returned draft ID; publish uses that selected ID directly.

- [ ] **Step 6: Run the Svelte autofixer**

Run `svelte_autofixer` on every new/modified `.svelte` file, apply all issues and suggestions, and rerun until each file reports none.

- [ ] **Step 7: Verify and commit**

Run browser Vitest tests, `pnpm check`, and `pnpm lint`. Expected: PASS.

```powershell
git add src/lib/layouts/AdminLayout.svelte src/routes/admin/+page.svelte src/lib/components
git commit -m "feat: add operator control surface"
```

---

### Task 9: Controlled Media, Broadcast Route, And ETag Polling

**Files:**

- Create: `src/routes/media/player-images/[playerId]/+server.js`
- Modify: `src/lib/layouts/GraphicsLayout.svelte`
- Create: `src/routes/gfx/+page.server.js`
- Create: `src/routes/gfx/+page.svelte`
- Create: `src/routes/gfx/version/+server.js`
- Create: `src/routes/gfx/version/version.test.js`

**Interfaces:**

- Media route looks up player by ID and serves only a contained managed file.
- Version route returns current numeric version with `ETag: "gfx-<version>"`.
- `/gfx` invalidates page data only when version changes.

- [ ] **Step 1: Implement and test the media route**

Use the managed-path resolver from Task 4. Missing DB row, missing path, or missing file returns 404; unsupported detected content returns 415. Set `X-Content-Type-Options: nosniff` and `Cache-Control: private, max-age=60`.

- [ ] **Step 2: Implement version endpoint tests**

Assert a normal request returns body `{ version }`, quoted ETag, and `Cache-Control: no-store`. A matching `If-None-Match` returns 304 with no body. A changed version returns 200.

- [ ] **Step 3: Implement `/gfx` loader and canvas**

The server loader returns `{ board, version }`. `GraphicsLayout.svelte` removes body margin/scrollbars and fixes a transparent 1920x1080 canvas. Empty live state renders transparent 1920x1080 markup.

- [ ] **Step 4: Implement one-second client polling**

On mount, poll `/gfx/version` with the last ETag. On 304 do nothing. On 200, update the ETag and call `invalidateAll()`. Ensure only one request is in flight, stop polling on destroy, and use a 1000 ms interval. Network errors leave the current graphic rendered and retry on the next tick.

- [ ] **Step 5: Run the Svelte autofixer and verify**

Run autofixer until clean, then server tests, browser tests, `pnpm check`, and `pnpm lint`. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/routes/media src/routes/gfx src/lib/layouts/GraphicsLayout.svelte
git commit -m "feat: serve live published graphics"
```

---

### Task 10: End-To-End Workflow, Documentation, And Final Verification

**Files:**

- Create: `tests/manual-winner-graphics.test.js`
- Modify: `.gitignore`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/TODO.md`

**Interfaces:**

- Produces a repeatable local/VLAN runbook and verified operator workflow.

- [ ] **Step 1: Add Playwright coverage**

Cover first-user setup, anonymous admin redirect, login, tournament creation, ZIP preview/confirm, roster add/reorder, catalog selection using a deterministic seeded snapshot, draft preview, publish, version change, `/gfx` rendering, hide, and transparent empty state.

- [ ] **Step 2: Document environment and deployment**

Add:

```env
DATABASE_URL=file:local.db
MEDIA_ROOT=media
ORIGIN=http://127.0.0.1:5173
BETTER_AUTH_SECRET=
RIOT_API_KEY=
```

Add `/media/` to `.gitignore` so staged ZIPs and managed player images cannot be committed.

Document binding the dev/production server to the intended VLAN interface, firewalling it to the trusted network, visiting `/setup` once, and using the server's LAN URL for `/admin` and `/gfx`. State that `RIOT_API_KEY` is unused by the MVP.

- [ ] **Step 3: Update TODO only after verification**

Mark schema/services, admin control surface, and `/gfx` broadcast surface complete only after every command and manual check below passes.

- [ ] **Step 4: Run automated verification**

```powershell
pnpm exec vitest run
pnpm check
pnpm lint
$env:DATABASE_URL='file:local.db'; pnpm db:push
pnpm test:e2e
```

Expected: all commands PASS and Drizzle applies the full combined schema.

- [ ] **Step 5: Run manual multi-client validation**

Start the app on a VLAN-accessible interface. Use one machine for `/admin` and a second for `/gfx`. Publish and hide without refreshing `/gfx`; confirm each update appears within roughly two seconds. Confirm anonymous `/admin` redirects, `/setup` is disabled after first user, draft edits do not change live output, and failed catalog sync preserves the pinned snapshot.

- [ ] **Step 6: Commit**

```powershell
git add tests/manual-winner-graphics.test.js .gitignore README.md .env.example docs/TODO.md
git commit -m "docs: verify manual graphics workflow"
```

---

## Execution Checkpoints

- After Tasks 1-2: baseline, schema, setup/login, and admin guard are independently usable.
- After Tasks 3-4: ZIP preview/confirm is safe and independently testable.
- After Task 5: catalog sync cannot replace a usable pinned snapshot on failure.
- After Tasks 6-7: server-side scope and live-state invariants are complete before UI wiring.
- After Tasks 8-9: admin preview and VLAN broadcast output share one renderer and live-update contract.
- Task 10 is the release gate; do not mark TODO items complete before it passes.
