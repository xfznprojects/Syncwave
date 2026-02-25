import CONFIG from './config.js';
import { searchTracks, getTrending, getArtworkUrl, setArtworkWithFallback, getUserTracks, getUserFavorites, resolveUrl, getStreamUrl } from './audius.js';
import { initAuth, getCurrentUser, isLoggedIn, loginWithAudius, logout } from './auth.js';
import {
  createRoom, joinRoom, leaveRoom, broadcast, onRoomEvent,
  getIsHost, getRoomId, getUsers, joinLobby, leaveLobby, onLobbyUpdate, announceRoom,
} from './room.js';
import {
  initPlayer, playTrack, play, pause, togglePlay, seek,
  getCurrentTrack, getPlayState, getQueue, getCurrentIndex, addToQueue, removeFromQueue, clearQueue,
  playNext, playPrevious, playFromQueue, toggleShuffle, isShuffled,
  onPlayerEvent, handleSync, handleTrackChange, getAnalyser, resumeAudioContext,
  stopSyncLoop, destroy as destroyPlayer, setVolume, getVolume,
  moveInQueue, loadQueueFromData,
} from './player.js';
import { initVisualizer, startVisualizer as startVis2D, stopVisualizer as stopVis2D, cycleMode, getMode, destroy as destroyVis2D } from './visualizer.js';
import { initVisualizer3D, startVisualizer3D, stopVisualizer3D, destroyVisualizer3D } from './visualizer3d.js';
import {
  initChat, sendMessage, sendGif, handleIncomingMessage, clearChat,
  searchGifs, getTrendingGifs, getTrendingTerms, renderGifPicker, setupGifSearch,
  setOnChatNameClick, setMutedUsersRef,
} from './chat.js';
import { startAnalysis, stopAnalysis, onAnalysisUpdate, destroy as destroyAnalysis } from './analysis.js';
import { initWaveform, startWaveform, stopWaveform, zoomIn, zoomOut, getZoomLevel, destroy as destroyWaveform } from './waveform.js';
import {
  savePlaylist as dbSavePlaylist, loadPlaylist as dbLoadPlaylist,
  saveChatMessage as dbSaveChatMessage, loadChatHistory as dbLoadChatHistory,
  saveRoom as dbSaveRoom, updateRoomUserCount as dbUpdateRoomUserCount,
  loadActiveRooms as dbLoadActiveRooms, loadInactiveRooms as dbLoadInactiveRooms,
  loadRoomPlaylist as dbLoadRoomPlaylist,
} from './database.js';

// Song requests
let songRequests = [];

// Lobby announce interval
let announceInterval = null;

// Current room ID for chat persistence
let currentRoomIdForChat = null;

// Visualizer routing — 3D on desktop, 2D on mobile
let use3D = window.innerWidth > 900;

function startVisualizer() {
  if (use3D) startVisualizer3D();
  else startVis2D();
}
function stopVisualizer() {
  stopVis2D();
  stopVisualizer3D();
}
function destroyVis() {
  destroyVis2D();
  destroyVisualizer3D();
}

// ─── ROUTING ────────────────────────────────────────────────

function getRoute() {
  const hash = window.location.hash || '#/';
  if (hash.startsWith('#/room/')) {
    return { view: 'room', roomId: decodeURIComponent(hash.slice(7)) };
  }
  return { view: 'home' };
}

function navigate(path) {
  window.location.hash = path;
}

// ─── INIT ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initAuth();
  renderAuthUI();
  initPlayer();
  await joinLobby();

  // Lobby updates → render room directory
  onLobbyUpdate(rooms => {
    renderRoomDirectory(rooms);
  });

  // Load rooms from DB on initial page load (before any lobby broadcasts arrive)
  renderFullDirectory();

  // Room events
  onRoomEvent('onSync', handleSync);
  onRoomEvent('onChat', (msg) => {
    handleIncomingMessage(msg);
    if (currentRoomIdForChat) dbSaveChatMessage(currentRoomIdForChat, msg);
  });
  onRoomEvent('onTrackChange', handleTrackChange);
  onRoomEvent('onSongRequest', (data) => {
    songRequests.push(data);
    renderRequests();
  });
  onRoomEvent('onRequestResponse', (data) => {
    if (data.approved && data.track) {
      addToQueue(data.track);
    }
  });
  onRoomEvent('onPresenceChange', (users) => {
    renderListeners(users);
    // Update DB user count when listeners join/leave (host only)
    persistRoomToDB();
  });
  onRoomEvent('onKick', (data) => {
    const user = getCurrentUser();
    if (user && data.userId === user.userId) {
      showToast('You have been kicked from the room');
      window.location.hash = '#/';
    }
  });

  // Player events
  onPlayerEvent('onTrackChange', (track) => {
    renderNowPlaying(track);
    startVisualizer();
    startWaveform();
    startAnalysis();
    // Re-render queue to update highlight on active track
    renderQueue(getQueue(), getCurrentIndex());
    // Persist room to DB on track change (host only)
    persistRoomToDB();
  });
  onPlayerEvent('onPlayStateChange', (playing) => {
    updatePlayButton(playing);
    if (playing) { startVisualizer(); startWaveform(); startAnalysis(); }
    else { stopVisualizer(); stopWaveform(); stopAnalysis(); }
  });
  onPlayerEvent('onTimeUpdate', (state) => {
    updateProgress(state);
  });
  onPlayerEvent('onQueueChange', (queue, idx) => {
    renderQueue(queue, idx);
    // Persist playlist
    const user = getCurrentUser();
    if (user) dbSavePlaylist(user.userId, queue);
    else savePlaylistToStorage(); // fallback for guests
    // Persist room to DB on queue change (host only)
    persistRoomToDB();
  });

  // Route handling
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
});

function handleRoute() {
  const route = getRoute();
  const homeView = document.getElementById('home-view');
  const roomView = document.getElementById('room-view');

  if (route.view === 'room') {
    homeView.classList.add('hidden');
    roomView.classList.remove('hidden');
    enterRoom(route.roomId);
  } else {
    roomView.classList.add('hidden');
    homeView.classList.remove('hidden');
    exitRoom();
    // Refresh room directory from DB when returning to home
    renderFullDirectory();
  }
}

// ─── AUTH UI ────────────────────────────────────────────────

function renderAuthUI() {
  const authBtn = document.getElementById('auth-btn');
  const authAvatar = document.getElementById('auth-avatar');
  const authName = document.getElementById('auth-name');
  const createBtn = document.getElementById('create-room-btn');
  const user = getCurrentUser();

  if (user) {
    authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Logout';
    authBtn.onclick = () => { logout(); renderAuthUI(); };
    authName.textContent = user.name;
    authName.classList.remove('hidden');
    if (user.profilePicture?.['150x150']) {
      authAvatar.src = user.profilePicture['150x150'];
      authAvatar.classList.remove('hidden');
    }
    // Update create room button to reflect user already has a room
    if (createBtn) {
      createBtn.innerHTML = '<i class="fa-solid fa-door-open"></i> Enter Your Room';
    }
  } else {
    authBtn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Log In with Audius';
    authBtn.onclick = async () => {
      try {
        await loginWithAudius();
        renderAuthUI();
      } catch (e) {
        if (e.message !== 'Login cancelled') {
          showToast('Login failed: ' + e.message);
        }
      }
    };
    authName.classList.add('hidden');
    authAvatar.classList.add('hidden');
    // Reset create room button text
    if (createBtn) {
      createBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Create a Room';
    }
  }
}

