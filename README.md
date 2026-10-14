# SyncWave on Cloudflare

This is the `cloudflare` edition. GitHub's `main` branch retains the original
Netlify/Supabase edition. For the fewest manual steps, follow
[Cloudflare deployment](docs/cloudflare-deployment.md): connect this branch to
Workers Builds and use `npm run deploy`. The deployment command automatically
applies D1 migrations before publishing. The database is already provisioned in
the configured Cloudflare account.

SyncWave's Audius music, login, player and visualizers are preserved. Cloudflare
Workers serves the website and the Audius action proxy, D1 stores room data,
playlists and chat, and SQLite-backed Durable Objects handle live room connections.
There is no Supabase or Netlify runtime dependency.

## Run locally

Use Node.js 22 or newer (tested with Node 24).

```sh
npm ci
```

Copy `.env.example` to `.env` and fill in your existing public Audius and Tenor keys.
Copy `.dev.vars.example` to `.dev.vars` and fill in the existing Audius API key and
secret. `.env` is for the frontend build; `.dev.vars` supplies the Worker runtime.
The secret is never included in the public build.

```sh
npm run db:local
npm run dev
```

Open the localhost URL printed by Wrangler. Hash-based room links continue to work.
Four permanent demo rooms are seeded, including the existing `140` playlist.
The other three rooms start empty, as in the original setup.

## Deploy on Cloudflare's free plan

1. Sign in and prepare the database (safe to repeat):

   ```sh
   npx wrangler login
   npm run db:setup
   ```

   The configured database ID is ready for this account. For a different account,
   update `account_id` and remove `database_id`; `db:setup` then creates or reuses
   the database and writes its ID automatically.

2. Apply the migrations to the new database:

   ```sh
   npm run db:remote
   ```

3. Set the same existing Audius credentials on the Worker. Enter each value at the
   interactive prompt; do not put secrets in command arguments or source control.

   ```sh
   npx wrangler secret put AUDIUS_API_KEY
   npx wrangler secret put AUDIUS_BEARER_TOKEN
   ```

   Wrangler may prompt to create the Worker when storing its first secret.
   Keep `.env` populated for the public frontend key and Tenor key when building.

4. Validate and deploy:

   ```sh
   npm test
   npm run check:deploy
   npm run deploy
   ```

   Use the `workers.dev` URL printed by Wrangler, or attach a custom domain in the
   Cloudflare dashboard. Ensure the new site origin is permitted by your existing
   Audius developer-app configuration if it restricts origins.

For Git-connected Cloudflare Workers builds, set the build command to
`npm run build` and deploy command to `npm run deploy`. Configure the public
`AUDIUS_API_KEY` and `TENOR_API_KEY` in the build environment, and the Audius API key
and bearer token separately in the Worker's runtime secrets. The deploy command applies
pending D1 migrations automatically before publishing.

## Moving existing data and CV links

The included migrations create a fresh database and the demo playlist from the
repository; they do not copy the live Supabase database. To retain additional room
playlists or history, export those tables before retiring Supabase. The original
`setup.sql` and `seed-140-room.sql` are retained as historical source files, not
Cloudflare setup instructions. Do not run PostgreSQL `setup.sql` against D1.

Keep the existing Netlify deployment until the new URL passes the checks below.
If your CV uses the Netlify URL, replace that deployment with a small redirect page
which uses `location.replace('https://YOUR-WORKER.workers.dev/' + location.hash)`.
Netlify server redirects cannot see the hash-based room route, so preserve it in
the browser. Then update future CV copies to use the new URL.

## Verify before switching the CV link

- Check `/api/health` returns `{ "ok": true }` (also verifies that tables exist).
- Open the `140` room as a logged-out visitor and start music using the play button.
- Log in with Audius and create a room; open it in another browser and check playback
  position, queue updates, chat/GIFs, listener counts and song requests.
- Disconnect/reconnect the listener's network and check it rejoins and resynchronizes.
- Reload and verify saved playlists and chat history remain available.
- Test favorite/repost/follow with your own Audius account. Those endpoints and
  credentials are unchanged; the old `/.netlify/functions/audius-action` path is
  handled by the Worker for compatibility with the unchanged Audius client module.

`npm test` exercises D1 SQL in Cloudflare's local runtime and separate WebSocket
clients, including validation, room isolation, heartbeat and rejoining. It also
checks repeatable builds and that secrets are excluded. It does not log in to a
real Audius account or play audio in a real browser.

## Availability and operations

The player initializes independently of the lobby. Live connections use bounded
exponential reconnect delays, restore presence and request fresh host state.
Failed database writes are reported; playlists and chat have local fallback copies.
A visible status banner replaces silent failures, with a retry button for database
reads. Stale room counts expire from database discovery after two minutes, and chat history is retained without automatic age-based deletion.

Static files are built into `dist/` from an explicit allowlist. Only that directory
is uploaded, so `.env`, `.dev.vars`, SQL and Worker source cannot be served as assets.
The database API accepts fixed operations and bound parameters, with same-origin
checks and per-IP request throttling. Room messages have size/rate limits and
host-only playback/moderation events.

The Worker verifies Audius ID tokens using Audius's /users/verify_token endpoint
and checks the token's app key and expiration. Playlist reads/writes and persisted
chat require login. Room writes and host commands require the verified owner;
new room IDs must match that user's Audius handle. Guests can listen and join live
chat with server-assigned guest identities. Guest chat is not persisted.
Permanent rooms without an assigned host_user_id remain read-only; assign their
owner through an administrator-controlled migration if editing is needed.
Existing unowned rooms also require an administrator-controlled ownership migration.
WebSocket identities are verified on connection and expire after at most one hour;
reconnections verify the token again. No credentials are placed in WebSocket URLs.
HTML interpolation escapes quotes as well as markup characters.

Use `npx wrangler tail` for failures and Cloudflare's dashboard for usage. Free plans
have usage limits and can reject requests when those limits are reached. Always-on
music rooms calculate playback from timestamps in the browser; they do not require
an always-running backend timer. No new hosting removes the need to handle outages.

Official references: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
