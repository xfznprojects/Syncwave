import { getAnalyser, getAudioContext, getSampleRate } from './player.js';

let intervalId = null;
let onUpdateCallback = null;

// Rolling buffers for analysis
let energyBuffer = [];
const ENERGY_BUFFER_SIZE = 200; // ~20 seconds at 100ms intervals

// Reusable typed array buffers (avoid allocating every 100ms)
let freqDataBuf = null;
let timeDataBuf = null;

// BPM detection state
let lastBpm = null;
let bpmConfidence = 0;

// Key detection state
let chromaAccumulator = new Float32Array(12);
let chromaSamples = 0;
let lastKey = null;

// LUFS state
let lufsBuffer = [];
const LUFS_WINDOW = 30; // 3 seconds at 100ms

// Results
const results = {
  bpm: null,
  key: null,
  lufs: null,
  dr: null,
};

// Krumhansl-Kessler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function onAnalysisUpdate(callback) {
  onUpdateCallback = callback;
}

export function startAnalysis() {
  if (intervalId) return;
  resetState();
  intervalId = setInterval(analyze, 100);
}

export function stopAnalysis() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  resetState();
}

function resetState() {
  energyBuffer = [];
  lufsBuffer = [];
  chromaAccumulator = new Float32Array(12);
  chromaSamples = 0;
  lastBpm = null;
  bpmConfidence = 0;
  lastKey = null;
  results.bpm = null;
  results.key = null;
  results.lufs = null;
  results.dr = null;
}

export function getResults() {
  return { ...results };
}

function analyze() {
  const analyser = getAnalyser();
  if (!analyser) return;

  // Reuse buffers — only reallocate if analyser size changed
  if (!freqDataBuf || freqDataBuf.length !== analyser.frequencyBinCount) {
    freqDataBuf = new Uint8Array(analyser.frequencyBinCount);
  }
  if (!timeDataBuf || timeDataBuf.length !== analyser.fftSize) {
    timeDataBuf = new Uint8Array(analyser.fftSize);
  }
  const freqData = freqDataBuf;
  const timeData = timeDataBuf;
  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  // Check if there's actual audio (not silence)
  let hasSignal = false;
  for (let i = 0; i < timeData.length; i++) {
    if (Math.abs(timeData[i] - 128) > 3) { hasSignal = true; break; }
  }
  if (!hasSignal) return;

  // Energy for BPM
  const energy = computeEnergy(timeData);
  energyBuffer.push(energy);
  if (energyBuffer.length > ENERGY_BUFFER_SIZE) energyBuffer.shift();

  // BPM detection (need at least 4 seconds of data)
  if (energyBuffer.length >= 40) {
    detectBPM();
  }

  // Key detection via chromagram
  accumulateChroma(freqData);
  if (chromaSamples >= 50) { // ~5 seconds
    detectKey();
  }

  // LUFS
  computeLUFS(timeData);

  // Dynamic range
  computeDR(timeData);

  if (onUpdateCallback) onUpdateCallback(results);
}

function computeEnergy(timeData) {
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const sample = (timeData[i] - 128) / 128;
    sum += sample * sample;
  }
  return sum / timeData.length;
}

// BPM via autocorrelation of energy envelope
function detectBPM() {
  const buf = energyBuffer;
  const len = buf.length;

  // Normalize energy buffer
  let mean = 0;
  for (let i = 0; i < len; i++) mean += buf[i];
  mean /= len;

  const normalized = new Float32Array(len);
  for (let i = 0; i < len; i++) normalized[i] = buf[i] - mean;

  // Autocorrelation
  // At 100ms intervals: BPM 60 = lag 10, BPM 200 = lag 3
  const minLag = 3;   // 200 BPM
  const maxLag = Math.min(20, len - 1); // 30 BPM (capped)

  let bestLag = minLag;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < len - lag; i++) {
      corr += normalized[i] * normalized[i + lag];
      count++;
    }
    corr /= count;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Convert lag (in 100ms units) to BPM
  const intervalMs = bestLag * 100;
  const bpm = Math.round(60000 / intervalMs);

  // Only update if reasonable range
  if (bpm >= 60 && bpm <= 200) {
    // Smooth with previous reading
    if (lastBpm && Math.abs(bpm - lastBpm) < 20) {
      results.bpm = Math.round((lastBpm * 0.7 + bpm * 0.3));
      bpmConfidence = Math.min(1, bpmConfidence + 0.1);
    } else if (!lastBpm || bpmConfidence < 0.3) {
      results.bpm = bpm;
      bpmConfidence = 0.2;
    }
    lastBpm = results.bpm;
  }
}