// ─── HOME VIEW ──────────────────────────────────────────────

// Keep track of live lobby rooms (from broadcast) to merge with DB rooms
let liveActiveRooms = [];

function renderRoomCard(room, inactive = false) {
  const timeAgo = inactive && room.lastActiveAt ? getTimeAgo(room.lastActiveAt) : '';
  return `
    <div class="room-card ${inactive ? 'room-card-inactive' : ''}" data-room="${escapeHtml(room.roomId)}">
      <div class="room-card-header">
        ${room.hostAvatar
          ? `<img class="room-host-avatar" src="${escapeHtml(room.hostAvatar)}" alt="${escapeHtml(room.hostName)}">`
          : `<div class="room-host-avatar-fallback">${(room.hostName || room.roomId || '?')[0].toUpperCase()}</div>`}
        <div class="room-host-info">
          <span class="room-host-name">${escapeHtml(room.hostName || room.roomId)}</span>
          ${inactive
            ? `<span class="room-listener-count room-inactive-label"><i class="fa-solid fa-clock"></i> ${timeAgo}</span>`
            : `<span class="room-listener-count"><i class="fa-solid fa-headphones"></i> ${room.userCount} listener${room.userCount !== 1 ? 's' : ''}</span>`}
        </div>
      </div>
      ${room.currentTrack ? `
        <div class="room-now-playing">
          <span class="room-track-title">${escapeHtml(room.currentTrack.title)}</span>
          <span class="room-track-artist">${escapeHtml(room.currentTrack.artist || '')}</span>
        </div>
      ` : '<div class="room-now-playing"><span class="room-track-title">No track playing</span></div>'}
    </div>`;
}

function attachRoomCardClicks(container) {
  container.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      navigate(`#/room/${card.dataset.room}`);
    });
  });
}

function renderRoomDirectory(activeRooms) {
  // Update live active rooms from lobby broadcast
  liveActiveRooms = activeRooms || [];
  renderFullDirectory();
}

const MIN_PLAYLIST_SIZE = 5;

function dedupeRooms(rooms) {
  const seen = new Set();
  return rooms.filter(r => {
    if (seen.has(r.roomId)) return false;
    seen.add(r.roomId);
    return true;
  });
}

function roomHasEnoughSongs(room) {
  // Live lobby rooms don't carry playlist data — let them through
  if (room.playlist == null) return true;
  const list = Array.isArray(room.playlist) ? room.playlist : [];
  return list.length >= MIN_PLAYLIST_SIZE;
}

async function renderFullDirectory() {
  const activeGrid = document.getElementById('room-grid-active');
  const inactiveGrid = document.getElementById('room-grid-inactive');
  const inactiveSection = document.getElementById('inactive-rooms-section');
  if (!activeGrid) return;

  // Merge live lobby data with DB active rooms
  // Live lobby data takes precedence (it's real-time)
  const liveIds = new Set(liveActiveRooms.map(r => r.roomId));
  let dbActive = [];
  try {
    dbActive = await dbLoadActiveRooms(20);
  } catch { /* ignore */ }

  // Combine: live rooms first, then DB rooms not already in live set — deduped
  const mergedActive = dedupeRooms([
    ...liveActiveRooms,
    ...dbActive.filter(r => !liveIds.has(r.roomId)),
  ]).slice(0, 20);

  if (mergedActive.length === 0) {
    activeGrid.innerHTML = `<div class="empty-state">
      <p>No active rooms right now</p>
      <p>Log in with Audius to create one!</p>
    </div>`;
  } else {
    activeGrid.innerHTML = mergedActive.map(r => renderRoomCard(r, false)).join('');
    attachRoomCardClicks(activeGrid);
  }

  // Load inactive rooms from DB
  if (inactiveGrid && inactiveSection) {
    try {
      const inactive = await dbLoadInactiveRooms(10);
      // Filter: not active in lobby, no duplicates, 5+ songs
      const filtered = dedupeRooms(
        inactive.filter(r => !liveIds.has(r.roomId) && roomHasEnoughSongs(r))
      );
      if (filtered.length > 0) {
        inactiveSection.classList.remove('hidden');
        inactiveGrid.innerHTML = filtered.map(r => renderRoomCard(r, true)).join('');
        attachRoomCardClicks(inactiveGrid);
      } else {
        inactiveSection.classList.add('hidden');
      }
    } catch {
      inactiveSection.classList.add('hidden');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Create room button
  const createBtn = document.getElementById('create-room-btn');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      if (!isLoggedIn()) {
        showToast('Please log in with Audius to create a room');
        return;
      }
      const user = getCurrentUser();
      navigate(`#/room/${user.handle}`);
    });
  }

  // Join room input
  const joinBtn = document.getElementById('join-room-btn');
  const joinInput = document.getElementById('join-room-input');
  if (joinBtn && joinInput) {
    joinBtn.addEventListener('click', () => {
      const roomId = joinInput.value.trim();
      if (roomId) navigate(`#/room/${roomId}`);
    });
    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const roomId = joinInput.value.trim();
        if (roomId) navigate(`#/room/${roomId}`);
      }
    });
  }
});

// ─── ROOM VIEW ──────────────────────────────────────────────

