import CONFIG from './config.js';
import { searchTracks, getTrending, getArtworkUrl, setArtworkWithFallback, getUserTracks, getUserFavorites } from './audius.js';
import { initAuth, getCurrentUser, isLoggedIn, loginWithAudius, logout } from './auth.js';
import {
  createRoom, joinRoom, leaveRoom, broadcast, onRoomEvent,
  getIsHost, getRoomId, getUsers, joinLobby, leaveLobby, onLobbyUpdate, announceRoom,
} from './room.js';
import {
  initPlayer, playTrack, play, pause, togglePlay, seek,
  getCurrentTrack, getPlayState, getQueue, addToQueue, removeFromQueue,
  playNext, playPrevious, playFromQueue, toggleShuffle, isShuffled,
  onPlayerEvent, handleSync, handleTrackChange, getAnalyser, resumeAudioContext,
  stopSyncLoop, destroy as destroyPlayer, setVolume, getVolume,
} from './player.js';
import { initVisualizer, startVisualizer, stopVisualizer, cycleMode, getMode, destroy as destroyVis } from './visualizer.js';
import {
  initChat, sendMessage, sendGif, handleIncomingMessage, clearChat,
  searchGifs, getTrendingGifs, renderGifPicker, setupGifSearch,
} from './chat.js';

// Song requests
let songRequests = [];

// Lobby announce interval
let announceInterval = null;

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

  // Room events
  onRoomEvent('onSync', handleSync);
  onRoomEvent('onChat', handleIncomingMessage);
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
    // If room is empty (only us) and we're host, pause
    if (getIsHost() && users.length <= 1) {
      // Keep playing — host is still here
    }
  });

  // Player events
  onPlayerEvent('onTrackChange', (track) => {
    renderNowPlaying(track);
    startVisualizer();
  });
  onPlayerEvent('onPlayStateChange', (playing) => {
    updatePlayButton(playing);
    if (playing) startVisualizer();
    else stopVisualizer();
  });
  onPlayerEvent('onTimeUpdate', (state) => {
    updateProgress(state);
  });
  onPlayerEvent('onQueueChange', (queue, idx) => {
    renderQueue(queue, idx);
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
  }
}

// ─── AUTH UI ────────────────────────────────────────────────

function renderAuthUI() {
  const authBtn = document.getElementById('auth-btn');
  const authAvatar = document.getElementById('auth-avatar');
  const authName = document.getElementById('auth-name');
  const user = getCurrentUser();

  if (user) {
    authBtn.textContent = 'Logout';
    authBtn.onclick = () => { logout(); renderAuthUI(); };
    authName.textContent = user.name;
    authName.classList.remove('hidden');
    if (user.profilePicture?.['150x150']) {
      authAvatar.src = user.profilePicture['150x150'];
      authAvatar.classList.remove('hidden');
    }
  } else {
    authBtn.textContent = 'Log In with Audius';
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
  }
}

// ─── HOME VIEW ──────────────────────────────────────────────

function renderRoomDirectory(rooms) {
  const grid = document.getElementById('room-grid');
  if (!grid) return;

  if (!rooms || rooms.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <p>No active rooms right now</p>
      <p>Log in with Audius to create one!</p>
    </div>`;
    return;
  }

  grid.innerHTML = rooms.map(room => `
    <div class="room-card" data-room="${escapeHtml(room.roomId)}">
      <div class="room-card-header">
        ${room.hostAvatar
          ? `<img class="room-host-avatar" src="${escapeHtml(room.hostAvatar)}" alt="${escapeHtml(room.hostName)}">`
          : `<div class="room-host-avatar-fallback">${(room.hostName || '?')[0].toUpperCase()}</div>`}
        <div class="room-host-info">
          <span class="room-host-name">${escapeHtml(room.hostName || room.roomId)}</span>
          <span class="room-listener-count">${room.userCount} listener${room.userCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
      ${room.currentTrack ? `
        <div class="room-now-playing">
          <span class="room-track-title">${escapeHtml(room.currentTrack.title)}</span>
          <span class="room-track-artist">${escapeHtml(room.currentTrack.artist)}</span>
        </div>
      ` : '<div class="room-now-playing"><span class="room-track-title">No track playing</span></div>'}
    </div>
  `).join('');

  grid.querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      navigate(`#/room/${card.dataset.room}`);
    });
  });
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
  const user = getCurrentUser();
  const isCreator = user && user.handle === roomId;

  // Init chat
  const chatMessages = document.getElementById('chat-messages');
  const gifPicker = document.getElementById('gif-picker-grid');
  initChat(chatMessages, gifPicker);
  clearChat();

  // Init visualizer
  const canvas = document.getElementById('visualizer-canvas');
  if (canvas) initVisualizer(canvas);

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

  // Update room header
  document.getElementById('room-title').textContent = `${roomId}'s Room`;

  // Show/hide host controls
  const hostControls = document.querySelectorAll('.host-only');
  hostControls.forEach(el => {
    el.style.display = getIsHost() ? '' : 'none';
  });

  // Load trending tracks for search default
  loadTrending();

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

  // Start lobby announcements if host
  if (getIsHost()) {
    startAnnouncing(roomId);
  }

  // Reset song requests
  songRequests = [];
  renderRequests();
}

