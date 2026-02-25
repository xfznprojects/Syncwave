import CONFIG from './config.js';

let supabase = null;

function getClient() {
  if (!supabase) {
    supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return supabase;
}

// ─── PLAYLIST PERSISTENCE ─────────────────────────────────

let saveTimeout = null;

export async function savePlaylist(userId, tracks) {
  // Debounce: wait 1 second after last call
  clearTimeout(saveTimeout);
  return new Promise((resolve) => {
    saveTimeout = setTimeout(async () => {
      try {
        const client = getClient();
        const { error } = await client
          .from('playlists')
          .upsert({
            user_id: userId,
            name: 'Default',
            tracks: JSON.stringify(tracks),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,name' });

        if (error) throw error;
        resolve(true);
      } catch (e) {
        console.warn('Failed to save playlist to Supabase:', e);
        // Fallback: save to localStorage
        try {
          localStorage.setItem('syncwave_playlist', JSON.stringify(tracks));
        } catch { /* ignore */ }
        resolve(false);
      }
    }, 1000);
  });
}

export async function loadPlaylist(userId) {
  try {
    const client = getClient();
    const { data, error } = await client
      .from('playlists')
      .select('tracks')
      .eq('user_id', userId)
      .eq('name', 'Default')
      .single();

    if (error) throw error;
    if (data?.tracks) {
      const tracks = typeof data.tracks === 'string' ? JSON.parse(data.tracks) : data.tracks;
      return tracks;
    }
  } catch (e) {
    console.warn('Failed to load playlist from Supabase:', e);
    // Fallback: try localStorage
    try {
      const local = localStorage.getItem('syncwave_playlist');
      if (local) return JSON.parse(local);
    } catch { /* ignore */ }
  }
  return null;
}

// ─── CHAT PERSISTENCE ────────────────────────────────────

export async function saveChatMessage(roomId, message) {
  try {
    const client = getClient();
    await client.from('chat_messages').insert({
      room_id: roomId,
      user_id: message.userId || 'anon',
      handle: message.handle || 'Anonymous',
      name: message.name || 'Anonymous',
      avatar_url: message.avatar || null,
      text: message.text || '',
      gif_url: message.gifUrl || null,
      preview_url: message.previewUrl || null,
      timestamp: message.timestamp,
    });
  } catch (e) {
    console.warn('Failed to save chat message:', e);
    // Fallback: localStorage
    try {
      const key = `syncwave_chat_history_${roomId}`;
      let history = JSON.parse(localStorage.getItem(key) || '[]');
      history.push(message);
      if (history.length > 50) history = history.slice(-50);
      localStorage.setItem(key, JSON.stringify(history));
    } catch { /* ignore */ }
  }
}

export async function loadChatHistory(roomId, limit = 50) {
  try {
    const client = getClient();
    const { data, error } = await client
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('timestamp', { ascending: true })
      .limit(limit);

    if (error) throw error;
    if (data && data.length > 0) {
      return data.map(row => ({
        userId: row.user_id,
        handle: row.handle,
        name: row.name,
        avatar: row.avatar_url,
        text: row.text,
        gifUrl: row.gif_url,
        previewUrl: row.preview_url,
        timestamp: row.timestamp,
      }));
    }
  } catch (e) {
    console.warn('Failed to load chat from Supabase:', e);
    // Fallback: localStorage
    try {
      const key = `syncwave_chat_history_${roomId}`;
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch { return []; }
  }
  return [];
}