async function enterRoom(roomId) {
  currentRoomIdForChat = roomId;
  const user = getCurrentUser();
  const isCreator = user && user.handle === roomId;

  // Init chat
  const chatMessages = document.getElementById('chat-messages');
  const gifPicker = document.getElementById('gif-picker-grid');
  initChat(chatMessages, gifPicker);
  setOnChatNameClick(showChatUserMenu);
  setMutedUsersRef(mutedUsers);
  clearChat();

  // Load prior chat history for this room (from Supabase with localStorage fallback)
  try {
    const chatHistory = await dbLoadChatHistory(roomId);
    if (chatHistory.length > 0) {
      chatHistory.forEach(msg => handleIncomingMessage(msg));
    }
  } catch {
    const chatHistory = getChatHistory(roomId);
    if (chatHistory.length > 0) {
      chatHistory.forEach(msg => handleIncomingMessage(msg));
    }
  }

  // Init visualizers — 3D on desktop, 2D fallback on mobile
  use3D = window.innerWidth > 900;
  const canvas = document.getElementById('visualizer-canvas');
  if (canvas) initVisualizer(canvas);
  if (use3D) {
    const container3d = document.getElementById('visualizer-3d');
    if (container3d) {
      const ok = await initVisualizer3D(container3d);
      if (!ok) {
        // Three.js failed to load — fall back to 2D
        use3D = false;
        console.warn('Falling back to 2D visualizer');
      }
    }
  }

  // Init stereo waveform
  const waveformCanvas = document.getElementById('waveform-canvas');
  if (waveformCanvas) initWaveform(waveformCanvas);

  // Init analysis display
  onAnalysisUpdate((results) => {
    const bpmEl = document.getElementById('analysis-bpm');
    const keyEl = document.getElementById('analysis-key');
    const lufsEl = document.getElementById('analysis-lufs');
    const drEl = document.getElementById('analysis-dr');
    if (bpmEl) bpmEl.textContent = results.bpm ?? '--';
    if (keyEl) keyEl.textContent = results.key ?? '--';
    if (lufsEl) lufsEl.textContent = results.lufs != null ? `${results.lufs}` : '--';
    if (drEl) drEl.textContent = results.dr != null ? `${results.dr} dB` : '--';
  });

  // Join/create room
  try {
    if (isCreator) {
      await createRoom(user);
      showToast('Room created! Share your handle to invite listeners.');
    } else {
      const guestUser = user || {
        userId: 'guest-' + Date.now(),
        handle: 'guest',
        name: 'Guest',
        profilePicture: null,
      };
      await joinRoom(roomId, guestUser);
    }
  } catch (e) {
    showToast('Failed to join room: ' + e.message);
    return;
  }

  // Update room title in main header
  const headerTitle = document.getElementById('header-room-title');
  if (headerTitle) {
    headerTitle.textContent = `${roomId}'s Room`;
    headerTitle.classList.remove('hidden');
  }

  // Show/hide host controls
  const hostControls = document.querySelectorAll('.host-only');
  hostControls.forEach(el => {
    el.style.display = getIsHost() ? '' : 'none';
  });

  // Setup search
  setupSearch();

  // Setup chat input
  setupChatInput();

  // Setup GIF picker
  setupGifPicker();

  // Setup player controls
  setupPlayerControls();

  // Setup mobile tabs
  setupMobileTabs();

  // Setup request functionality
  setupRequests();

  // Setup collapsible panels
  setupCollapsiblePanels();

  // Setup accordion sections
  setupAccordions();

  // Setup search modal
  setupSearchModal();

  // Setup chat user context menu
  setupChatUserMenu();

  // Start lobby announcements if host
  if (getIsHost()) {
    startAnnouncing(roomId);

    // Restore saved playlist if host and queue is empty
    if (getQueue().length === 0) {
      let saved = null;
      if (user) {
        try { saved = await dbLoadPlaylist(user.userId); } catch { /* fallback below */ }
      }
      if (!saved) saved = loadPlaylistFromStorage();
      if (saved && saved.length > 0) {
        loadQueueFromData(saved, false);
        showToast(`Restored ${saved.length} tracks from last session`);
      }
    }
  } else {
    // Non-host: wait a moment for host sync, then auto-play room playlist if no host responds
    setTimeout(async () => {
      // If no tracks arrived from host sync, load the room's saved playlist
      if (getQueue().length === 0) {
        try {
          const roomPlaylist = await dbLoadRoomPlaylist(roomId);
          if (roomPlaylist && roomPlaylist.length > 0) {
            loadQueueFromData(roomPlaylist, true); // autoPlay = true
            showToast(`Playing ${roomPlaylist.length} tracks from this room`);
          }
        } catch {
          // No saved playlist — that's fine
        }
      }
    }, 3000); // 3 seconds — enough time for host to respond with sync
  }

  // Reset song requests
  songRequests = [];
  renderRequests();
}

function exitRoom() {
  currentRoomIdForChat = null;
  stopAnnouncing();
  leaveRoom();
  stopSyncLoop();
  stopVisualizer();
  destroyVis();
  stopWaveform();
  destroyWaveform();
  stopAnalysis();
  destroyAnalysis();
  stopPreview();
  clearChat();
  songRequests = [];

  // Clear room title from header
  const headerTitle = document.getElementById('header-room-title');
  if (headerTitle) {
    headerTitle.textContent = '';
    headerTitle.classList.add('hidden');
  }
}

// ─── SEARCH WITH TABS ───────────────────────────────────────

let searchTimeout = null;
let activeSearchTab = 'trending';
const PAGE_SIZE = 25;
let searchPage = 0;
let searchLastQuery = '';
let searchLastLabel = '';
let searchLastTracks = [];

// Preview audio — separate from main player so preview doesn't disrupt the queue
let previewAudio = null;
let previewingTrackId = null;

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
  }
  previewingTrackId = null;
  // Remove active state from any preview buttons
  document.querySelectorAll('.btn-preview.active').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.track-item.previewing').forEach(el => el.classList.remove('previewing'));
}

function togglePreview(track, btn, trackItem) {
  if (previewingTrackId === track.id) {
    stopPreview();
    return;
  }
  stopPreview();
  if (!previewAudio) {
    previewAudio = new Audio();
    previewAudio.volume = 0.5;
    previewAudio.addEventListener('ended', stopPreview);
  }
  previewAudio.src = getStreamUrl(track.id);
  previewAudio.play().catch(() => {});
  previewingTrackId = track.id;
  btn.classList.add('active');
  trackItem.classList.add('previewing');
}

function setupSearch() {
  const input = document.getElementById('search-input');
  const urlArea = document.getElementById('url-input-area');
  const tabs = document.querySelectorAll('.search-tab');

  // Show My Tracks / Favorites tabs for logged-in users
  if (isLoggedIn()) {
    const myTracksTab = document.getElementById('tab-mytracks');
    const favoritesTab = document.getElementById('tab-favorites');
    if (myTracksTab) myTracksTab.style.display = '';
    if (favoritesTab) favoritesTab.style.display = '';
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeSearchTab = tab.dataset.searchTab;
      searchPage = 0;

      // Show/hide inputs
      if (input) input.style.display = activeSearchTab === 'search' ? '' : 'none';
      if (urlArea) urlArea.style.display = activeSearchTab === 'url' ? '' : 'none';

      // Clear previous results
      const container = document.getElementById('search-results');
      if (container) container.innerHTML = '<div class="empty-state">Loading...</div>';

      stopPreview();

      // Load content for tab
      if (activeSearchTab === 'trending') loadTrending();
      else if (activeSearchTab === 'search') { input.focus(); if (input.value.trim()) triggerSearch(input.value.trim()); else if (container) container.innerHTML = '<div class="empty-state">Type to search...</div>'; }
      else if (activeSearchTab === 'url') { if (container) container.innerHTML = '<div class="empty-state">Paste an Audius track URL above</div>'; }
      else if (activeSearchTab === 'mytracks') loadMyTracks();
      else if (activeSearchTab === 'favorites') loadFavorites();
    });
  });

  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchPage = 0;
      searchTimeout = setTimeout(() => {
        triggerSearch(input.value.trim());
      }, 300);
    });
  }

  // URL input
  setupUrlInput();
}

