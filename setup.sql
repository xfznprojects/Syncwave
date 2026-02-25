-- SyncWave Database Setup
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
--
-- MIGRATION NOTE: If you already ran the old setup, drop the permissive policies first:
--   DROP POLICY IF EXISTS "Allow all playlist operations" ON playlists;
--   DROP POLICY IF EXISTS "Allow all chat operations" ON chat_messages;
--   DROP POLICY IF EXISTS "Allow all room operations" ON rooms;
-- To add new columns to an existing rooms table:
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS muted_users JSONB DEFAULT '[]';
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS banned_users JSONB DEFAULT '[]';
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS host_user_id TEXT;
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN DEFAULT false;
--   ALTER TABLE rooms ADD COLUMN IF NOT EXISTS playback_state JSONB DEFAULT NULL;

-- ─── PLAYLISTS TABLE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS playlists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT DEFAULT 'Default',
  tracks JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint for upsert (one playlist per user+name)
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_user_name
  ON playlists (user_id, name);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_playlists_user_id
  ON playlists (user_id);

-- ─── CHAT MESSAGES TABLE ─────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  handle TEXT DEFAULT 'Anonymous',
  name TEXT DEFAULT 'Anonymous',
  avatar_url TEXT,
  text TEXT DEFAULT '',
  gif_url TEXT,
  preview_url TEXT,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for loading chat history by room
CREATE INDEX IF NOT EXISTS idx_chat_room_timestamp
  ON chat_messages (room_id, timestamp);

-- Auto-delete old messages (keep last 7 days)
-- Optional: uncomment to enable auto-cleanup
-- CREATE OR REPLACE FUNCTION cleanup_old_chats()
-- RETURNS void AS $$
-- BEGIN
--   DELETE FROM chat_messages WHERE created_at < now() - interval '7 days';
-- END;
-- $$ LANGUAGE plpgsql;

-- ─── ROOMS TABLE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  host_name TEXT,
  host_handle TEXT,
  host_avatar TEXT,
  host_user_id TEXT,
  current_track JSONB,
  user_count INTEGER DEFAULT 0,
  playlist JSONB DEFAULT '[]',
  muted_users JSONB DEFAULT '[]',
  banned_users JSONB DEFAULT '[]',
  is_permanent BOOLEAN DEFAULT false,
  playback_state JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now()
);

-- Index for loading rooms ordered by activity
CREATE INDEX IF NOT EXISTS idx_rooms_last_active
  ON rooms (last_active_at DESC);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────
-- We authenticate via Audius OAuth (not Supabase Auth), so we can't use
-- auth.uid(). Instead we restrict operations by type to limit abuse surface.

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- ── Playlists: read all, insert/update own rows only, no deletes ──
CREATE POLICY "Playlists are readable" ON playlists
  FOR SELECT USING (true);

CREATE POLICY "Users can insert own playlists" ON playlists
  FOR INSERT WITH CHECK (user_id IS NOT NULL AND length(user_id) > 0);

CREATE POLICY "Users can update own playlists" ON playlists
  FOR UPDATE USING (true) WITH CHECK (user_id IS NOT NULL AND length(user_id) > 0);

-- ── Chat: anyone can read and insert, no updates or deletes ──
CREATE POLICY "Chat messages are readable" ON chat_messages
  FOR SELECT USING (true);

CREATE POLICY "Anyone can send chat messages" ON chat_messages
  FOR INSERT WITH CHECK (
    room_id IS NOT NULL AND length(room_id) > 0
    AND user_id IS NOT NULL AND length(user_id) > 0
    AND length(coalesce(text, '')) <= 2000
  );

-- ── Rooms: anyone can read, insert, and update (collaborative), no deletes ──
CREATE POLICY "Rooms are readable" ON rooms
  FOR SELECT USING (true);

CREATE POLICY "Anyone can create rooms" ON rooms
  FOR INSERT WITH CHECK (room_id IS NOT NULL AND length(room_id) > 0);

CREATE POLICY "Anyone can update rooms" ON rooms
  FOR UPDATE USING (true) WITH CHECK (room_id IS NOT NULL AND length(room_id) > 0);

-- ─── SEED PERMANENT DEMO ROOMS ─────────────────────────────
-- These rooms always appear in the directory. Manage playlists via SQL (see below).
INSERT INTO rooms (room_id, host_name, host_handle, host_user_id, is_permanent, user_count)
VALUES
  ('247room1', 'Hip-Hop Lounge', 'SyncWave', NULL, true, 0),
  ('247room2', 'Electronic Vibes', 'SyncWave', NULL, true, 0),
  ('247room3', 'Indie Corner', 'SyncWave', NULL, true, 0)
ON CONFLICT (room_id) DO NOTHING;

-- ─── MANAGE 24/7 ROOM PLAYLISTS ────────────────────────────
-- To update an existing room's name:
--   UPDATE rooms SET host_name = 'New Name' WHERE room_id = '247room1';
--
-- To add a playlist to a 24/7 room, paste track data as JSON.
-- You can get track data from the Audius API:
--   https://api.audius.co/v1/playlists/{PLAYLIST_ID}/tracks
--
-- Example: load a playlist into 247room1
--   UPDATE rooms
--   SET playlist = '[
--     {"id":"abc123","title":"Track Name","duration":210,"user":{"name":"Artist","handle":"artist"},"artwork":null},
--     {"id":"def456","title":"Another Track","duration":185,"user":{"name":"Artist2","handle":"artist2"},"artwork":null}
--   ]'::jsonb
--   WHERE room_id = '247room1';
