CREATE TABLE playlists (
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Default',
  tracks TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, name)
);
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,
  host_name TEXT, host_handle TEXT, host_avatar TEXT, host_user_id TEXT,
  current_track TEXT,
  user_count INTEGER NOT NULL DEFAULT 0,
  playlist TEXT NOT NULL DEFAULT '[]',
  muted_users TEXT NOT NULL DEFAULT '[]', banned_users TEXT NOT NULL DEFAULT '[]',
  is_permanent INTEGER NOT NULL DEFAULT 0,
  playback_state TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_active_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX rooms_activity ON rooms(last_active_at DESC);
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL, user_id TEXT NOT NULL,
  handle TEXT, name TEXT, avatar_url TEXT,
  text TEXT NOT NULL DEFAULT '' CHECK(length(text) <= 2000),
  gif_url TEXT, preview_url TEXT, timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX chat_room_timestamp ON chat_messages(room_id,timestamp DESC,id DESC);
CREATE INDEX chat_created ON chat_messages(created_at);
INSERT INTO rooms(room_id,host_name,host_handle,is_permanent) VALUES
 ('247room1','Hip-Hop Lounge','SyncWave',1),
 ('247room2','Electronic Vibes','SyncWave',1),
 ('247room3','Indie Corner','SyncWave',1);
