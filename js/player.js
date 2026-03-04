import CONFIG from './config.js';
import { getStreamUrl, getTrack, isTrackStreamable, getGateReason } from './audius.js';
import { broadcast, getIsHost } from './room.js';

let audio = null;
let audioContext = null;
let analyserNode = null;
let analyserL = null;
let analyserR = null;
let splitterNode = null;
let sourceNode = null;
let queue = [];
let currentIndex = -1;
let currentTrack = null;
let shuffleMode = false;
let startedAt = 0; // timestamp when track started playing
let syncInterval = null;

// Callbacks
const listeners = {
  onTrackChange: null,
  onPlayStateChange: null,
  onTimeUpdate: null,
  onQueueChange: null,
  onBuffering: null,
  onTrackSkipped: null,
};

export function onPlayerEvent(event, callback) {
  listeners[event] = callback;
}

export function initPlayer() {
  audio = document.getElementById('audio-player');
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'audio-player';
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    document.body.appendChild(audio);
  }

  audio.addEventListener('timeupdate', () => {
    if (listeners.onTimeUpdate) {
      listeners.onTimeUpdate({
        currentTime: audio.currentTime,
        duration: audio.duration || 0,
        playing: !audio.paused,
      });
    }
  });

  audio.addEventListener('ended', () => {
    playNext();
  });

  // Buffering state events
  audio.addEventListener('waiting', () => {
    if (listeners.onBuffering) listeners.onBuffering(true);
  });
  audio.addEventListener('loadstart', () => {
    if (listeners.onBuffering) listeners.onBuffering(true);
  });
  audio.addEventListener('canplay', () => {
    if (listeners.onBuffering) listeners.onBuffering(false);
  });
  audio.addEventListener('playing', () => {
    if (listeners.onBuffering) listeners.onBuffering(false);
  });
  audio.addEventListener('error', () => {
    if (listeners.onBuffering) listeners.onBuffering(false);
    // Ignore errors from empty src or audio unlock data URI
    if (!audio.src || audio.src === window.location.href || audio.src.startsWith('data:')) return;
    // Stream failed (gated track loaded from DB, deleted, etc.) — auto-skip
    if (currentTrack && queue.length > 1) {
      if (listeners.onTrackSkipped) listeners.onTrackSkipped(currentTrack, 'Stream unavailable');
      playNext();
    }
  });

  return audio;
}

// Web Audio API setup for visualizer + analysis
export function getAnalyser() {
  if (analyserNode) return analyserNode;
  if (!audio) return null;

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Main mono analyser (visualizer + analysis engine)
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    // Stereo channel splitter + per-channel analysers
    splitterNode = audioContext.createChannelSplitter(2);
    analyserL = audioContext.createAnalyser();
    analyserL.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0.8;
    analyserR = audioContext.createAnalyser();
    analyserR.fftSize = 2048;
    analyserR.smoothingTimeConstant = 0.8;

    splitterNode.connect(analyserL, 0);
    splitterNode.connect(analyserR, 1);

    // Source -> mono analyser -> destination
    // Source -> splitter -> L/R analysers (read-only taps, not to destination)
    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyserNode);
    sourceNode.connect(splitterNode);
    analyserNode.connect(audioContext.destination);
  } catch (e) {
    console.warn('Web Audio API not available:', e);
    return null;
  }

  return analyserNode;
}

export function getAnalyserLeft() { return analyserL; }
export function getAnalyserRight() { return analyserR; }
export function getAudioContext() { return audioContext; }
export function getAudioElement() { return audio; }
export function getSampleRate() { return audioContext?.sampleRate || 44100; }

