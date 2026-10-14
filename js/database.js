import { dataRequest, backendStatus } from './backend.js';

async function request(op, args) {
  try {
    const result = await dataRequest(op, args);
    backendStatus('database', true);
    return result;
  } catch (error) {
    backendStatus('database', false, { status: error.status, message: error.message, operation: op });
    console.warn(`Room service: ${op} failed`, error);
    throw error;
  }
}
function readLocal(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be full */ }
}
// Resolve every pending caller when writes are coalesced.
function debounceSave(delay, save) {
  let timer;
  let waiters = [];
  const flush = async value => {
    clearTimeout(timer);
    const pending = waiters;
    waiters = [];
    const result = await save(value);
    pending.forEach(resolve => resolve(result));
    return result;
  };
  const enqueue = value => new Promise(resolve => {
    waiters.push(resolve);
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(value); }, delay);
  });
  return { enqueue, flush };
}
const playlistSaves = new Map();
export function savePlaylist(userId, tracks) {
  writeLocal('syncwave_playlist', tracks);
  if (!playlistSaves.has(userId)) playlistSaves.set(userId, debounceSave(1000, async tracks => {
    try { return await request('savePlaylist', { userId, tracks }); } catch { return false; }
  }));
  return playlistSaves.get(userId).enqueue(tracks);
}
export async function loadPlaylist(userId) {
  try { return await request('loadPlaylist', { userId }) ?? readLocal('syncwave_playlist'); }
  catch { return readLocal('syncwave_playlist'); }
}
const roomSaves = new Map();
function saver(roomId) {
  if (!roomSaves.has(roomId)) roomSaves.set(roomId, debounceSave(2000, async room => {
    try { return await request('saveRoom', { room }); } catch { return false; }
  }));
  return roomSaves.get(roomId);
}
export function saveRoom(room) { return saver(room.roomId).enqueue(room); }
export function saveRoomImmediate(room) { return saver(room.roomId).flush(room); }
export async function updateRoomUserCount(roomId, userCount) {
  try { return await request('updateRoomUserCount', { roomId, userCount }); } catch { return false; }
}
export async function updateRoomCurrentTrack(roomId, currentTrack) {
  try { return await request('updateRoomCurrentTrack', { roomId, currentTrack }); } catch { return false; }
}
function mapRoom(r) {
  return {
    roomId: r.room_id, hostName: r.host_name, hostHandle: r.host_handle,
    hostAvatar: r.host_avatar, hostUserId: r.host_user_id, currentTrack: r.current_track,
    userCount: r.user_count, playlist: r.playlist || [], mutedUsers: r.muted_users || [],
    bannedUsers: r.banned_users || [], isPermanent: r.is_permanent,
    playbackState: r.playback_state, lastActiveAt: r.last_active_at, createdAt: r.created_at,
  };
}
async function list(op, limit) {
  try { return (await request(op, { limit })).map(mapRoom); } catch { return []; }
}
export function loadActiveRooms(limit = 20) { return list('loadActiveRooms', limit); }
export function loadPermanentRooms() { return list('loadPermanentRooms'); }
export function loadInactiveRooms(limit = 10) { return list('loadInactiveRooms', limit); }
export async function loadRoom(roomId) {
  try { const row = await request('loadRoom', { roomId }); return row ? mapRoom(row) : null; }
  catch { return null; }
}
export async function loadRoomPlaylist(roomId) { return (await loadRoom(roomId))?.playlist ?? null; }
export async function loadRoomBannedUsers(roomId) { return (await loadRoom(roomId))?.bannedUsers ?? []; }
export async function loadRoomMutedUsers(roomId) { return (await loadRoom(roomId))?.mutedUsers ?? []; }
export async function saveChatMessage(roomId, message) {
  const key = `syncwave_chat_history_${roomId}`;
  writeLocal(key, [...readLocal(key, []), message].slice(-50));
  try { return await request('saveChatMessage', { roomId, message }); } catch { return false; }
}
export async function loadChatHistory(roomId, limit = 50) {
  try { return await request('loadChatHistory', { roomId, limit }); }
  catch { return readLocal(`syncwave_chat_history_${roomId}`, []); }
}