function setupUrlInput() {
  const urlInput = document.getElementById('audius-url-input');
  const urlBtn = document.getElementById('audius-url-add');
  const urlStatus = document.getElementById('url-status');
  if (!urlInput || !urlBtn) return;

  async function addFromUrl() {
    const url = urlInput.value.trim();
    if (!url) return;

    // Validate it's an Audius URL
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith('audius.co')) {
        urlStatus.textContent = 'Please enter a valid audius.co URL';
        urlStatus.className = 'url-status error';
        return;
      }
    } catch {
      urlStatus.textContent = 'Invalid URL format';
      urlStatus.className = 'url-status error';
      return;
    }

    urlStatus.textContent = 'Resolving track...';
    urlStatus.className = 'url-status';

    try {
      const result = await resolveUrl(url);
      if (!result || !result.id) {
        urlStatus.textContent = 'Could not find a track at that URL';
        urlStatus.className = 'url-status error';
        return;
      }
      addToQueue(result);
      urlStatus.textContent = `Added "${result.title}" to queue`;
      urlStatus.className = 'url-status success';
      urlInput.value = '';
      showToast(`Added "${result.title}" to queue`);
    } catch (e) {
      urlStatus.textContent = 'Failed to resolve URL: ' + e.message;
      urlStatus.className = 'url-status error';
    }
  }

  urlBtn.addEventListener('click', addFromUrl);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFromUrl();
  });
}

async function triggerSearch(query) {
  if (query.length >= 2) {
    const results = await searchTracks(query, PAGE_SIZE, searchPage * PAGE_SIZE);
    searchLastQuery = query;
    renderSearchResults(results, 'Search Results');
  }
}

async function loadTrending() {
  try {
    const trending = await getTrending(null, 'week', PAGE_SIZE, searchPage * PAGE_SIZE);
    renderSearchResults(trending, 'Trending on Audius');
  } catch { /* optional */ }
}

async function loadMyTracks() {
  const user = getCurrentUser();
  if (!user) return;
  try {
    const tracks = await getUserTracks(user.userId, PAGE_SIZE, searchPage * PAGE_SIZE);
    renderSearchResults(tracks, 'My Tracks');
  } catch { renderSearchResults([], 'My Tracks'); }
}

async function loadFavorites() {
  const user = getCurrentUser();
  if (!user) return;
  try {
    const favs = await getUserFavorites(user.userId, PAGE_SIZE, searchPage * PAGE_SIZE);
    const tracks = favs.map(f => f.favorite_item || f).filter(t => t.id);
    renderSearchResults(tracks, 'Favorites');
  } catch { renderSearchResults([], 'Favorites'); }
}

function reloadCurrentTab() {
  if (activeSearchTab === 'trending') loadTrending();
  else if (activeSearchTab === 'search') triggerSearch(searchLastQuery);
  else if (activeSearchTab === 'mytracks') loadMyTracks();
  else if (activeSearchTab === 'favorites') loadFavorites();
}

function renderSearchResults(tracks, label = 'Search Results') {
  const container = document.getElementById('search-results');
  if (!container) return;

  searchLastLabel = label;
  searchLastTracks = tracks || [];

  if (!tracks || tracks.length === 0) {
    container.innerHTML = searchPage > 0
      ? '<div class="empty-state">No more tracks</div>' + renderPagination(0)
      : '<div class="empty-state">No tracks found</div>';
    return;
  }

  const headerHtml = `<div class="search-results-header">${escapeHtml(label)}</div>`;

  container.innerHTML = headerHtml + tracks.map(track => `
    <div class="track-item" data-track-id="${escapeHtml(track.id)}">
      <div class="track-artwork-wrap">
        <img class="track-artwork" src="${escapeHtml(getArtworkUrl(track, '150x150') || '')}" alt="" loading="lazy">
      </div>
      <div class="track-info">
        <span class="track-title">${escapeHtml(track.title)}</span>
        <span class="track-artist">${escapeHtml(track.user?.name || 'Unknown')}</span>
      </div>
      <div class="track-actions">
        ${getIsHost() ? `
          <button class="btn-icon btn-preview" title="Preview"><i class="fa-solid fa-headphones"></i></button>
          <button class="btn-icon btn-add-queue" title="Add to queue"><i class="fa-solid fa-plus"></i></button>
        ` : isLoggedIn() ? `
          <button class="btn-icon btn-preview" title="Preview"><i class="fa-solid fa-headphones"></i></button>
          <button class="btn-icon btn-request" title="Request song"><i class="fa-solid fa-hand"></i></button>
        ` : `
          <button class="btn-icon btn-preview" title="Preview"><i class="fa-solid fa-headphones"></i></button>
        `}
      </div>
    </div>
  `).join('') + renderPagination(tracks.length);

  // Apply artwork fallback
  container.querySelectorAll('.track-item').forEach((item, i) => {
    const img = item.querySelector('.track-artwork');
    if (img && tracks[i]) setArtworkWithFallback(img, tracks[i], '150x150');
  });

  // Preview buttons (available to everyone)
  container.querySelectorAll('.btn-preview').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trackItem = btn.closest('.track-item');
      togglePreview(tracks[i], btn, trackItem);
    });
  });

  // Add to queue (host only)
  container.querySelectorAll('.btn-add-queue').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToQueue(tracks[i]);
      showToast(`Added "${tracks[i].title}" to queue`);
    });
  });

  // Request song (non-host logged-in users)
  container.querySelectorAll('.btn-request').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestSong(tracks[i]);
      showToast(`Requested "${tracks[i].title}"`);
    });
  });

  // Pagination buttons
  const prevPageBtn = container.querySelector('.btn-page-prev');
  const nextPageBtn = container.querySelector('.btn-page-next');
  if (prevPageBtn) prevPageBtn.addEventListener('click', () => { searchPage--; reloadCurrentTab(); });
  if (nextPageBtn) nextPageBtn.addEventListener('click', () => { searchPage++; reloadCurrentTab(); });
}

function renderPagination(resultCount) {
  // Only show pagination if there are results or we're past page 0
  if (searchPage === 0 && resultCount < PAGE_SIZE) return '';

  const hasPrev = searchPage > 0;
  const hasNext = resultCount >= PAGE_SIZE;

  return `
    <div class="search-pagination">
      <button class="btn-icon btn-page-prev" ${hasPrev ? '' : 'disabled'} title="Previous page"><i class="fa-solid fa-chevron-left"></i></button>
      <span class="search-page-info">Page ${searchPage + 1}</span>
      <button class="btn-icon btn-page-next" ${hasNext ? '' : 'disabled'} title="Next page"><i class="fa-solid fa-chevron-right"></i></button>
    </div>
  `;
}

// ─── NOW PLAYING ────────────────────────────────────────────

function renderNowPlaying(track) {
  const artwork = document.getElementById('np-artwork');
  const title = document.getElementById('np-title');
  const artist = document.getElementById('np-artist');

  if (track) {
    if (artwork) {
      setArtworkWithFallback(artwork, track, '480x480');
      artwork.classList.remove('hidden');
    }
    if (title) title.textContent = track.title || 'Unknown Track';
    if (artist) artist.textContent = track.user?.name || track.user?.handle || 'Unknown Artist';
  } else {
    if (artwork) { artwork.src = ''; artwork.classList.add('hidden'); }
    if (title) title.textContent = 'No track playing';
    if (artist) artist.textContent = '';
  }
}