export function resumeAudioContext() {
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

// iOS/mobile requires audio.play() within a user gesture to "unlock" the element.
// Play a tiny silent buffer so subsequent programmatic plays work.
let audioUnlocked = false;
const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
export function unlockAudio() {
  if (audioUnlocked || !audio || !isMobileDevice) return;
  audioUnlocked = true;

  // Unlock the HTML audio element with a silent play
  const prevSrc = audio.src;
  audio.muted = true;
  // Data URI: 0.1s silent WAV
  audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  const p = audio.play();
  if (p) p.then(() => {
    audio.pause();
    audio.muted = false;
    audio.src = prevSrc || '';
  }).catch(() => {
    audio.muted = false;
    audio.src = prevSrc || '';
  });

  // Also unlock AudioContext
  resumeAudioContext();
}

let skipCount = 0; // guards against infinite skip loops

export async function playTrack(track) {
  if (!audio) initPlayer();
  resumeAudioContext();

  // Check if track is gated/restricted — skip to next if so
  if (!isTrackStreamable(track)) {
    const reason = getGateReason(track);
    if (listeners.onTrackSkipped) listeners.onTrackSkipped(track, reason);

    skipCount++;
    if (skipCount >= queue.length) {
      // Every track in the queue is restricted — stop trying
      skipCount = 0;
      if (listeners.onTrackSkipped) listeners.onTrackSkipped(null, 'All tracks in queue are restricted');
      return;
    }

    // Advance to next track
    if (queue.length > 1) {
      if (shuffleMode) {
        let next;
        do { next = Math.floor(Math.random() * queue.length); } while (next === currentIndex && queue.length > 1);
        currentIndex = next;
      } else {
        currentIndex = (currentIndex + 1) % queue.length;
      }
      playTrack(queue[currentIndex]);
    }
    return;
  }
  skipCount = 0;

  // Pause current playback before switching to avoid play() interruption
  if (!audio.paused) audio.pause();

  // Show buffering state immediately (before async load)
  if (listeners.onBuffering) listeners.onBuffering(true);

  currentTrack = track;
  const streamUrl = getStreamUrl(track.id);
  audio.src = streamUrl;
  audio.load();

  startedAt = Date.now();

  if (listeners.onTrackChange) listeners.onTrackChange(track);
  if (listeners.onPlayStateChange) listeners.onPlayStateChange(true);

  try {
    await audio.play();
    // Playback started — clear buffering
    if (listeners.onBuffering) listeners.onBuffering(false);
  } catch (e) {
    if (listeners.onBuffering) listeners.onBuffering(false);
    // AbortError = interrupted by another play/pause call (harmless race condition)
    if (e.name !== 'AbortError') {
      console.warn('Autoplay blocked:', e);
    }
  }

  // If host, broadcast to room
  if (getIsHost()) {
    broadcastSync();
    startSyncLoop();
    broadcast('track-change', {
      track: serializeTrack(track),
      startedAt,
    });
  }
}

export function play() {
  if (!audio) return;
  resumeAudioContext();
  audio.play();
  startedAt = Date.now() - (audio.currentTime * 1000);
  if (listeners.onPlayStateChange) listeners.onPlayStateChange(true);
  if (getIsHost()) broadcastSync();
}

export function pause() {
  if (!audio) return;
  audio.pause();
  if (listeners.onPlayStateChange) listeners.onPlayStateChange(false);
  if (getIsHost()) broadcastSync();
}

export function togglePlay() {
  if (audio?.paused) play();
  else pause();
}

export function seek(time) {
  if (!audio) return;
  audio.currentTime = time;
  startedAt = Date.now() - (time * 1000);
  if (getIsHost()) broadcastSync();
}

export function setVolume(vol) {
  if (!audio) return;
  audio.volume = Math.max(0, Math.min(1, vol));
}

export function getVolume() {
  return audio ? audio.volume : 1;
}

export function getCurrentTrack() {
  return currentTrack;
}

export function getPlayState() {
  return {
    playing: audio ? !audio.paused : false,
    currentTime: audio?.currentTime || 0,
    duration: audio?.duration || 0,
  };
}

// Queue management
export function getQueue() {
  return queue;
}

export function getCurrentIndex() {
  return currentIndex;
}

export function addToQueue(track) {
  queue.push(track);
  // If nothing is playing yet, start playing the first track
  if (currentIndex === -1) {
    currentIndex = 0;
    playTrack(queue[0]);
  }
  if (listeners.onQueueChange) listeners.onQueueChange(queue, currentIndex);
  if (getIsHost()) {
    broadcastSync();
  }
}

export function removeFromQueue(index) {
  queue.splice(index, 1);
  if (index < currentIndex) currentIndex--;
  if (index === currentIndex) {
    if (queue.length > 0) {
      currentIndex = Math.min(currentIndex, queue.length - 1);
      playTrack(queue[currentIndex]);
    } else {
      currentIndex = -1;
      currentTrack = null;
      if (audio) { audio.pause(); audio.src = ''; }
    }
  }
  if (listeners.onQueueChange) listeners.onQueueChange(queue, currentIndex);
}

export function clearQueue() {
  queue = [];
  currentIndex = -1;
  if (listeners.onQueueChange) listeners.onQueueChange(queue, currentIndex);
}

export function moveInQueue(fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return;
  const [item] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, item);

  // Adjust currentIndex to follow the currently playing track
  if (currentIndex === fromIndex) {
    currentIndex = toIndex;
  } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
    currentIndex--;
  } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
    currentIndex++;
  }

  if (listeners.onQueueChange) listeners.onQueueChange(queue, currentIndex);
  if (getIsHost()) broadcastSync();
}

