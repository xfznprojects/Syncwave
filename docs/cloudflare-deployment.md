# Deploy SyncWave on Cloudflare

Public URL: **https://syncwaveproject.pages.dev/**.
The Worker remains `syncwave`; Pages provides a stable free address through an
HTTP service binding. Both addresses use the same D1 database and Durable Objects.
No purchased domain, DNS zone, Supabase project, or Netlify deployment is needed.

## Worker builds

Connect `xfznprojects/Syncwave` to Cloudflare Workers Builds. Use:

| Setting | Value |
| --- | --- |
| Worker name | `syncwave` |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |
| Preview builds | Disabled until separate preview resources are configured |

An existing project that was created against `cloudflare` must switch its
production branch in **Settings → Build → Branch control** after `main` is
promoted. Retrying an older build reuses its original commit; start a new build
from the intended branch instead.

The build API token needs **Workers Scripts: Edit** and **D1: Edit** for this
account. The deployment command automatically applies pending D1 migrations.
The repository contains this deployment's account and database IDs, which are
resource identifiers rather than secrets.

## Required variables

Only these three names are used:

| Name | Build variables | Runtime variables and secrets |
| --- | --- | --- |
| `AUDIUS_API_KEY` | Yes | Secret, same value |
| `AUDIUS_BEARER_TOKEN` | No | Secret |
| `KLIPY_API_KEY` | No | Secret |

Build variables are under **Settings → Builds**. Runtime secrets are under
**Settings → Runtime variables and secrets**. They are separate environments:
the frontend's build key is not automatically available to the Worker.
Store the runtime key as a **Secret** so Wrangler deployments preserve it.

Get the key and backend bearer token from the Audius developer app. Add
`KLIPY_API_KEY` using a key created at https://klipy.com/developers; follow KLIPY's
production-access process. The key stays on the Worker, and changing it does not
require a frontend rebuild. A missing key shows an explicit unavailable message
in the GIF picker instead of pretending there are no search results.

Remove obsolete `TENOR_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`ROOM_HOST_HANDLE` from build settings when convenient. `AUDIUS_API_SECRET` is
only a compatibility fallback for older Audius credentials; the current setup
uses `AUDIUS_BEARER_TOKEN` instead.

## Local deployment

```sh
npm ci
npx wrangler login
```

Put the public Audius key in `.env`. Put development runtime credentials in
`.dev.vars`; these files are excluded from Git. For production, enter values
at the prompts:

```sh
npx wrangler secret put AUDIUS_API_KEY
npx wrangler secret put AUDIUS_BEARER_TOKEN
npx wrangler secret put KLIPY_API_KEY
npm test
npm run check:deploy
npm run deploy
```

For a new account, change `account_id` in `wrangler.jsonc` and remove the existing
`database_id`. `npm run db:setup` creates/reuses D1 and applies migrations without
publishing; `npm run deploy` performs that setup and then deploys.

## Free Pages address

The `syncwaveproject` Pages project is already provisioned. Its configuration is
in `pages/wrangler.jsonc`; `pages/public/_worker.js` forwards original requests to
the `syncwave` Worker through the `SYNCWAVE` service binding. It forwards HTML,
assets, API requests and WebSocket upgrades, preserving the public request origin.
No duplicate app credentials belong in Pages.

```sh
npm run deploy:pages
```

The helper runs from the Pages directory and explicitly selects Pages because
recent Wrangler versions can redirect agent-invoked Pages commands to Workers.
Normal app changes deploy only the Worker; the Pages gateway automatically serves
that version. To reproduce this setup in another account, create the Pages
project in the dashboard first and adjust its name in `pages/wrangler.jsonc`.

If your Audius app restricts allowed origins or redirects, add
**https://syncwaveproject.pages.dev** to its developer settings. Keep the current
Worker origin allowed while migrating existing links.

## Verify

- `/api/health` returns `{"ok":true}` on the Pages address.
- Chillhop Radio opens at `/#/room/247room1` with its saved queue and chat.
- Two browsers receive presence and playback updates over the same room channel.
- Audius login and favorite/repost/follow work with your authorized app.
- KLIPY trending GIFs, search, preview and sending work after the runtime key is set.
- Reloaded queues and chat remain available. Chat has no automatic expiry.

The live curated playlists and imported Supabase chat are database content, not
part of a fresh install's seeds. Keep database backups before replacing data.
The retired 140 room is archived from discovery without deleting its history.

References: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings),
[KLIPY migration](https://klipy.com/migrate).