// Build chromagram from frequency data
function accumulateChroma(freqData) {
  const sampleRate = getSampleRate();
  const binCount = freqData.length;
  const binHz = sampleRate / (binCount * 2); // fftSize = binCount * 2

  for (let i = 1; i < binCount; i++) {
    const magnitude = freqData[i] / 255;
    if (magnitude < 0.05) continue; // Skip very quiet bins

    const freq = i * binHz;
    if (freq < 65 || freq > 2000) continue; // Focus on musical range (C2 to B6)

    // Map frequency to chroma (0-11)
    const noteNum = 12 * Math.log2(freq / 440) + 69;
    const chroma = ((Math.round(noteNum) % 12) + 12) % 12;
    chromaAccumulator[chroma] += magnitude * magnitude;
  }
  chromaSamples++;
}

// Detect key using Krumhansl-Kessler profiles
function detectKey() {
  // Normalize chromagram
  let maxChroma = 0;
  for (let i = 0; i < 12; i++) {
    if (chromaAccumulator[i] > maxChroma) maxChroma = chromaAccumulator[i];
  }
  if (maxChroma === 0) return;

  const chroma = new Float32Array(12);
  for (let i = 0; i < 12; i++) chroma[i] = chromaAccumulator[i] / maxChroma;

  let bestCorr = -Infinity;
  let bestKey = 0;
  let bestMode = 'maj';

  // Test all 24 keys (12 major + 12 minor)
  for (let root = 0; root < 12; root++) {
    const corrMajor = correlate(chroma, MAJOR_PROFILE, root);
    const corrMinor = correlate(chroma, MINOR_PROFILE, root);

    if (corrMajor > bestCorr) {
      bestCorr = corrMajor;
      bestKey = root;
      bestMode = 'maj';
    }
    if (corrMinor > bestCorr) {
      bestCorr = corrMinor;
      bestKey = root;
      bestMode = 'min';
    }
  }

  results.key = `${NOTE_NAMES[bestKey]} ${bestMode}`;
  lastKey = results.key;

  // Slowly decay accumulator for responsiveness to key changes
  for (let i = 0; i < 12; i++) chromaAccumulator[i] *= 0.5;
  chromaSamples = Math.floor(chromaSamples * 0.5);
}

// Pearson correlation between rotated chroma and profile
function correlate(chroma, profile, root) {
  let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < 12; i++) {
    const x = chroma[(i + root) % 12];
    const y = profile[i];
    sumXY += x * y;
    sumX += x;
    sumY += y;
    sumX2 += x * x;
    sumY2 += y * y;
  }
  const n = 12;
  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

// LUFS approximation (simplified K-weighting)
function computeLUFS(timeData) {
  let meanSquare = 0;
  for (let i = 0; i < timeData.length; i++) {
    const sample = (timeData[i] - 128) / 128;
    meanSquare += sample * sample;
  }
  meanSquare /= timeData.length;

  lufsBuffer.push(meanSquare);
  if (lufsBuffer.length > LUFS_WINDOW) lufsBuffer.shift();

  // Average over window
  let avg = 0;
  for (let i = 0; i < lufsBuffer.length; i++) avg += lufsBuffer[i];
  avg /= lufsBuffer.length;

  if (avg > 0) {
    // Simplified LUFS: -0.691 + 10 * log10(meanSquare)
    // Scale factor to approximate real LUFS from 8-bit data
    const lufs = -0.691 + 10 * Math.log10(avg) - 10; // offset for 8-bit range
    results.lufs = Math.round(lufs * 10) / 10;
  }
}

// Dynamic range: peak-to-RMS ratio
function computeDR(timeData) {
  let peak = 0;
  let sumSquare = 0;

  for (let i = 0; i < timeData.length; i++) {
    const sample = Math.abs(timeData[i] - 128) / 128;
    if (sample > peak) peak = sample;
    sumSquare += sample * sample;
  }

  const rms = Math.sqrt(sumSquare / timeData.length);

  if (rms > 0.001 && peak > 0.001) {
    const dr = 20 * Math.log10(peak / rms);
    results.dr = Math.round(dr * 10) / 10;
  }
}

export function destroy() {
  stopAnalysis();
  onUpdateCallback = null;
}