export function playFromQueue(index) {
  if (index >= 0 && index < queue.length) {
    currentIndex = index;
    playTrack(queue[index]);
  }
}

// Load a full queue from imported data
export function loadQueueFromData(tracks, startPlaying = false) {
  queue = tracks;
  currentIndex = tracks.length > 0 ? 0 : -1;
  if (listeners.onQueueChange) listeners.onQueueChange(queue, currentIndex);
  if (startPlaying && queue.length > 0) {
    playTrack(queue[0]);
  }
  if (getIsHost()) broadcastSync();
}

export function playNext() {
  if (queue.length === 0) return;

  if (shuffleMode) {
    const remaining = queue.length - 1;
    if (remaining <= 0) { currentIndex = 0; }
    else {
      let next;
      do { next = Math.floor(Math.random() * queue.length); } while (next === currentIndex);
      currentIndex = next;
    }
  } else {
    currentIndex = (currentIndex + 1) % queue.length;
  }

  playTrack(queue[currentIndex]);
}

export function playPrevious() {
  if (queue.length === 0) return;
  // If more than 3s into track, restart it
  if (audio && audio.currentTime > 3) {
    seek(0);
    return;
  }
  currentIndex = (currentIndex - 1 + queue.length) % queue.length;
  playTrack(queue[currentIndex]);
}

export function toggleShuffle() {
  shuffleMode = !shuffleMode;
  return shuffleMode;
}

export function isShuffled() {
  return shuffleMode;
}

// ─── DETERMINISTIC SYNC (hostless rooms) ────────────────────
// All clients independently calculate the same playback position from a shared
// reference timestamp. No host broadcasts needed — everyone stays in sync by math.
let deterministicInterval = null;
let deterministicRef = null; // { time, trackIndex, position }
let lastHostSyncTime = 0;

