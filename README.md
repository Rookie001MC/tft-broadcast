# HCMUSEC TFT Winner Graphic

An internal, manual-first broadcast tool for VNUHCM — University of Science Esports Club. Operators prepare a tournament-scoped winner board in `/admin`, review the exact 1920×1080 output, and deliberately publish or hide the public `/gfx` browser source used by OBS or vMix.

The MVP does not query Riot match history. It uses pinned CommunityDragon or Data Dragon static catalogs, reusable local player records, and controlled local player images. `RIOT_API_KEY` is reserved for later experiments and is currently unused.

## What is included

- One-time first-operator setup, email/password login, and authenticated admin actions.
- Tournament creation, maintainable reusable players, terminal ZIP import preview/confirm, and ordered rosters.
- Fail-safe TFT catalog synchronization with locale/source fallback, pinned snapshots, and scoped manual corrections.
- Tournament- and catalog-scoped saved winner boards with ordered champions, optional star levels, and optional augments.
- An exact shared admin preview and public 1920×1080 `/gfx` renderer.
- Transactional publish/hide state with one-second ETag polling for already-open broadcast clients.
- Controlled local player and immutable catalog media delivery; arbitrary filesystem paths are not exposed.

## Local setup

Requirements: Node.js 20.6 or newer and pnpm.

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate
pnpm dev
```

Set `BETTER_AUTH_SECRET` in `.env` to a high-entropy value of at least 32 characters before starting. Visit `http://127.0.0.1:5173/setup` once to create the operator. Subsequent setup requests are redirected to login.

The default environment is:

```env
DATABASE_URL=file:local.db
MEDIA_ROOT=media
ORIGIN=http://127.0.0.1:5173
BETTER_AUTH_SECRET=
RIOT_API_KEY=
CATALOG_MAX_ARCHIVE_GIB=4
CATALOG_MAX_EXTRACTED_GIB=16
```

## Trusted LAN/VLAN deployment

This app is intended for a trusted production network, not the public internet.

1. Choose the server's stable LAN address, for example `192.168.50.10`, and set `ORIGIN=http://192.168.50.10:3000` in `.env`.
2. Build the standalone Node server with `pnpm build`.
3. Bind it to the intended interface:

```powershell
$env:HOST='0.0.0.0'
$env:PORT='3000'
node --env-file=.env build
```

4. Restrict the host firewall rule for TCP port 3000 to the trusted production VLAN/subnet. Do not expose the port through public router forwarding.
5. From an operator machine, open `http://192.168.50.10:3000/admin`. Configure OBS/vMix on the broadcast machine with `http://192.168.50.10:3000/gfx` at 1920×1080.

If a trusted reverse proxy terminates HTTPS, configure its forwarded headers and SvelteKit's trusted proxy environment deliberately. Do not accept spoofable forwarded headers directly from untrusted clients.

Catalog synchronization streams newline-delimited progress from `/admin/game-resources/sync`. Disable proxy buffering for this route (for example, with the included `X-Accel-Buffering: no` response header in nginx-compatible proxies). The in-process per-tournament sync lock assumes this standalone Node app runs as a single instance. `MEDIA_ROOT` must have enough free space for the compressed Data Dragon package, its temporary extraction, and retained immutable snapshots; interrupted staging directories older than 24 hours are removed on the next sync. Downloads default to a 4 GiB compressed limit (`CATALOG_MAX_ARCHIVE_GIB`) and a 16 GiB extracted limit (`CATALOG_MAX_EXTRACTED_GIB`); both accept positive GiB overrides. Individual archive entries remain capped at 512 MiB and installed catalog images at 10 MiB.

## Operator workflow

1. Select or create a tournament. Tournament names/slugs and reusable player identities remain maintainable.
2. Sync/pin its static TFT catalog. Operators can add image-optional manual resources, override upstream details, and hide or restore resources; corrections retain their catalog scope and provenance.
3. Create or ZIP-import players, then add and order the tournament roster. Import confirmation commits the exact preview once; the committed terminal summary remains visible after reload and cannot be confirmed again. Player images can be safely replaced or removed later.
4. Pick the winner, champions/star levels, and optional augments, then inspect the exact preview.
5. **Save is the deliberate gate.** Local changes can update the preview, but Live-on remains unavailable until they are saved. Saving while hidden replaces the single saved board without publishing it.
6. Switch Live on to publish the saved data. Already-open broadcast clients update within roughly two seconds. Saving again while live creates and activates a new immutable publication; older publications are not rewritten by later player or catalog maintenance.
7. Switch Live off to return `/gfx` to a transparent canvas without discarding the saved board.
8. Reset deliberately clears the saved board and hides the graphic when necessary. Tournament changes and destructive player, tournament, or catalog operations can require an explicit Reset confirmation when the saved board depends on the target.

## Verification

```powershell
pnpm exec vitest run
pnpm check
pnpm lint
$env:DATABASE_URL='file:local.db'; pnpm db:push
pnpm test:e2e
```

The Playwright workflow uses an isolated `test-e2e.db`, isolated `media/e2e` assets, and one test-only operator. It seeds deterministic catalog assets and runs separate admin and broadcast pages to verify the full maintenance, Save/Live/Reset, immutable-publication, and publish/hide polling workflow without a `/gfx` refresh.

## Stack

- Svelte 5 and SvelteKit
- libSQL/SQLite with Drizzle ORM
- Better Auth
- Tailwind CSS and Skeleton UI
- Vitest and Playwright
