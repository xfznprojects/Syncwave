/**
 * SyncWave — Genre/Mood → Visualizer Parameter Mapping
 * Maps Audius track metadata (genre, mood, tags) to 3D visualizer parameters.
 * Uses hue ranges instead of static palettes for dynamic, breathing colors.
 */

// ─── HSL UTILITIES ──────────────────────────────────────

export function hslToRGB(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}

export function hslToRGB255(h, s, l) {
  const [r, g, b] = hslToRGB(h, s, l);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function hslToHex(h, s, l) {
  const [r, g, b] = hslToRGB255(h, s, l);
  return (r << 16) | (g << 8) | b;
}

// ─── GENRE ENERGY SCORES (0 = calm, 1 = intense) ────────

const GENRE_ENERGY = {
  // High energy (0.8 - 1.0)
  'Dubstep': 0.95,
  'Drum & Bass': 0.95,
  'Hardstyle': 1.0,
  'Techno': 0.85,
  'Trap': 0.85,
  'Metal': 0.95,
  'Punk': 0.9,
  'Glitch Hop': 0.85,

  // Medium-high (0.6 - 0.8)
  'House': 0.7,
  'Tech House': 0.7,
  'Trance': 0.75,
  'Electronic': 0.65,
  'Electro': 0.7,
  'EDM': 0.75,
  'Dance': 0.7,
  'Progressive House': 0.65,
  'Rock': 0.7,
  'Hip-Hop/Rap': 0.65,
  'Disco': 0.6,

  // Medium (0.4 - 0.6)
  'Pop': 0.5,
  'Alternative': 0.55,
  'Latin': 0.55,
  'R&B/Soul': 0.45,
  'Funk': 0.55,
  'Experimental': 0.5,
  'Reggae': 0.45,
  'Country': 0.45,
  'Spoken Word': 0.3,

  // Low energy (0.0 - 0.4)
  'Ambient': 0.15,
  'Downtempo': 0.25,
  'Lo-Fi': 0.2,
  'Classical': 0.3,
  'Jazz': 0.35,
  'Acoustic': 0.25,
  'Folk': 0.3,
  'Chillout': 0.2,
};

const GENRE_DARKNESS = {
  'Metal': 0.8,
  'Punk': 0.6,
  'Dubstep': 0.5,
  'Techno': 0.5,
  'Hardstyle': 0.6,
  'Experimental': 0.5,
  'Trap': 0.45,
  'Ambient': 0.3,
};

// ─── MOOD SCORES ─────────────────────────────────────────

const MOOD_ENERGY = {
  'Aggressive': 1.0,
  'Fiery': 0.9,
  'Energizing': 0.85,
  'Defiant': 0.8,
  'Excited': 0.8,
  'Empowering': 0.75,
  'Gritty': 0.7,
  'Upbeat': 0.65,
  'Sensual': 0.4,
  'Cool': 0.45,
  'Sophisticated': 0.4,
  'Easygoing': 0.35,
  'Serious': 0.4,
  'Romantic': 0.3,
  'Sentimental': 0.3,
  'Yearning': 0.35,
  'Tender': 0.2,
  'Melancholy': 0.25,
  'Peaceful': 0.1,
};

const MOOD_DARKNESS = {
  'Aggressive': 0.8,
  'Gritty': 0.7,
  'Defiant': 0.6,
  'Melancholy': 0.6,
  'Serious': 0.5,
  'Yearning': 0.4,
};

// ─── TAG KEYWORDS ────────────────────────────────────────

const HIGH_ENERGY_TAGS = ['bass', 'rave', 'festival', 'heavy', 'hard', 'drop', 'banger', 'hype', 'intense'];
const LOW_ENERGY_TAGS = ['chill', 'lofi', 'lo-fi', 'relax', 'calm', 'sleep', 'meditation', 'soft', 'mellow'];

// ─── HUE RANGE PALETTES ─────────────────────────────────
// Each mood maps to a hue range the colors can drift within.
// hueCenter: the central hue (degrees)
// hueSpread: ±drift range (so total range = hueCenter ± hueSpread/2)
// saturation: [min, max] percent
// lightness: [min, max] percent
// driftSpeed: how fast colors wander over time (higher = faster)
// audioHueShift: how much audio energy shifts the hue (degrees)

const HUE_RANGES = {
  // Calm & Light: soft teal / sky blue — slow, gentle drift
  calmLight: {
    hueCenter: 180,
    hueSpread: 60,
    saturation: [60, 80],
    lightness: [50, 70],
    driftSpeed: 0.3,
    audioHueShift: 20,
  },
  // Calm & Dark: deep indigo / navy
  calmDark: {
    hueCenter: 250,
    hueSpread: 50,
    saturation: [50, 75],
    lightness: [25, 45],
    driftSpeed: 0.2,
    audioHueShift: 15,
  },
  // Medium-low & Light: ocean green / seafoam
  mediumLowLight: {
    hueCenter: 155,
    hueSpread: 60,
    saturation: [65, 85],
    lightness: [45, 65],
    driftSpeed: 0.4,
    audioHueShift: 30,
  },
  // Medium-low & Dark: forest green / dark emerald
  mediumLowDark: {
    hueCenter: 160,
    hueSpread: 50,
    saturation: [55, 75],
    lightness: [25, 42],
    driftSpeed: 0.35,
    audioHueShift: 25,
  },
  // Medium & Light: cyan / electric blue
  mediumLight: {
    hueCenter: 195,
    hueSpread: 80,
    saturation: [70, 95],
    lightness: [45, 65],
    driftSpeed: 0.5,
    audioHueShift: 40,
  },
  // Medium & Dark: teal / deep blue
  mediumDark: {
    hueCenter: 210,
    hueSpread: 70,
    saturation: [60, 85],
    lightness: [28, 48],
    driftSpeed: 0.4,
    audioHueShift: 35,
  },
  // Medium-high & Light: gold / amber / warm
  mediumHighLight: {
    hueCenter: 40,
    hueSpread: 50,
    saturation: [75, 95],
    lightness: [50, 68],
    driftSpeed: 0.6,
    audioHueShift: 45,
  },
  // Medium-high & Dark: burnt orange / copper
  mediumHighDark: {
    hueCenter: 25,
    hueSpread: 45,
    saturation: [65, 85],
    lightness: [28, 45],
    driftSpeed: 0.55,
    audioHueShift: 40,
  },
  // High & Light: hot magenta / neon pink
  highLight: {
    hueCenter: 330,
    hueSpread: 70,
    saturation: [80, 100],
    lightness: [50, 70],
    driftSpeed: 0.8,
    audioHueShift: 60,
  },
  // High & Dark: deep red / crimson
  highDark: {
    hueCenter: 0,
    hueSpread: 60,
    saturation: [70, 95],
    lightness: [25, 45],
    driftSpeed: 0.7,
    audioHueShift: 50,
  },
};

function pickHueRange(energy, darkness) {
  const dark = darkness > 0.45;
  if (energy < 0.3) {
    return dark ? HUE_RANGES.calmDark : HUE_RANGES.calmLight;
  } else if (energy < 0.5) {
    return dark ? HUE_RANGES.mediumLowDark : HUE_RANGES.mediumLowLight;
  } else if (energy < 0.65) {
    return dark ? HUE_RANGES.mediumDark : HUE_RANGES.mediumLight;
  } else if (energy < 0.8) {
    return dark ? HUE_RANGES.mediumHighDark : HUE_RANGES.mediumHighLight;
  } else {
    return dark ? HUE_RANGES.highDark : HUE_RANGES.highLight;
  }
}

// Generate a backward-compatible static palette snapshot from a hue range
function hueRangeToPalette(range) {
  const h = range.hueCenter;
  const s = (range.saturation[0] + range.saturation[1]) / 2;
  const l = (range.lightness[0] + range.lightness[1]) / 2;
  return {
    primary: hslToRGB(h, s, l),
    secondary: hslToRGB(h + 40, s * 0.9, l * 0.85),
    pointLight1: hslToHex(h, s, l + 5),
    pointLight2: hslToHex(h + 60, s * 0.8, l - 5),
    rings: [
      hslToRGB255(h - 20, s, l),
      hslToRGB255(h, s * 0.9, l * 0.9),
      hslToRGB255(h + 30, s, l),
    ],
  };
}

// ─── REAL-TIME HUE COMPUTATION ──────────────────────────

/**
 * Compute the current hue for the visualizer based on time, audio level, and frequency balance.
 * Called each frame from visualizer3d.js.
 * @param {object} hueRange - The hue range object from computeVisualizerParams
 * @param {number} time - Elapsed time in seconds
 * @param {number} audioLevel - Current audio energy (0-1)
 * @param {number} bassRatio - Bass-to-total frequency ratio (0-1, typically ~0.3-0.7)
 * @returns {number} hue in degrees (0-360)
 */
export function computeCurrentHue(hueRange, time, audioLevel, bassRatio) {
  if (!hueRange) return 200; // default blue

  const drift = Math.sin(time * hueRange.driftSpeed) * hueRange.hueSpread * 0.5;
  const audioShift = (audioLevel - 0.3) * hueRange.audioHueShift;
  const freqShift = (bassRatio - 0.5) * 30;

  return (hueRange.hueCenter + drift + audioShift + freqShift + 360) % 360;
}

/**
 * Get the interpolated saturation and lightness from the hue range based on audio level.
 * Higher audio → higher saturation, slightly higher lightness.
 */
export function computeCurrentSL(hueRange, audioLevel) {
  if (!hueRange) return { s: 75, l: 50 };
  const t = Math.min(1, audioLevel * 1.2);
  const s = hueRange.saturation[0] + t * (hueRange.saturation[1] - hueRange.saturation[0]);
  const l = hueRange.lightness[0] + t * (hueRange.lightness[1] - hueRange.lightness[0]);
  return { s, l };
}

// ─── MAIN ALGORITHM ──────────────────────────────────────

export function computeVisualizerParams(genre, mood, tags) {
  // 1. Base scores from genre
  let energy = GENRE_ENERGY[genre] ?? 0.5;
  let darkness = GENRE_DARKNESS[genre] ?? 0.2;

  // 2. Mood modifier (45% weight)
  if (mood && MOOD_ENERGY[mood] !== undefined) {
    energy = energy * 0.55 + MOOD_ENERGY[mood] * 0.45;
    darkness = darkness * 0.6 + (MOOD_DARKNESS[mood] ?? 0.2) * 0.4;
  }

  // 3. Tag micro-adjustments
  if (tags) {
    const tagList = tags.toLowerCase().split(',').map(t => t.trim());
    for (const tag of tagList) {
      if (HIGH_ENERGY_TAGS.some(k => tag.includes(k))) energy = Math.min(1, energy + 0.05);
      if (LOW_ENERGY_TAGS.some(k => tag.includes(k))) energy = Math.max(0, energy - 0.05);
    }
  }

  // 4. Clamp
  energy = Math.max(0, Math.min(1, energy));
  darkness = Math.max(0, Math.min(1, darkness));

  // 5. Pick hue range and generate backward-compatible palette
  const hueRange = pickHueRange(energy, darkness);

  // 6. Map to visualizer parameters
  return {
    distortion: 0.3 + energy * 2.2,
    rotationSpeed: 0.3 + energy * 2.2,
    audioBoost: 0.8 + energy * 2.2,
    audioReactivity: 0.5 + energy * 2.0,
    ringReactivity: 0.3 + energy * 0.9,
    palette: hueRangeToPalette(hueRange),
    hueRange,
  };
}