// Pure calculation: given "at refTime, playlist was at startIndex:startPosition",
// calculate where playback should be NOW (accounting for looping).
export function calculateDeterministicPosition(tracks, refTime, startIndex = 0, startPosition = 0) {
  if (!tracks || tracks.length === 0) return null;

  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 180), 0);
  if (totalDuration <= 0) return null;

  const elapsed = (Date.now() - refTime) / 1000;

  // Convert to absolute playlist time: sum of durations before startIndex + startPosition + elapsed
  let absTime = startPosition + elapsed;
  for (let i = 0; i < startIndex && i < tracks.length; i++) {
    absTime += tracks[i]?.duration || 180;
  }

  // Wrap for looping
  absTime = ((absTime % totalDuration) + totalDuration) % totalDuration;

  // Walk playlist to find track and position within it
  let cumulative = 0;
  for (let i = 0; i < tracks.length; i++) {
    const dur = tracks[i]?.duration || 180;
    if (absTime < cumulative + dur) {
      return { trackIndex: i, position: absTime - cumulative };
    }
    cumulative += dur;
  }
  return { trackIndex: 0, position: 0 };
}

export function startDeterministicSync(refTime, startIndex = 0, startPosition = 0) {
  stopDeterministicSync();
  deterministicRef = { time: refTime, trackIndex: startIndex, position: startPosition };

  // Apply immediately, then correct drift periodically
  applyDeterministicPosition();
  deterministicInterval = setInterval(applyDeterministicPosition, CONFIG.SYNC_INTERVAL_MS);
}

export function stopDeterministicSync() {
  if (deterministicInterval) {
    clearInterval(deterministicInterval);
    deterministicInterval = null;
  }
  deterministicRef = null;
}

async function applyDeterministicPosition() {
  if (!deterministicRef || getIsHost()) return;
  // Defer to live host if one has synced recently
  if (Date.now() - lastHostSyncTime < CONFIG.SYNC_INTERVAL_MS * 2) return;
  if (queue.length === 0) return;

  const pos = calculateDeterministicPosition(
    queue, deterministicRef.time, deterministicRef.trackIndex, deterministicRef.position
  );
  if (!pos) return;

  if (!audio) initPlayer();
  resumeAudioContext();

  const needsTrackSwitch = currentIndex !== pos.trackIndex || !currentTrack;

  if (needsTrackSwitch) {
    // Switch to the correct track
    if (!audio.paused) audio.pause();
    if (listeners.onBuffering) listeners.onBuffering(true);
    currentIndex = pos.trackIndex;
    currentTrack = queue[pos.trackIndex];
    audio.src = getStreamUrl(currentTrack.id);
    audio.load();
    startedAt = Date.now() - (pos.position * 1000);

    if (listeners.onTrackChange) listeners.onTrackChange(currentTrack);
    if (listeners.onPlayStateChange) listeners.onPlayStateChange(true);

    const seekPos = pos.position;
    try {
      await audio.play();
      if (listeners.onBuffering) listeners.onBuffering(false);
      // Seek after playback starts
      if (seekPos > 0) {
        if (audio.readyState >= 2 && audio.duration && seekPos < audio.duration) {
          audio.currentTime = seekPos;
        } else {
          audio.addEventListener('loadedmetadata', () => {
            if (seekPos < audio.duration) audio.currentTime = seekPos;
          }, { once: true });
        }
      }
    } catch (e) {
      if (listeners.onBuffering) listeners.onBuffering(false);
      if (e.name !== 'AbortError') console.warn('Deterministic sync autoplay blocked:', e);
    }
  } else if (!audio.paused) {
    // Right track, playing — correct drift if needed
    const drift = Math.abs(audio.currentTime - pos.position);
    if (drift > CONFIG.DRIFT_THRESHOLD_MS / 1000) {
      audio.currentTime = pos.position;
      startedAt = Date.now() - (pos.position * 1000);
    }
  } else if (currentTrack) {
    // Right track but paused (autoplay blocked?) — try resuming
    audio.currentTime = pos.position;
    startedAt = Date.now() - (pos.position * 1000);
    try { await audio.play(); } catch { /* autoplay blocked */ }
    if (listeners.onPlayStateChange) listeners.onPlayStateChange(!audio.paused);
  }
}