function updatePlayButton(playing) {
  const btn = document.getElementById('btn-playpause');
  if (btn) btn.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function updateProgress(state) {
  const bar = document.getElementById('progress-fill');
  const timeEl = document.getElementById('progress-time');
  const durationEl = document.getElementById('progress-duration');

  if (bar && state.duration > 0) {
    bar.style.width = `${(state.currentTime / state.duration) * 100}%`;
  }
  if (timeEl) timeEl.textContent = formatTime(state.currentTime);
  if (durationEl) durationEl.textContent = formatTime(state.duration);
}

function setupPlayerControls() {
  const playPauseBtn = document.getElementById('btn-playpause');
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  const vizBtn = document.getElementById('btn-viz-mode');
  const progressBar = document.getElementById('progress-bar');

  // Dim playback controls for non-hosts
  const controlsWrap = document.querySelector('.player-controls');
  if (controlsWrap && !getIsHost()) {
    controlsWrap.classList.add('controls-locked');
  }
  const volumeSlider = document.getElementById('volume-slider');
  const muteBtn = document.getElementById('btn-mute');

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      if (!getIsHost()) { showToast('Only the host can control playback'); return; }
      resumeAudioContext();
      togglePlay();
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (!getIsHost()) { showToast('Only the host can control playback'); return; }
      playPrevious();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!getIsHost()) { showToast('Only the host can control playback'); return; }
      playNext();
    });
  }

  if (vizBtn) {
    vizBtn.addEventListener('click', () => {
      const isMobile = window.innerWidth <= 900;
      const vis3dEl = document.getElementById('visualizer-3d');
      const vis2dEl = document.getElementById('visualizer-canvas');

      if (isMobile) {
        // Mobile: only cycle 2D modes, no 3D
        const mode = cycleMode();
        showToast(`Visualizer: ${mode}`);
        return;
      }

      if (use3D) {
        // Switch from 3D → first 2D mode (bars)
        use3D = false;
        stopVisualizer3D();
        if (vis3dEl) vis3dEl.style.display = 'none';
        if (vis2dEl) vis2dEl.style.display = 'block';
        startVis2D();
        showToast(`Visualizer: ${getMode()}`);
      } else {
        const mode = cycleMode();
        if (mode === 'bars') {
          // Wrapped around back to bars → switch to 3D
          use3D = true;
          stopVis2D();
          if (vis2dEl) vis2dEl.style.display = 'none';
          if (vis3dEl) vis3dEl.style.display = '';
          startVisualizer3D();
          showToast('Visualizer: 3D');
        } else {
          showToast(`Visualizer: ${mode}`);
        }
      }
    });
  }

  // Waveform zoom controls
  const zoomInBtn = document.getElementById('waveform-zoom-in');
  const zoomOutBtn = document.getElementById('waveform-zoom-out');
  const zoomLabel = document.getElementById('waveform-zoom-level');
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      const level = zoomIn();
      if (zoomLabel) zoomLabel.textContent = `${level.toFixed(1)}x`;
    });
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      const level = zoomOut();
      if (zoomLabel) zoomLabel.textContent = `${level.toFixed(1)}x`;
    });
  }

  // Queue toolbar buttons
  setupQueueToolbar();

  if (progressBar) {
    progressBar.addEventListener('click', (e) => {
      if (!getIsHost()) return;
      const rect = progressBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const state = getPlayState();
      if (state.duration > 0) seek(pct * state.duration);
    });
  }

  // Volume
  let savedVolume = 0.8;
  if (volumeSlider) {
    setVolume(0.8);
    volumeSlider.addEventListener('input', () => {
      const vol = parseInt(volumeSlider.value) / 100;
      setVolume(vol);
      savedVolume = vol;
      if (muteBtn) muteBtn.innerHTML = vol === 0 ? '<i class="fa-solid fa-volume-xmark"></i>' : vol < 0.5 ? '<i class="fa-solid fa-volume-low"></i>' : '<i class="fa-solid fa-volume-high"></i>';
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      const current = getVolume();
      if (current > 0) {
        savedVolume = current;
        setVolume(0);
        if (volumeSlider) volumeSlider.value = 0;
        muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
      } else {
        setVolume(savedVolume || 0.8);
        if (volumeSlider) volumeSlider.value = Math.round((savedVolume || 0.8) * 100);
        muteBtn.innerHTML = savedVolume < 0.5 ? '<i class="fa-solid fa-volume-low"></i>' : '<i class="fa-solid fa-volume-high"></i>';
      }
    });
  }
}

// ─── COLLAPSIBLE PANELS ─────────────────────────────────────

function setupCollapsiblePanels() {
  const layout = document.querySelector('.room-layout');
  const expandChat = document.getElementById('expand-chat');
  const expandSidebar = document.getElementById('expand-sidebar');

  document.querySelectorAll('.btn-collapse').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.collapse;
      if (target === 'chat') {
        layout.classList.add('chat-collapsed');
        if (expandChat) expandChat.classList.remove('hidden');
      } else if (target === 'sidebar') {
        layout.classList.add('sidebar-collapsed');
        if (expandSidebar) expandSidebar.classList.remove('hidden');
      }
    });
  });

  if (expandChat) {
    expandChat.addEventListener('click', () => {
      layout.classList.remove('chat-collapsed');
      expandChat.classList.add('hidden');
    });
  }

  if (expandSidebar) {
    expandSidebar.addEventListener('click', () => {
      layout.classList.remove('sidebar-collapsed');
      expandSidebar.classList.add('hidden');
    });
  }
}

// ─── ACCORDION SECTIONS ──────────────────────────────────────

function setupAccordions() {
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking a button inside the header (collapse, toolbar)
      if (e.target.closest('.btn-collapse') || e.target.closest('.queue-toolbar') || e.target.closest('.btn-icon')) return;

      const key = header.dataset.accordion;
      const body = document.querySelector(`[data-accordion-body="${key}"]`);
      if (!body) return;

      const isOpen = !body.classList.contains('closed');
      if (isOpen) {
        body.classList.add('closed');
        header.classList.add('collapsed');
      } else {
        body.classList.remove('closed');
        header.classList.remove('collapsed');
      }
    });
  });
}

// ─── SEARCH MODAL ────────────────────────────────────────────

function setupSearchModal() {
  const modal = document.getElementById('search-modal');
  const closeBtn = document.getElementById('search-modal-close');
  const addSongBtn = document.getElementById('btn-add-song');

  if (addSongBtn) {
    addSongBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSearchModal();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeSearchModal());
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSearchModal();
    });
  }

  // ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeSearchModal();
    }
  });
}

function openSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.remove('hidden');
    loadTrending();
  }
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) modal.classList.add('hidden');
  stopPreview();
}

// ─── CHAT USER CONTEXT MENU (Mute/Kick) ─────────────────────