function exitRoom() {
  stopAnnouncing();
  leaveRoom();
  stopSyncLoop();
  stopVisualizer();
  clearChat();
  songRequests = [];
}

// ─── SEARCH WITH TABS ───────────────────────────────────────

let searchTimeout = null;
let activeSearchTab = 'trending';

function setupSearch() {
  const input = document.getElementById('search-input');
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

      // Show/hide search input
      if (input) input.style.display = activeSearchTab === 'search' ? '' : 'none';

      // Load content for tab
      if (activeSearchTab === 'trending') loadTrending();
      else if (activeSearchTab === 'search') { input.focus(); if (input.value.trim()) triggerSearch(input.value.trim()); }
      else if (activeSearchTab === 'mytracks') loadMyTracks();
      else if (activeSearchTab === 'favorites') loadFavorites();
    });
  });

  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        triggerSearch(input.value.trim());
      }, 300);
    });
  }
}

async function triggerSearch(query) {
  if (query.length >= 2) {
    const results = await searchTracks(query);
    renderSearchResults(results, 'Search Results');
  }
}

async function loadTrending() {
  try {
    const trending = await getTrending();
    renderSearchResults(trending, 'Trending on Audius');
  } catch { /* optional */ }
}

async function loadMyTracks() {
  const user = getCurrentUser();
  if (!user) return;
  try {
    const tracks = await getUserTracks(user.userId);
    renderSearchResults(tracks, 'My Tracks');
  } catch { renderSearchResults([], 'My Tracks'); }
}

async function loadFavorites() {
  const user = getCurrentUser();
  if (!user) return;
  try {
    const favs = await getUserFavorites(user.userId);
    // Favorites API wraps tracks in a `favorite_item` — extract the track
    const tracks = favs.map(f => f.favorite_item || f).filter(t => t.id);
    renderSearchResults(tracks, 'Favorites');
  } catch { renderSearchResults([], 'Favorites'); }
}

function renderSearchResults(tracks, label = 'Search Results') {
  const container = document.getElementById('search-results');
  if (!container) return;

  if (!tracks || tracks.length === 0) {
    container.innerHTML = '<div class="empty-state">No tracks found</div>';
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
          <button class="btn-icon btn-play-now" title="Play now">&#9654;</button>
          <button class="btn-icon btn-add-queue" title="Add to queue">+</button>
        ` : isLoggedIn() ? `
          <button class="btn-icon btn-request" title="Request song">&#9996;</button>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Apply artwork fallback
  container.querySelectorAll('.track-item').forEach((item, i) => {
    const img = item.querySelector('.track-artwork');
    if (img && tracks[i]) setArtworkWithFallback(img, tracks[i], '150x150');
  });

  // Event handlers
  container.querySelectorAll('.btn-play-now').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasEmpty = getQueue().length === 0;
      addToQueue(tracks[i]);
      // Only force-play if nothing was playing; otherwise addToQueue handles auto-start
      if (wasEmpty) {
        playFromQueue(0);
      } else {
        showToast(`Added "${tracks[i].title}" — plays next`);
      }
    });
  });

  container.querySelectorAll('.btn-add-queue').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addToQueue(tracks[i]);
      showToast(`Added "${tracks[i].title}" to queue`);
    });
  });

  container.querySelectorAll('.btn-request').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestSong(tracks[i]);
      showToast(`Requested "${tracks[i].title}"`);
    });
  });
}

// ─── NOW PLAYING ────────────────────────────────────────────

function renderNowPlaying(track) {
  const artwork = document.getElementById('np-artwork');
  const title = document.getElementById('np-title');
  const artist = document.getElementById('np-artist');

  if (track) {
    if (artwork) setArtworkWithFallback(artwork, track, '480x480');
    if (title) title.textContent = track.title || 'Unknown Track';
    if (artist) artist.textContent = track.user?.name || track.user?.handle || 'Unknown Artist';
  } else {
    if (artwork) artwork.src = '';
    if (title) title.textContent = 'No track playing';
    if (artist) artist.textContent = '';
  }
}