// ─── HOST SYNC ──────────────────────────────────────────────
// Sync: host broadcasts current state
function broadcastSync() {
  broadcast('sync', {
    trackId: currentTrack?.id || null,
    track: currentTrack ? serializeTrack(currentTrack) : null,
    startedAt,
    currentTime: audio?.currentTime || 0,
    isPlaying: audio ? !audio.paused : false,
    queue: queue.map(serializeTrack),
    currentIndex,
  });
}

function startSyncLoop() {
  stopSyncLoop();
  syncInterval = setInterval(() => {
    if (getIsHost() && currentTrack) {
      broadcastSync();
    }
  }, CONFIG.SYNC_INTERVAL_MS);
}

export function stopSyncLoop() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// Listener: handle sync messages from host
export async function handleSync(data) {
  if (getIsHost()) return; // host doesn't sync to itself
  lastHostSyncTime = Date.now();

  // Keep deterministic reference in sync with host state so that if
  // the host leaves, deterministic sync continues from the right position.
  if (deterministicRef && data.currentIndex != null) {
    deterministicRef = {
      time: Date.now(),
      trackIndex: data.currentIndex,
      position: data.currentTime || 0,
    };
  }

  // Update queue if provided
  if (data.queue) {
    queue = data.queue;
    currentIndex = data.currentIndex ?? -1;
    if (listeners.onQueueChange) listeners.onQueueChange(queue, currentIndex);
  }

  // If track changed, load it
  if (data.track && (!currentTrack || currentTrack.id !== data.track.id)) {
    currentTrack = data.track;
    if (!audio) initPlayer();
    resumeAudioContext();
    if (listeners.onBuffering) listeners.onBuffering(true);
    audio.src = getStreamUrl(data.track.id);
    audio.load();
    if (listeners.onTrackChange) listeners.onTrackChange(currentTrack);
  }

  if (!audio) return;

  // Sync playback state
  if (data.isPlaying && audio.paused) {
    try { await audio.play(); } catch (e) { /* autoplay blocked */ }
    if (listeners.onPlayStateChange) listeners.onPlayStateChange(true);
  } else if (!data.isPlaying && !audio.paused) {
    audio.pause();
    if (listeners.onPlayStateChange) listeners.onPlayStateChange(false);
  }

  // Correct drift
  if (data.isPlaying && data.startedAt) {
    const expectedTime = (Date.now() - data.startedAt) / 1000;
    const drift = Math.abs(audio.currentTime - expectedTime);
    if (drift > CONFIG.DRIFT_THRESHOLD_MS / 1000) {
      audio.currentTime = expectedTime;
    }
  } else if (!data.isPlaying && data.currentTime !== undefined) {
    audio.currentTime = data.currentTime;
  }
}

// Handle track change broadcast from host
export async function handleTrackChange(data) {
  if (getIsHost()) return;
  lastHostSyncTime = Date.now();
  if (data.track) {
    await playTrack(data.track);
    if (data.startedAt) {
      const elapsed = (Date.now() - data.startedAt) / 1000;
      if (audio && elapsed > 0) audio.currentTime = elapsed;
    }
  }
  if (data.queue) {
    queue = data.queue;
    currentIndex = data.currentIndex ?? -1;
    if (listeners.onQueueChange) listeners.onQueueChange(queue, currentIndex);
  }
}

function serializeTrack(track) {
  return {
    id: track.id,
    title: track.title,
    user: track.user ? { name: track.user.name, handle: track.user.handle, id: track.user.id } : null,
    artwork: track.artwork || null,
    duration: track.duration || 0,
    genre: track.genre || '',
    mood: track.mood || '',
    tags: track.tags || '',
  };
}

export function destroy() {
  stopSyncLoop();
  stopDeterministicSync();
  if (audio) {
    audio.pause();
    audio.src = '';
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
    analyserNode = null;
    analyserL = null;
    analyserR = null;
    splitterNode = null;
    sourceNode = null;
  }
  queue = [];
  currentIndex = -1;
  currentTrack = null;
}