let mutedUsers = new Set();
let chatMenuTarget = null;

function setupChatUserMenu() {
  const menu = document.getElementById('chat-user-menu');
  if (!menu) return;

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.add('hidden');
    }
  });

  // Menu actions
  menu.querySelectorAll('.chat-user-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!chatMenuTarget) return;
      const action = item.dataset.action;

      if (action === 'profile') {
        window.open(`https://audius.co/${chatMenuTarget.handle}`, '_blank', 'noopener');
      } else if (action === 'mute') {
        const isMuted = mutedUsers.has(chatMenuTarget.userId);
        if (isMuted) mutedUsers.delete(chatMenuTarget.userId);
        else mutedUsers.add(chatMenuTarget.userId);
        // Single pass to toggle muted class on matching messages
        const chatContainer = document.getElementById('chat-messages');
        if (chatContainer) {
          chatContainer.querySelectorAll(`.chat-message[data-user-id="${chatMenuTarget.userId}"]`).forEach(msg => {
            msg.classList.toggle('muted', !isMuted);
          });
        }
        showToast(`${isMuted ? 'Unmuted' : 'Muted'} ${chatMenuTarget.name}`);
      } else if (action === 'kick') {
        if (getIsHost()) {
          mutedUsers.add(chatMenuTarget.userId);
          broadcast('kick', { userId: chatMenuTarget.userId });
          showToast(`Kicked ${chatMenuTarget.name}`);
        } else {
          showToast('Only the host can kick users');
        }
      }

      menu.classList.add('hidden');
      chatMenuTarget = null;
    });
  });
}

function showChatUserMenu(e, userId, handle, name) {
  const menu = document.getElementById('chat-user-menu');
  if (!menu) return;

  chatMenuTarget = { userId, handle, name };

  // Show/hide kick option based on host status
  const kickBtn = menu.querySelector('[data-action="kick"]');
  if (kickBtn) kickBtn.style.display = getIsHost() ? '' : 'none';

  // Update mute button text
  const muteBtn = menu.querySelector('[data-action="mute"]');
  if (muteBtn) {
    if (mutedUsers.has(userId)) {
      muteBtn.textContent = 'Unmute User';
    } else {
      muteBtn.textContent = 'Mute User';
    }
  }

  // Position near the click
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 120)}px`;
  menu.classList.remove('hidden');
}

// ─── QUEUE ──────────────────────────────────────────────────

let dragSrcIndex = null;

function renderQueue(queue, currentIndex) {
  const container = document.getElementById('queue-list');
  if (!container) return;

  if (!queue || queue.length === 0) {
    container.innerHTML = '<div class="empty-state">Queue is empty</div>';
    return;
  }

  const isHostUser = getIsHost();

  container.innerHTML = queue.map((track, i) => `
    <div class="queue-item ${i === currentIndex ? 'queue-active' : ''}" data-index="${i}" ${isHostUser ? 'draggable="true"' : ''}>
      ${isHostUser ? '<span class="queue-drag-handle" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>' : ''}
      <span class="queue-number">${i + 1}</span>
      <div class="queue-track-info">
        <span class="queue-track-title">${escapeHtml(track.title)}</span>
        <span class="queue-track-artist">${escapeHtml(track.user?.name || '')}</span>
      </div>
      ${isHostUser ? `<button class="btn-icon btn-remove-queue" data-index="${i}" title="Remove"><i class="fa-solid fa-xmark"></i></button>` : ''}
    </div>
  `).join('');

  container.querySelectorAll('.queue-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger play when clicking drag handle or remove button
      if (e.target.closest('.queue-drag-handle') || e.target.closest('.btn-remove-queue')) return;
      if (isHostUser) playFromQueue(parseInt(item.dataset.index));
    });

    // Drag-and-drop for host
    if (isHostUser) {
      item.addEventListener('dragstart', (e) => {
        dragSrcIndex = parseInt(item.dataset.index);
        item.classList.add('queue-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragSrcIndex);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('queue-dragging');
        container.querySelectorAll('.queue-item').forEach(el => el.classList.remove('queue-drag-over'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.queue-item').forEach(el => el.classList.remove('queue-drag-over'));
        item.classList.add('queue-drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('queue-drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('queue-drag-over');
        const toIndex = parseInt(item.dataset.index);
        if (dragSrcIndex !== null && dragSrcIndex !== toIndex) {
          moveInQueue(dragSrcIndex, toIndex);
        }
        dragSrcIndex = null;
      });
    }
  });

  container.querySelectorAll('.btn-remove-queue').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(parseInt(btn.dataset.index));
    });
  });

  // Auto-scroll active item into view
  const activeItem = container.querySelector('.queue-active');
  if (activeItem) activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── QUEUE TOOLBAR ──────────────────────────────────────────

function setupQueueToolbar() {
  const shuffleBtn = document.getElementById('btn-shuffle');
  const exportBtn = document.getElementById('btn-export-playlist');
  const importBtn = document.getElementById('btn-import-playlist');
  const importInput = document.getElementById('import-playlist-input');
  const clearBtn = document.getElementById('btn-clear-queue');

  // Shuffle — host only
  if (shuffleBtn) {
    if (getIsHost()) {
      shuffleBtn.style.display = '';
      shuffleBtn.addEventListener('click', () => {
        const shuffled = toggleShuffle();
        shuffleBtn.classList.toggle('active', shuffled);
        showToast(shuffled ? 'Shuffle on' : 'Shuffle off');
      });
    } else {
      shuffleBtn.style.display = 'none';
    }
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const queue = getQueue();
      if (queue.length === 0) { showToast('Queue is empty'); return; }
      const data = JSON.stringify({ name: 'SyncWave Playlist', tracks: queue, exportedAt: Date.now() }, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'syncwave-playlist.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Playlist exported');
    });
  }

  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          const tracks = data.tracks || data;
          if (Array.isArray(tracks) && tracks.length > 0) {
            loadQueueFromData(tracks, true);
            showToast(`Imported ${tracks.length} tracks`);
          } else {
            showToast('No tracks found in file');
          }
        } catch {
          showToast('Invalid playlist file');
        }
      };
      reader.readAsText(file);
      importInput.value = ''; // Reset so same file can be re-imported
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (getQueue().length === 0) { showToast('Queue already empty'); return; }
      clearQueue();
      showToast('Queue cleared');
    });
  }
}

// ─── PLAYLIST PERSISTENCE (localStorage) ────────────────────

const PLAYLIST_STORAGE_KEY = 'syncwave_playlist';

function savePlaylistToStorage() {
  const queue = getQueue();
  if (queue.length > 0) {
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(queue));
  } else {
    localStorage.removeItem(PLAYLIST_STORAGE_KEY);
  }
}

function loadPlaylistFromStorage() {
  try {
    const data = localStorage.getItem(PLAYLIST_STORAGE_KEY);
    if (data) return JSON.parse(data);
  } catch { /* ignore */ }
  return null;
}

// ─── CHAT HISTORY PERSISTENCE ───────────────────────────────

const CHAT_HISTORY_KEY = 'syncwave_chat_history';
const CHAT_HISTORY_LIMIT = 50;

function saveChatMessage(roomId, message) {
  const key = `${CHAT_HISTORY_KEY}_${roomId}`;
  let history = [];
  try { history = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* ignore */ }
  history.push(message);
  if (history.length > CHAT_HISTORY_LIMIT) history = history.slice(-CHAT_HISTORY_LIMIT);
  localStorage.setItem(key, JSON.stringify(history));
}

function getChatHistory(roomId) {
  const key = `${CHAT_HISTORY_KEY}_${roomId}`;
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

// ─── LISTENERS ──────────────────────────────────────────────

function renderListeners(users) {
  const container = document.getElementById('listeners-list');
  const countEl = document.getElementById('listener-count');
  if (!container) return;

  if (countEl) countEl.textContent = users.length;

  // Remove any existing floating popup from a previous render
  const oldPopup = document.getElementById('listener-floating-popup');
  if (oldPopup) oldPopup.remove();

  container.innerHTML = users.map(user => {
    const safeAvatar = user.avatar && typeof user.avatar === 'string' && (user.avatar.startsWith('https://') || user.avatar.startsWith('http://'))
      ? escapeHtml(user.avatar) : '';
    const handle = escapeHtml(user.handle || 'anonymous');
    const name = escapeHtml(user.name || user.handle || 'Anonymous');
    return `
    <div class="listener-item ${user.isHost ? 'is-host' : ''}"
         data-handle="${handle}" data-name="${name}" data-is-host="${user.isHost ? '1' : ''}">
      ${safeAvatar
        ? `<img class="listener-avatar" src="${safeAvatar}" alt="${handle}" loading="lazy">`
        : ''}
      <div class="listener-avatar-fallback" ${safeAvatar ? 'style="display:none"' : ''}>${escapeHtml((user.name || '?')[0].toUpperCase())}</div>
      ${user.isHost ? '<div class="listener-host-dot" title="Host"><i class="fa-solid fa-crown"></i></div>' : ''}
    </div>
  `;
  }).join('');

  // Handle avatar errors via JS instead of inline onerror
  container.querySelectorAll('.listener-avatar').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      const fallback = img.nextElementSibling;
      if (fallback) fallback.style.display = 'flex';
    });
  });

  // Create a single floating popup on document.body (fully outside sidebar overflow)
  const floatingPopup = document.createElement('div');
  floatingPopup.id = 'listener-floating-popup';
  floatingPopup.className = 'listener-popup';
  floatingPopup.innerHTML = `
    <div class="listener-popup-name"></div>
    <div class="listener-popup-handle"></div>
    <div class="listener-popup-host"></div>
    <a class="listener-popup-link" href="#" target="_blank" rel="noopener noreferrer">View on Audius</a>
  `;
  document.body.appendChild(floatingPopup);

  let popupHideTimer = null;

  function showPopup(item) {
    clearTimeout(popupHideTimer);
    const handle = item.dataset.handle;
    const name = item.dataset.name;
    const isHost = item.dataset.isHost === '1';
    const profileUrl = `https://audius.co/${handle}`;

    floatingPopup.querySelector('.listener-popup-name').textContent = name;
    floatingPopup.querySelector('.listener-popup-handle').textContent = '@' + handle;
    floatingPopup.querySelector('.listener-popup-host').innerHTML = isHost ? '<span class="host-badge">HOST</span>' : '';
    floatingPopup.querySelector('.listener-popup-link').href = profileUrl;

    floatingPopup.style.display = 'block';

    const rect = item.getBoundingClientRect();
    const popupW = floatingPopup.offsetWidth;
    const popupH = floatingPopup.offsetHeight;
    let left = rect.left + rect.width / 2 - popupW / 2;
    let top = rect.top - popupH - 14;

    if (left < 4) left = 4;
    if (left + popupW > window.innerWidth - 4) left = window.innerWidth - popupW - 4;
    if (top < 4) {
      top = rect.bottom + 14;
      floatingPopup.classList.add('below');
    } else {
      floatingPopup.classList.remove('below');
    }
    floatingPopup.style.left = left + 'px';
    floatingPopup.style.top = top + 'px';
  }

  function scheduleHide() {
    clearTimeout(popupHideTimer);
    popupHideTimer = setTimeout(() => {
      floatingPopup.style.display = 'none';
    }, 150);
  }

  // Keep popup visible while mouse is over it, hide when leaving
  floatingPopup.addEventListener('mouseenter', () => clearTimeout(popupHideTimer));
  floatingPopup.addEventListener('mouseleave', scheduleHide);

  container.querySelectorAll('.listener-item').forEach(item => {
    item.addEventListener('mouseenter', () => showPopup(item));
    item.addEventListener('mouseleave', scheduleHide);
  });
}

