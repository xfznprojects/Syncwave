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

// ─── ROOM PERSISTENCE ────────────────────────────────────

let roomSaveTimeout = null;

export async function saveRoom(roomData) {
  // Debounce: wait 2 seconds after last call
  clearTimeout(roomSaveTimeout);
  return new Promise((resolve) => {
    roomSaveTimeout = setTimeout(async () => {
      try {
        const client = getClient();
        const { error } = await client
          .from('rooms')
          .upsert({
            room_id: roomData.roomId,
            host_name: roomData.hostName || null,
            host_handle: roomData.hostHandle || null,
            host_avatar: roomData.hostAvatar || null,
            current_track: roomData.currentTrack || null,
            user_count: roomData.userCount || 0,
            playlist: roomData.playlist ? JSON.stringify(roomData.playlist) : '[]',
            muted_users: roomData.mutedUsers ? JSON.stringify(roomData.mutedUsers) : '[]',
            banned_users: roomData.bannedUsers ? JSON.stringify(roomData.bannedUsers) : '[]',
            last_active_at: new Date().toISOString(),
          }, { onConflict: 'room_id' });

        if (error) throw error;
        resolve(true);
      } catch (e) {
        console.warn('Failed to save room to Supabase:', e);
        resolve(false);
      }
    }, 2000);
  });
}

export async function updateRoomUserCount(roomId, userCount) {
  try {
    const client = getClient();
    await client
      .from('rooms')
      .update({ user_count: userCount, last_active_at: new Date().toISOString() })
      .eq('room_id', roomId);
  } catch (e) {
    console.warn('Failed to update room user count:', e);
  }
}

export async function loadActiveRooms(limit = 20) {
  try {
    const client = getClient();
    const { data, error } = await client
      .from('rooms')
      .select('*')
      .gt('user_count', 0)
      .order('user_count', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map(mapRoomRow);
  } catch (e) {
    console.warn('Failed to load active rooms:', e);
    return [];
  }
}

export async function loadInactiveRooms(limit = 10) {
  try {
    const client = getClient();
    const { data, error } = await client
      .from('rooms')
      .select('*')
      .eq('user_count', 0)
      .order('last_active_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).map(mapRoomRow);
  } catch (e) {
    console.warn('Failed to load inactive rooms:', e);
    return [];
  }
}

export async function loadRoomPlaylist(roomId) {
  try {
    const client = getClient();
    const { data, error } = await client
      .from('rooms')
      .select('playlist')
      .eq('room_id', roomId)
      .single();

    if (error) throw error;
    if (data?.playlist) {
      return typeof data.playlist === 'string' ? JSON.parse(data.playlist) : data.playlist;
    }
  } catch (e) {
    console.warn('Failed to load room playlist:', e);
  }
  return null;
}

export async function loadRoomBannedUsers(roomId) {
  try {
    const client = getClient();
    const { data, error } = await client
      .from('rooms')
      .select('banned_users')
      .eq('room_id', roomId)
      .single();

    if (error) throw error;
    if (data?.banned_users) {
      const arr = typeof data.banned_users === 'string' ? JSON.parse(data.banned_users) : data.banned_users;
      return Array.isArray(arr) ? arr : [];
    }
  } catch (e) {
    console.warn('Failed to load room banned users:', e);
  }
  return [];
}

export async function loadRoomMutedUsers(roomId) {
  try {
    const client = getClient();
    const { data, error } = await client
      .from('rooms')
      .select('muted_users')
      .eq('room_id', roomId)
      .single();

    if (error) throw error;
    if (data?.muted_users) {
      const arr = typeof data.muted_users === 'string' ? JSON.parse(data.muted_users) : data.muted_users;
      return Array.isArray(arr) ? arr : [];
    }
  } catch (e) {
    console.warn('Failed to load room muted users:', e);
  }
  return [];
}

function mapRoomRow(row) {
  return {
    roomId: row.room_id,
    hostName: row.host_name,
    hostHandle: row.host_handle,
    hostAvatar: row.host_avatar,
    currentTrack: row.current_track,
    userCount: row.user_count,
    playlist: row.playlist,
    mutedUsers: row.muted_users,
    bannedUsers: row.banned_users,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
  };
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
