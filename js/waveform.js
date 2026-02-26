import { getAnalyserLeft, getAnalyserRight, getAudioElement, getPlayState } from './player.js';
import { seek } from './player.js';
import { getIsHost } from './room.js';

let canvas = null;
let ctx = null;
let animationId = null;
let zoomLevel = 1.0;
let isDragging = false;
let dpr = window.devicePixelRatio || 1;

// Reusable typed array buffers
let dataLBuf = null;
let dataRBuf = null;
let freqLBuf = null;

// Colors
const COLOR_L = 'rgba(0, 240, 255, 0.7)';       // cyan for left
const COLOR_R = 'rgba(255, 0, 170, 0.7)';         // magenta for right
const COLOR_L_FILL = 'rgba(0, 240, 255, 0.08)';
const COLOR_R_FILL = 'rgba(255, 0, 170, 0.08)';
const COLOR_PLAYHEAD = 'rgba(255, 255, 255, 0.9)';
const COLOR_DIVIDER = 'rgba(90, 112, 144, 0.3)';
const COLOR_GRID = 'rgba(90, 112, 144, 0.1)';

export function initWaveform(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  setupInteraction();
}

function resizeCanvas() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
}

export function startWaveform() {
  if (animationId) return;
  drawLoop();
}

export function stopWaveform() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

function drawLoop() {
  animationId = requestAnimationFrame(drawLoop);
  draw();
}

function draw() {
  const analyserL = getAnalyserLeft();
  const analyserR = getAnalyserRight();
  if (!ctx || !canvas || !analyserL || !analyserR) return;

  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const halfH = h / 2;

  ctx.clearRect(0, 0, w, h);

  // Background grid
  drawGrid(w, h);

  // Reuse buffers — only reallocate if analyser size changed
  const bufferLength = analyserL.fftSize;
  if (!dataLBuf || dataLBuf.length !== bufferLength) {
    dataLBuf = new Uint8Array(bufferLength);
    dataRBuf = new Uint8Array(bufferLength);
  }
  if (!freqLBuf || freqLBuf.length !== analyserL.frequencyBinCount) {
    freqLBuf = new Uint8Array(analyserL.frequencyBinCount);
  }
  const dataL = dataLBuf;
  const dataR = dataRBuf;
  const freqL = freqLBuf;
  analyserL.getByteTimeDomainData(dataL);
  analyserR.getByteTimeDomainData(dataR);
  analyserL.getByteFrequencyData(freqL);

  // Compute dominant frequency for hue
  const hue = getDominantHue(freqL);

  // Apply zoom — show a portion of the buffer
  const visibleSamples = Math.floor(bufferLength / zoomLevel);
  const startSample = Math.floor((bufferLength - visibleSamples) / 2);
  const sliceWidth = w / visibleSamples;

  // Draw left channel (top half, going up from center)
  drawChannel(dataL, startSample, visibleSamples, sliceWidth, w, halfH, -1, hue, COLOR_L, COLOR_L_FILL);

  // Draw right channel (bottom half, going down from center)
  drawChannel(dataR, startSample, visibleSamples, sliceWidth, w, halfH, 1, hue, COLOR_R, COLOR_R_FILL);

  // Center divider line
  ctx.strokeStyle = COLOR_DIVIDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, halfH);
  ctx.lineTo(w, halfH);
  ctx.stroke();

  // Playhead
  drawPlayhead(w, h);

  // Labels
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
  ctx.fillText('L', 4, 12);
  ctx.fillStyle = 'rgba(255, 0, 170, 0.4)';
  ctx.fillText('R', 4, h - 4);
}

function drawChannel(data, startSample, visibleSamples, sliceWidth, w, halfH, direction, hue, strokeColor, fillColor) {
  // Direction: -1 = up from center (L), +1 = down from center (R)
  const baseY = halfH;

  // Fill area
  ctx.beginPath();
  ctx.moveTo(0, baseY);

  for (let i = 0; i < visibleSamples; i++) {
    const sample = data[startSample + i];
    const amplitude = Math.abs(sample - 128) / 128;
    const y = baseY + direction * amplitude * halfH * 0.85;
    const x = i * sliceWidth;
    if (i === 0) ctx.moveTo(x, baseY);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, baseY);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Stroke line with frequency-based coloring
  ctx.beginPath();
  for (let i = 0; i < visibleSamples; i++) {
    const sample = data[startSample + i];
    const amplitude = Math.abs(sample - 128) / 128;
    const y = baseY + direction * amplitude * halfH * 0.85;
    const x = i * sliceWidth;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.7)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Glow pass
  ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.15)`;
  ctx.lineWidth = 4;
  ctx.stroke();
}

function getDominantHue(freqData) {
  // Find the dominant frequency bin and map to hue
  // Low freq → warm amber (~30), mid → green/teal (~140), high → blue/violet (~260)
  let maxVal = 0;
  let maxIdx = 0;
  const len = Math.min(freqData.length, 512); // focus on lower half

  for (let i = 1; i < len; i++) {
    if (freqData[i] > maxVal) {
      maxVal = freqData[i];
      maxIdx = i;
    }
  }

  // Map bin index to hue: low bins → warm amber (30), high bins → blue-violet (260)
  const ratio = maxIdx / len;
  return 30 + ratio * 230;
}

function drawGrid(w, h) {
  ctx.strokeStyle = COLOR_GRID;
  ctx.lineWidth = 0.5;

  // Horizontal grid lines
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawPlayhead(w, h) {
  const state = getPlayState();
  if (!state.duration || state.duration <= 0) return;

  const pct = state.currentTime / state.duration;
  const x = pct * w;

  // Playhead line
  ctx.strokeStyle = COLOR_PLAYHEAD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();

  // Glow around playhead
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();

  // Small triangle marker at top
  ctx.fillStyle = COLOR_PLAYHEAD;
  ctx.beginPath();
  ctx.moveTo(x - 4, 0);
  ctx.lineTo(x + 4, 0);
  ctx.lineTo(x, 6);
  ctx.closePath();
  ctx.fill();
}

function setupInteraction() {
  if (!canvas) return;

  canvas.addEventListener('mousedown', (e) => {
    if (!getIsHost()) return;
    isDragging = true;
    seekToPosition(e);
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging || !getIsHost()) return;
    seekToPosition(e);
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
  });

  canvas.addEventListener('mouseleave', () => {
    isDragging = false;
  });

  // Touch support
  canvas.addEventListener('touchstart', (e) => {
    if (!getIsHost()) return;
    isDragging = true;
    seekToPosition(e.touches[0]);
    e.preventDefault();
  });

  canvas.addEventListener('touchmove', (e) => {
    if (!isDragging || !getIsHost()) return;
    seekToPosition(e.touches[0]);
    e.preventDefault();
  });

  canvas.addEventListener('touchend', () => {
    isDragging = false;
  });
}

function seekToPosition(e) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const state = getPlayState();
  if (state.duration > 0) {
    seek(Math.max(0, Math.min(1, pct)) * state.duration);
  }
}

export function zoomIn() {
  zoomLevel = Math.min(8, zoomLevel * 1.5);
  return zoomLevel;
}

export function zoomOut() {
  zoomLevel = Math.max(1, zoomLevel / 1.5);
  return zoomLevel;
}

export function getZoomLevel() {
  return zoomLevel;
}

export function destroy() {
  stopWaveform();
  window.removeEventListener('resize', resizeCanvas);
  canvas = null;
  ctx = null;
  zoomLevel = 1.0;
}