function updatePlayButton(playing) {
  const btn = document.getElementById('btn-playpause');
  if (btn) btn.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
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
  const shuffleBtn = document.getElementById('btn-shuffle');
  const vizBtn = document.getElementById('btn-viz-mode');
  const progressBar = document.getElementById('progress-bar');
  const volumeSlider = document.getElementById('volume-slider');
  const muteBtn = document.getElementById('btn-mute');

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      resumeAudioContext();
      togglePlay();
    });
  }
  if (prevBtn) prevBtn.addEventListener('click', playPrevious);
  if (nextBtn) nextBtn.addEventListener('click', playNext);

  if (shuffleBtn) {
    shuffleBtn.addEventListener('click', () => {
      const shuffled = toggleShuffle();
      shuffleBtn.classList.toggle('active', shuffled);
      showToast(shuffled ? 'Shuffle on' : 'Shuffle off');
    });
  }

  if (vizBtn) {
    vizBtn.addEventListener('click', () => {
      const mode = cycleMode();
      showToast(`Visualizer: ${mode}`);
    });
  }

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
      if (muteBtn) muteBtn.innerHTML = vol === 0 ? '&#128263;' : vol < 0.5 ? '&#128265;' : '&#128264;';
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      const current = getVolume();
      if (current > 0) {
        savedVolume = current;
        setVolume(0);
        if (volumeSlider) volumeSlider.value = 0;
        muteBtn.innerHTML = '&#128263;';
      } else {
        setVolume(savedVolume || 0.8);
        if (volumeSlider) volumeSlider.value = Math.round((savedVolume || 0.8) * 100);
        muteBtn.innerHTML = savedVolume < 0.5 ? '&#128265;' : '&#128264;';
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

// ─── QUEUE ──────────────────────────────────────────────────

function renderQueue(queue, currentIndex) {
  const container = document.getElementById('queue-list');
  if (!container) return;

  if (!queue || queue.length === 0) {
    container.innerHTML = '<div class="empty-state">Queue is empty</div>';
    return;
  }

  container.innerHTML = queue.map((track, i) => `
    <div class="queue-item ${i === currentIndex ? 'queue-active' : ''}" data-index="${i}">
      <span class="queue-number">${i + 1}</span>
      <div class="queue-track-info">
        <span class="queue-track-title">${escapeHtml(track.title)}</span>
        <span class="queue-track-artist">${escapeHtml(track.user?.name || '')}</span>
      </div>
      ${getIsHost() ? `<button class="btn-icon btn-remove-queue" data-index="${i}" title="Remove">&times;</button>` : ''}
    </div>
  `).join('');

  container.querySelectorAll('.queue-item').forEach(item => {
    item.addEventListener('click', () => {
      if (getIsHost()) playFromQueue(parseInt(item.dataset.index));
    });
  });

  container.querySelectorAll('.btn-remove-queue').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(parseInt(btn.dataset.index));
    });
  });
}

// ─── LISTENERS ──────────────────────────────────────────────

function renderListeners(users) {
  const container = document.getElementById('listeners-list');
  const countEl = document.getElementById('listener-count');
  if (!container) return;

  if (countEl) countEl.textContent = users.length;

  container.innerHTML = users.map(user => `
    <div class="listener-item">
      ${user.avatar
        ? `<img class="listener-avatar" src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.handle)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="listener-avatar-fallback" ${user.avatar ? 'style="display:none"' : ''}>${(user.name || '?')[0].toUpperCase()}</div>
      <span class="listener-name">${escapeHtml(user.name || user.handle)}</span>
      ${user.isHost ? '<span class="host-badge">HOST</span>' : ''}
    </div>
  `).join('');
}

// ─── CHAT INPUT ─────────────────────────────────────────────

function setupChatInput() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!input) return;

  const doSend = () => {
    const text = input.value.trim();
    if (text) {
      sendMessage(text);
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
  const gifGrid = document.getElementById('gif-picker-grid');

  if (!gifBtn || !gifPanel) return;

  gifBtn.addEventListener('click', async () => {
    gifPanel.classList.toggle('hidden');
    if (!gifPanel.classList.contains('hidden')) {
      const trending = await getTrendingGifs();
      renderGifPicker(trending, (url, preview) => {
        sendGif(url, preview);
        gifPanel.classList.add('hidden');
      });
    }
  });

  if (gifSearchInput) {
    setupGifSearch(gifSearchInput, (results) => {
      renderGifPicker(results, (url, preview) => {
        sendGif(url, preview);
        gifPanel.classList.add('hidden');
      });
    });
  }

  // Close GIF picker when clicking outside
  document.addEventListener('click', (e) => {
    if (gifPanel && !gifPanel.contains(e.target) && e.target !== gifBtn) {
      gifPanel.classList.add('hidden');
    }
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
      hostAvatar: user?.profilePicture?.['150x150'] || null,
      userCount: users.length,
      currentTrack: track ? { title: track.title, artist: track.user?.name || '' } : null,
    });
  };

  doAnnounce();
  announceInterval = setInterval(doAnnounce, 5000);
}

function stopAnnouncing() {
  if (announceInterval) {
    clearInterval(announceInterval);
    announceInterval = null;
  }
  // Announce with 0 users to remove from directory
  const roomId = getRoomId();
  if (roomId) {
    announceRoom({ roomId, userCount: 0 });
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
