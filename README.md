# HCMUSEC TFT Winner Graphic

An internal, manual-first broadcast tool for VNUHCM — University of Science Esports Club. Operators prepare a tournament-scoped winner board in `/admin`, review the exact 1920×1080 output, and deliberately publish or hide the public `/gfx` browser source used by OBS or vMix.

The MVP does not query Riot match history. It uses pinned CommunityDragon or Data Dragon static catalogs, reusable local player records, and controlled local player images. `RIOT_API_KEY` is reserved for later experiments and is currently unused.

## What is included

- One-time first-operator setup, email/password login, and authenticated admin actions.
- Tournament creation, reusable players, safe ZIP import preview/confirm, and ordered rosters.
- Fail-safe TFT catalog synchronization with locale/source fallback and pinned snapshots.
- Tournament- and catalog-scoped winner drafts with ordered champions, optional star levels, and optional augments.
- An exact shared admin preview and public 1920×1080 `/gfx` renderer.
- Transactional publish/hide state with one-second ETag polling for already-open broadcast clients.
- Controlled `/media/player-images/:playerId` delivery; arbitrary file paths and player image URLs are not exposed.

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

## Operator workflow

1. Select or create a tournament.
2. Sync/pin its static TFT catalog.
3. Create or ZIP-import players, then add and order the tournament roster.
4. Pick the winner, champions/star levels, and optional augments.
5. Save the draft and inspect the exact preview. Draft changes do not alter `/gfx`.
6. Publish the selected draft. Open broadcast clients update within roughly two seconds.
7. Hide the graphic to return `/gfx` to a transparent canvas.

## Verification

```powershell
pnpm exec vitest run
pnpm check
pnpm lint
$env:DATABASE_URL='file:local.db'; pnpm db:push
pnpm test:e2e
```

The Playwright workflow uses an isolated `test-e2e.db`, seeds deterministic catalog assets, and runs separate admin and broadcast pages to verify publish/hide polling without a `/gfx` refresh.

## Stack

- Svelte 5 and SvelteKit
- libSQL/SQLite with Drizzle ORM
- Better Auth
- Tailwind CSS and Skeleton UI
- Vitest and Playwright
