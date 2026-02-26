import { getAnalyser } from './player.js';

let canvas = null;
let ctx = null;
let animationId = null;
let mode = 'bars'; // 'bars', 'wave', 'circular'
const modes = ['bars', 'wave', 'circular'];
let dpr = window.devicePixelRatio || 1;
let dataArrayBuf = null;

export function initVisualizer(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) return;
  dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
}

export function startVisualizer() {
  if (animationId) return;
  draw();
}

export function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (ctx && canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function cycleMode() {
  const idx = modes.indexOf(mode);
  mode = modes[(idx + 1) % modes.length];
  return mode;
}

export function getMode() {
  return mode;
}

function draw() {
  animationId = requestAnimationFrame(draw);

  const analyser = getAnalyser();
  if (!analyser || !ctx || !canvas) return;

  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.clearRect(0, 0, w, h);

  const bufferLength = analyser.frequencyBinCount;
  if (!dataArrayBuf || dataArrayBuf.length !== bufferLength) {
    dataArrayBuf = new Uint8Array(bufferLength);
  }

  if (mode === 'bars') {
    drawBars(analyser, dataArrayBuf, bufferLength, w, h);
  } else if (mode === 'wave') {
    drawWave(analyser, dataArrayBuf, bufferLength, w, h);
  } else if (mode === 'circular') {
    drawCircular(analyser, dataArrayBuf, bufferLength, w, h);
  }
}

function drawBars(analyser, dataArray, bufferLength, w, h) {
  analyser.getByteFrequencyData(dataArray);

  const barCount = Math.min(bufferLength, 64);
  const barWidth = w / barCount;
  const gap = 2;

  for (let i = 0; i < barCount; i++) {
    const value = dataArray[i] / 255;
    const barHeight = value * h * 0.85;

    const hue = (200 + (i / barCount) * 260) % 360; // full spectrum gradient
    const lightness = 40 + value * 30;

    ctx.fillStyle = `hsla(${hue}, 90%, ${lightness}%, 0.9)`;
    ctx.fillRect(
      i * barWidth + gap / 2,
      h - barHeight,
      barWidth - gap,
      barHeight
    );

    // Reflection (uses same hue from above)
    ctx.fillStyle = `hsla(${hue}, 90%, ${lightness}%, 0.15)`;
    ctx.fillRect(
      i * barWidth + gap / 2,
      h,
      barWidth - gap,
      barHeight * 0.3
    );
  }
}

function drawWave(analyser, dataArray, bufferLength, w, h) {
  analyser.getByteTimeDomainData(dataArray);

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.8)';
  ctx.beginPath();

  const sliceWidth = w / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * h) / 2;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);

    x += sliceWidth;
  }

  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Glow effect
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
  ctx.beginPath();
  x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * h) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function drawCircular(analyser, dataArray, bufferLength, w, h) {
  analyser.getByteFrequencyData(dataArray);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.25;
  const barCount = Math.min(bufferLength, 80);

  for (let i = 0; i < barCount; i++) {
    const value = dataArray[i] / 255;
    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
    const barLength = value * radius * 1.5;

    const x1 = cx + Math.cos(angle) * radius;
    const y1 = cy + Math.sin(angle) * radius;
    const x2 = cx + Math.cos(angle) * (radius + barLength);
    const y2 = cy + Math.sin(angle) * (radius + barLength);

    const hue = (200 + (i / barCount) * 260) % 360; // full spectrum
    ctx.lineWidth = 3;
    ctx.strokeStyle = `hsla(${hue}, 90%, ${50 + value * 30}%, 0.8)`;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Inner circle glow
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(0, 240, 255, 0.12)');
  gradient.addColorStop(1, 'rgba(0, 240, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function destroy() {
  stopVisualizer();
  window.removeEventListener('resize', resizeCanvas);
  canvas = null;
  ctx = null;
}
