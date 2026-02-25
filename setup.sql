-- SyncWave Database Setup
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

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
  current_track JSONB,
  user_count INTEGER DEFAULT 0,
  playlist JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now()
);

-- Index for loading rooms ordered by activity
CREATE INDEX IF NOT EXISTS idx_rooms_last_active
  ON rooms (last_active_at DESC);

-- ─── ROW LEVEL SECURITY ──────────────────────────────────
-- Using permissive policies since we authenticate via Audius OAuth,
-- not Supabase Auth. All operations go through the anon key.

ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- Allow all operations for playlists
CREATE POLICY "Allow all playlist operations" ON playlists
  FOR ALL USING (true) WITH CHECK (true);

-- Allow all operations for chat messages
CREATE POLICY "Allow all chat operations" ON chat_messages
  FOR ALL USING (true) WITH CHECK (true);

-- Allow all operations for rooms
CREATE POLICY "Allow all room operations" ON rooms
  FOR ALL USING (true) WITH CHECK (true);
