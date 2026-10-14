# Cloudflare deployment

The `cloudflare` GitHub branch is the Workers/D1/Durable Objects edition. `main`
keeps the original Netlify/Supabase edition. Use **Workers**, not Pages.

## One-time dashboard setup

1. In Cloudflare, open **Workers & Pages → Create application → Import a repository**
   (or the equivalent Git import option). Connect GitHub as `xfznprojects`, select
   `xfznprojects/Syncwave`, and select the **cloudflare** production branch.
2. Set the Worker name to **syncwave**, root directory to the repository root,
   build command to **npm run build**, and deploy command to **npm run deploy**.
   Use Node **22 or newer** for the build.
3. Add **AUDIUS_API_KEY** and **TENOR_API_KEY** to the **build environment**,
   copying their existing values from Netlify's environment settings.
   Audius's API key and Tenor's key are public browser keys; the Audius API secret
   must never be a public build variable.
4. The build/deployment API token must have **Workers Scripts: Edit** and
   **D1: Edit** for this account. If Cloudflare's generated build token lacks D1
   permissions, edit that token in **My Profile → API Tokens** to add
   **Account → D1 → Edit**, or select a custom build token with these permissions.
5. Deploy. `npm run deploy` builds public assets, creates/reuses D1 if necessary,
   applies pending migrations, and publishes the Worker. Later pushes to
   `cloudflare` redeploy automatically through Cloudflare Workers Builds.
6. In the Worker's **Settings → Variables and Secrets**, add **AUDIUS_API_KEY**
   and **AUDIUS_API_SECRET** as runtime secrets, then save/deploy the changes.
   Use the same Audius API key as in the build environment. Tenor is only needed
   in the build environment. Existing runtime secrets survive future deployments.

The local Cloudflare login is independent of Workers Builds credentials. Do not
copy the local OAuth token into GitHub or Cloudflare build settings.

Only three app variable names are needed:

| Name | Build environment | Worker runtime |
| --- | --- | --- |
| `AUDIUS_API_KEY` | Yes | Secret |
| `TENOR_API_KEY` | Yes, for GIF search | No |
| `AUDIUS_API_SECRET` | No | Secret |

Do not copy `AUDIUS_BEARER_TOKEN`, `ROOM_HOST_HANDLE`, `SUPABASE_URL`, or
`SUPABASE_ANON_KEY`; this edition does not use them.

## Local deployment alternative

After `npm ci` and `npx wrangler login`, put the public keys in `.env`:

```dotenv
AUDIUS_API_KEY=your_existing_key
TENOR_API_KEY=your_existing_key
```

Run `npm run deploy`. Add runtime secrets in the Cloudflare dashboard as above,
or run `npx wrangler secret put AUDIUS_API_KEY` and
`npx wrangler secret put AUDIUS_API_SECRET` (interactive prompts).

`npm run db:setup` only prepares D1 and applies migrations; it does not publish
the site. `npm run check:deploy` validates packaging without publishing.

## Verify the new URL

Open `/api/health` on the Worker URL; it must return `{"ok":true}`. Test the
`140` room, Audius login, playback, chat and synchronization in two browsers.
Allow the new origin in the Audius developer-app configuration if required.
Keep Netlify running until these checks pass. Existing live Supabase data is not
copied automatically; only the included demo data is seeded.

References: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
and https://developers.cloudflare.com/workers/configuration/secrets/
