-- Run once in Supabase's SQL editor BEFORE deploying the updated main branch.
-- Existing room owners are preserved. Assign unowned rooms manually as an admin.
BEGIN;

-- Remove every old policy: permissive policies are ORed together by PostgreSQL.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE (schemaname = 'public' AND tablename IN ('playlists','rooms','chat_messages'))
       OR (schemaname = 'realtime' AND tablename = 'messages') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.playlists, public.rooms, public.chat_messages FROM anon, authenticated;
GRANT SELECT ON public.rooms, public.chat_messages TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.playlists TO authenticated;
GRANT INSERT, UPDATE ON public.rooms TO authenticated;
GRANT INSERT ON public.chat_messages TO authenticated;
CREATE POLICY "public room reads" ON public.rooms FOR SELECT USING (true);
CREATE POLICY "public chat reads" ON public.chat_messages FOR SELECT USING (true);
CREATE POLICY "own playlist reads" ON public.playlists FOR SELECT TO authenticated
  USING (user_id = auth.jwt()->>'audius_user_id');
CREATE POLICY "own playlist inserts" ON public.playlists FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'audius_user_id');
CREATE POLICY "own playlist updates" ON public.playlists FOR UPDATE TO authenticated
  USING (user_id = auth.jwt()->>'audius_user_id') WITH CHECK (user_id = auth.jwt()->>'audius_user_id');
CREATE POLICY "own room inserts" ON public.rooms FOR INSERT TO authenticated
  WITH CHECK (host_user_id = auth.jwt()->>'audius_user_id' AND room_id = auth.jwt()->>'audius_handle'
    AND host_handle = auth.jwt()->>'audius_handle' AND NOT is_permanent);
CREATE POLICY "own room updates" ON public.rooms FOR UPDATE TO authenticated
  USING (host_user_id = auth.jwt()->>'audius_user_id')
  WITH CHECK (host_user_id = auth.jwt()->>'audius_user_id' AND host_handle = auth.jwt()->>'audius_handle');
CREATE POLICY "verified chat authors" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'audius_user_id' AND handle = auth.jwt()->>'audius_handle'
    AND name = auth.jwt()->>'audius_name' AND length(coalesce(text,'')) <= 2000);

CREATE OR REPLACE FUNCTION public.syncwave_preserve_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN
  IF current_user IN ('anon', 'authenticated') AND
    (NEW.host_user_id IS DISTINCT FROM OLD.host_user_id OR NEW.is_permanent IS DISTINCT FROM OLD.is_permanent
      OR NEW.room_id IS DISTINCT FROM OLD.room_id OR NEW.host_handle IS DISTINCT FROM OLD.host_handle) THEN
    RAISE EXCEPTION 'Room ownership and permanent status require an administrator';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS syncwave_preserve_owner ON public.rooms;
CREATE TRIGGER syncwave_preserve_owner BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.syncwave_preserve_owner();

CREATE TABLE IF NOT EXISTS public.room_presence (
  room_id text NOT NULL, session_id uuid NOT NULL, profile jsonb NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, session_id)
);
CREATE INDEX IF NOT EXISTS syncwave_presence_activity ON public.room_presence(last_seen);
ALTER TABLE public.room_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_presence FROM anon, authenticated;
GRANT ALL ON public.room_presence TO service_role;

-- Clients may receive private broadcasts, but only the Netlify relay (using the
-- server-only service_role key) can send them. This also prevents forged presence.
REVOKE ALL ON realtime.messages FROM anon, authenticated;
GRANT SELECT ON realtime.messages TO authenticated;
CREATE POLICY "receive private room events" ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast' AND realtime.topic() LIKE 'room:%');
COMMIT;