// ─── CHAT INPUT ─────────────────────────────────────────────

function setupChatInput() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!input) return;

  // Enforce max length on input
  input.maxLength = 500;

  const doSend = () => {
    const text = input.value.trim().slice(0, 500);
    if (text) {
      const user = getCurrentUser();
      const msg = {
        userId: user?.userId || 'anon',
        handle: user?.handle || 'Anonymous',
        name: user?.name || 'Anonymous',
        avatar: user?.profilePicture?.['150x150'] || null,
        text,
        gifUrl: null,
        timestamp: Date.now(),
      };
      sendMessage(text);
      if (currentRoomIdForChat) dbSaveChatMessage(currentRoomIdForChat, msg);
      input.value = '';
    }
  };

  if (sendBtn) sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
}

// ─── GIF PICKER ─────────────────────────────────────────────

function setupGifPicker() {
  const gifBtn = document.getElementById('gif-btn');
  const gifPanel = document.getElementById('gif-picker');
  const gifSearchInput = document.getElementById('gif-search-input');
  const gifSearchBtn = document.getElementById('gif-search-btn');
  const gifGrid = document.getElementById('gif-picker-grid');
  const gifTrendingTags = document.getElementById('gif-trending-tags');

  if (!gifBtn || !gifPanel) return;

  let gifPickerOpen = false;
  let gifLoading = false;
  let trendingTermsCache = null;

  function openGifPicker() {
    if (gifPickerOpen) return;
    gifPickerOpen = true;
    gifPanel.classList.remove('hidden');
    loadTrendingContent();
    if (gifSearchInput) {
      gifSearchInput.value = '';
      gifSearchInput.focus();
    }
  }

  function closeGifPicker() {
    if (!gifPickerOpen) return;
    gifPickerOpen = false;
    gifPanel.classList.add('hidden');
  }

  function onGifSelect(url, preview) {
    sendGif(url, preview);
    closeGifPicker();
  }

  async function loadTrendingContent() {
    if (gifLoading) return;
    gifLoading = true;
    gifGrid.innerHTML = '<div class="gif-loading">Loading GIFs...</div>';

    try {
      // Load trending terms and trending GIFs in parallel
      const [terms, gifs] = await Promise.all([
        trendingTermsCache || getTrendingTerms(),
        getTrendingGifs(),
      ]);
      trendingTermsCache = terms;
      renderTrendingTags(terms);
      renderGifPicker(gifs, onGifSelect);
    } catch {
      gifGrid.innerHTML = '<div class="gif-empty">Failed to load GIFs</div>';
    }
    gifLoading = false;
  }

  function renderTrendingTags(terms) {
    if (!gifTrendingTags || !terms.length) return;
    gifTrendingTags.innerHTML = terms.map(term =>
      `<button class="gif-trending-tag" data-term="${escapeHtml(term)}">${escapeHtml(term)}</button>`
    ).join('');

    gifTrendingTags.querySelectorAll('.gif-trending-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const term = tag.dataset.term;
        if (gifSearchInput) gifSearchInput.value = term;
        // Highlight active tag
        gifTrendingTags.querySelectorAll('.gif-trending-tag').forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        doSearch(term);
      });
    });
  }

  async function doSearch(query) {
    if (gifLoading) return;
    const trimmed = (query || '').trim();
    if (!trimmed) {
      loadTrendingContent();
      return;
    }
    gifLoading = true;
    gifGrid.innerHTML = '<div class="gif-loading">Searching...</div>';
    try {
      const results = await searchGifs(trimmed);
      renderGifPicker(results, onGifSelect);
    } catch {
      gifGrid.innerHTML = '<div class="gif-empty">Search failed</div>';
    }
    gifLoading = false;
  }

  // Toggle button
  gifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (gifPickerOpen) closeGifPicker();
    else openGifPicker();
  });

  // Search button click
  if (gifSearchBtn) {
    gifSearchBtn.addEventListener('click', () => {
      if (gifSearchInput) doSearch(gifSearchInput.value);
    });
  }

  // Search on Enter key
  if (gifSearchInput) {
    gifSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch(gifSearchInput.value);
      }
    });

    // Debounced live search as user types
    let searchTimeout = null;
    gifSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      // Clear active tag highlight
      if (gifTrendingTags) gifTrendingTags.querySelectorAll('.gif-trending-tag').forEach(t => t.classList.remove('active'));
      searchTimeout = setTimeout(() => {
        doSearch(gifSearchInput.value);
      }, 400);
    });
  }

  // Close GIF picker when clicking outside
  document.addEventListener('click', (e) => {
    if (gifPickerOpen && !gifPanel.contains(e.target) && !gifBtn.contains(e.target)) {
      closeGifPicker();
    }
  });

  // Prevent clicks inside the picker from bubbling and closing it
  gifPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

