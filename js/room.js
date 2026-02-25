import { getSupabaseClient } from './supabase-client.js';

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
};

export function onRoomEvent(event, callback) {
  listeners[event] = callback;
}

function getSupabase() {
  return getSupabaseClient();
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
  const client = getSupabase();

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

// Discover active rooms by subscribing to a lobby channel
// All rooms broadcast their existence to a shared "lobby" channel
let lobbyChannel = null;
const activeRooms = new Map();
let lobbyCallback = null;

export function onLobbyUpdate(callback) {
  lobbyCallback = callback;
}

export async function joinLobby() {
  const client = getSupabase();

  lobbyChannel = client.channel('lobby', {
    config: {
      presence: { key: 'lobby' },
      broadcast: { self: false },
    },
  });

  lobbyChannel.on('broadcast', { event: 'room-announce' }, ({ payload }) => {
    if (payload.userCount > 0) {
      activeRooms.set(payload.roomId, payload);
    } else {
      activeRooms.delete(payload.roomId);
    }
    if (lobbyCallback) lobbyCallback(Array.from(activeRooms.values()));
  });

  await lobbyChannel.subscribe();
}

// Host calls this periodically to announce room to lobby
export function announceRoom(roomData) {
  if (!lobbyChannel) return;
  lobbyChannel.send({
    type: 'broadcast',
    event: 'room-announce',
    payload: roomData,
  });
}

export async function leaveLobby() {
  if (lobbyChannel) {
    await lobbyChannel.unsubscribe();
    lobbyChannel = null;
  }
}
