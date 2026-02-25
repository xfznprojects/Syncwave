import CONFIG from './config.js';
import { getStreamUrl, getTrack } from './audius.js';
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

export async function playTrack(track) {
  if (!audio) initPlayer();
  resumeAudioContext();

  currentTrack = track;
  const streamUrl = getStreamUrl(track.id);
  audio.src = streamUrl;
  audio.load();

  try {
    await audio.play();
  } catch (e) {
    console.warn('Autoplay blocked:', e);
  }

  startedAt = Date.now();

  if (listeners.onTrackChange) listeners.onTrackChange(track);
  if (listeners.onPlayStateChange) listeners.onPlayStateChange(true);

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
  };
}

export function destroy() {
  stopSyncLoop();
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