// ─── SONG REQUESTS ──────────────────────────────────────────

function requestSong(track) {
  const user = getCurrentUser();
  if (!user) return;

  broadcast('song-request', {
    track: {
      id: track.id,
      title: track.title,
      user: track.user ? { name: track.user.name, handle: track.user.handle } : null,
      artwork: track.artwork,
      duration: track.duration,
      genre: track.genre,
    },
    requestedBy: {
      userId: user.userId,
      handle: user.handle,
      name: user.name,
      avatar: user.profilePicture?.['150x150'] || null,
    },
    timestamp: Date.now(),
  });
}

function setupRequests() {
  // Render existing requests
  renderRequests();
}

function renderRequests() {
  const container = document.getElementById('requests-list');
  if (!container) return;

  if (songRequests.length === 0) {
    container.innerHTML = '<div class="empty-state">No song requests yet</div>';
    return;
  }

  container.innerHTML = songRequests.map((req, i) => `
    <div class="request-item">
      <div class="request-info">
        <span class="request-track">${escapeHtml(req.track.title)}</span>
        <span class="request-by">Requested by ${escapeHtml(req.requestedBy.name)}</span>
      </div>
      ${getIsHost() ? `
        <div class="request-actions">
          <button class="btn-sm btn-approve" data-index="${i}">Play</button>
          <button class="btn-sm btn-reject" data-index="${i}">Dismiss</button>
        </div>
      ` : ''}
    </div>
  `).join('');

  container.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      const req = songRequests[idx];
      if (req) {
        addToQueue(req.track);
        broadcast('request-response', { approved: true, track: req.track });
        songRequests.splice(idx, 1);
        renderRequests();
        showToast(`Added "${req.track.title}" from request`);
      }
    });
  });

  container.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.index);
      songRequests.splice(idx, 1);
      renderRequests();
    });
  });
}

// ─── MOBILE TABS ────────────────────────────────────────────

function setupMobileTabs() {
  const tabs = document.querySelectorAll('.mobile-tab');
  const chatPanel = document.querySelector('.panel-chat');
  const sidebarPanel = document.querySelector('.panel-sidebar');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Reset mobile overlays
      chatPanel?.classList.remove('mobile-active');
      sidebarPanel?.classList.remove('mobile-active');

      if (target === 'chat') {
        chatPanel?.classList.add('mobile-active');
      } else if (target === 'queue' || target === 'requests') {
        sidebarPanel?.classList.add('mobile-active');
        const section = sidebarPanel?.querySelector(`[data-panel="${target}"]`);
        if (section) section.scrollIntoView({ behavior: 'smooth' });
      }
      // 'player' = default, no overlay shown
    });
  });
}

// ─── LOBBY ANNOUNCEMENTS ────────────────────────────────────

function startAnnouncing(roomId) {
  const doAnnounce = () => {
    const user = getCurrentUser();
    const track = getCurrentTrack();
    const users = getUsers();
    announceRoom({
      roomId,
      hostName: user?.name || roomId,
      hostHandle: user?.handle || roomId,
      hostAvatar: user?.profilePicture?.['150x150'] || null,
      userCount: users.length,
      currentTrack: track ? { title: track.title, artist: track.user?.name || '' } : null,
    });
  };

  doAnnounce();
  announceInterval = setInterval(doAnnounce, 5000);

  // Save room to DB once on creation
  persistRoomToDB();
}

// Save current room state to database — called on meaningful changes only
function persistRoomToDB() {
  const roomId = getRoomId();
  if (!roomId || !getIsHost()) return;
  const user = getCurrentUser();
  const track = getCurrentTrack();
  const users = getUsers();
  dbSaveRoom({
    roomId,
    hostName: user?.name || roomId,
    hostHandle: user?.handle || roomId,
    hostAvatar: user?.profilePicture?.['150x150'] || null,
    userCount: users.length,
    currentTrack: track ? { title: track.title, artist: track.user?.name || '' } : null,
    playlist: getQueue(),
  });
}

function stopAnnouncing() {
  if (announceInterval) {
    clearInterval(announceInterval);
    announceInterval = null;
  }
  // Announce with 0 users to remove from active directory
  const roomId = getRoomId();
  if (roomId) {
    announceRoom({ roomId, userCount: 0 });
    dbUpdateRoomUserCount(roomId, 0);
  }
}

// ─── UTILS ──────────────────────────────────────────────────

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Leave room on page unload
window.addEventListener('beforeunload', () => {
  stopAnnouncing();
  leaveRoom();
});
