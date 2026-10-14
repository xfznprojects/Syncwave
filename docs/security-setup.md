# Security rollout for the Netlify/Supabase edition

The updated main branch uses verified Audius identity and signed, 15-minute
Supabase sessions. Guests receive a session without an Audius identity; they can
listen and use live chat but cannot persist chat, edit playlists or own rooms.

Before publishing this branch:

1. Run `migrations/0001_security.sql` in your existing Supabase SQL editor. This
   removes the previous permissive policies on this app's three tables and on
   `realtime.messages`, then replaces them with ownership checks and read-only
   private broadcast permissions. If the Supabase project is shared with other
   applications, preserve/recreate their separate realtime policies first.
2. Set `SUPABASE_JWT_SECRET` in Netlify's runtime environment to this project's
   legacy HS256 JWT signing secret. This implementation requires HS256 token
   support; an asymmetric-only project needs a supported signing-key integration.
3. Set `SUPABASE_SERVICE_ROLE_KEY` in Netlify's runtime environment. The realtime
   relay uses this server-only key for private broadcasts and presence records.
   Never put either secret in browser configuration or public build variables.
4. Retain `AUDIUS_API_KEY`, `AUDIUS_API_SECRET`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `TENOR_API_KEY`. Set the public variables in the build
   environment and all server-required values in the Functions environment.
5. In Supabase Realtime settings, turn off **Allow public access**. Updated clients
   listen only on private channels. Database policies prevent direct broadcast
   and presence writes; only the authenticated Netlify relay can send events.
6. Deploy, log in with Audius, and test owner/guest room connections, chat,
   moderation, playlist persistence, logout/login and session renewal.

Unowned existing rooms remain read-only. Assign `host_user_id` and `host_handle`
through the SQL editor after verifying the actual owner. Permanent rooms cannot
be created or have their status changed by a browser. No application update can
repair a live database's policies until the migration is actually applied.

The public build now publishes only `dist/`; secrets, Functions, tests and SQL
are excluded. `setup.sql` creates the schema without permissive policies; always apply the
security migration afterward. Existing deployments must apply the migration to
remove policies installed by older versions.

References: [Audius token verification](https://docs.audius.co/api/),
[Supabase private channel authorization](https://supabase.com/docs/guides/realtime/authorization).
