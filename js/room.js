import { loadActiveRooms } from './database.js';
import { getRealtimeClient } from './realtime.js';

let currentChannel = null;
let currentRoomId = null;
let presenceState = {};
let isHost = false;

// Event callbacks — set by app.js
const listeners = {
  onSync: null,
  onChat: null,
  onTrackChange: null,
  onSongRequest: null,
  onRequestResponse: null,
  onPresenceChange: null,
  onKick: null,
  onBan: null,
};

export function onRoomEvent(event, callback) {
  listeners[event] = callback;
}

function getRealtime() {
  return getRealtimeClient();
}

export function getRoomId() {
  return currentRoomId;
}

export function getIsHost() {
  return isHost;
}

export function getPresence() {
  return presenceState;
}

// Get list of users in the current room
export function getUsers() {
  const users = [];
  for (const [key, presences] of Object.entries(presenceState)) {
    if (presences && presences.length > 0) {
      users.push(presences[0]);
    }
  }
  return users;
}

export async function createRoom(user) {
  currentRoomId = user.handle;
  isHost = true;
  await joinChannel(currentRoomId, user);
  return currentRoomId;
}

export async function joinRoom(roomId, user) {
  currentRoomId = roomId;
  isHost = false;
  await joinChannel(roomId, user);

  // Request current state from host
  currentChannel.send({
    type: 'broadcast',
    event: 'request-state',
    payload: { userId: user.userId },
  });
}

async function joinChannel(roomId, user) {
  const client = getRealtime();

  currentChannel = client.channel(`room:${roomId}`, {
    config: {
      presence: { key: user.userId },
      broadcast: { self: false },
    },
  });

  // Presence tracking
  currentChannel.on('presence', { event: 'sync' }, () => {
    presenceState = currentChannel.presenceState();
    if (listeners.onPresenceChange) {
      listeners.onPresenceChange(getUsers());
    }
  });

  // Broadcast events
  currentChannel.on('broadcast', { event: 'sync' }, ({ payload }) => {
    if (listeners.onSync) listeners.onSync(payload);
  });

  currentChannel.on('broadcast', { event: 'chat' }, ({ payload }) => {
    if (listeners.onChat) listeners.onChat(payload);
  });

  currentChannel.on('broadcast', { event: 'track-change' }, ({ payload }) => {
    if (listeners.onTrackChange) listeners.onTrackChange(payload);
  });

  currentChannel.on('broadcast', { event: 'song-request' }, ({ payload }) => {
    if (listeners.onSongRequest) listeners.onSongRequest(payload);
  });

  currentChannel.on('broadcast', { event: 'request-response' }, ({ payload }) => {
    if (listeners.onRequestResponse) listeners.onRequestResponse(payload);
  });

  currentChannel.on('broadcast', { event: 'kick' }, ({ payload }) => {
    if (listeners.onKick) listeners.onKick(payload);
  });

  currentChannel.on('broadcast', { event: 'ban' }, ({ payload }) => {
    if (listeners.onBan) listeners.onBan(payload);
  });

  currentChannel.on('broadcast', { event: 'request-state' }, ({ payload }) => {
    // Only the host responds to state requests
    if (isHost && listeners.onSync) {
      // Host will re-broadcast current state (handled by player.js sync loop)
    }
  });

  await currentChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await currentChannel.track({
        userId: user.userId,
        handle: user.handle,
        name: user.name,
        avatar: user.profilePicture?.['150x150'] || user.profilePicture?.['480x480'] || null,
        isHost: isHost,
      });
    }
  });
}

export function broadcast(event, payload) {
  if (!currentChannel) return;
  currentChannel.send({
    type: 'broadcast',
    event,
    payload,
  });
}

export async function leaveRoom() {
  if (currentChannel) {
    await currentChannel.untrack();
    await currentChannel.unsubscribe();
    currentChannel = null;
  }
  currentRoomId = null;
  isHost = false;
  presenceState = {};
}

// Discover active rooms from owner-protected database records.
let lobbyChannel = null;
let lobbyCallback = null;

export function onLobbyUpdate(callback) {
  lobbyCallback = callback;
}

export async function joinLobby() {
  const refresh = async () => { if (lobbyCallback) lobbyCallback(await loadActiveRooms()); };
  await refresh();
  clearInterval(lobbyChannel);
  lobbyChannel = setInterval(() => { void refresh().catch(console.warn); }, 5000);
}

// Host calls this periodically to announce room to lobby
export function announceRoom() {
  // Discovery reads owner-protected room records, never untrusted lobby messages.
}

export async function leaveLobby() { clearInterval(lobbyChannel); lobbyChannel = null; }
