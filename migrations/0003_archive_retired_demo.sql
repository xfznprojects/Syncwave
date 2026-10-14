-- Keep the retired room's playlist and chat, but remove it from public discovery.
ALTER TABLE rooms ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
UPDATE rooms SET is_archived = 1, is_permanent = 0 WHERE room_id IN ('247room4', '247room140');
