/**
 * SyncWave — Genre/Mood → Visualizer Parameter Mapping
 * Maps Audius track metadata (genre, mood, tags) to 3D visualizer parameters.
 */

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

// ─── COLOR PALETTES ──────────────────────────────────────

const PALETTES = {
  // Calm & Light: soft teal / sky blue
  calmLight: {
    primary:   [0.0, 0.75, 0.9],
    secondary: [0.5, 0.8, 1.0],
    pointLight1: 0x40c0d0,
    pointLight2: 0x80b0ff,
    rings: [[100, 200, 220], [130, 180, 255], [180, 220, 255]],
  },
  // Calm & Dark: deep purple / indigo
  calmDark: {
    primary:   [0.3, 0.1, 0.6],
    secondary: [0.15, 0.05, 0.4],
    pointLight1: 0x5020a0,
    pointLight2: 0x300880,
    rings: [[80, 30, 160], [50, 15, 120], [130, 60, 200]],
  },
  // Medium & Light: cyan / magenta (current default)
  mediumLight: {
    primary:   [0.0, 0.94, 1.0],
    secondary: [1.0, 0.0, 0.67],
    pointLight1: 0x00f0ff,
    pointLight2: 0xff00aa,
    rings: [[0, 240, 255], [180, 74, 255], [255, 0, 170]],
  },
  // Medium & Dark: dark teal / deep rose
  mediumDark: {
    primary:   [0.0, 0.6, 0.7],
    secondary: [0.7, 0.0, 0.4],
    pointLight1: 0x009ab0,
    pointLight2: 0xb00066,
    rings: [[0, 154, 176], [100, 40, 150], [176, 0, 102]],
  },
  // High & Light: hot orange / pink / gold
  highLight: {
    primary:   [1.0, 0.3, 0.0],
    secondary: [1.0, 0.0, 0.4],
    pointLight1: 0xff4c00,
    pointLight2: 0xff0066,
    rings: [[255, 76, 0], [255, 0, 102], [255, 200, 0]],
  },
  // High & Dark: deep red / dark crimson
  highDark: {
    primary:   [0.8, 0.0, 0.0],
    secondary: [0.5, 0.0, 0.2],
    pointLight1: 0xcc0000,
    pointLight2: 0x800033,
    rings: [[204, 0, 0], [128, 0, 51], [255, 50, 0]],
  },
};

function pickPalette(energy, darkness) {
  if (energy < 0.35) {
    return darkness > 0.45 ? PALETTES.calmDark : PALETTES.calmLight;
  } else if (energy < 0.7) {
    return darkness > 0.45 ? PALETTES.mediumDark : PALETTES.mediumLight;
  } else {
    return darkness > 0.45 ? PALETTES.highDark : PALETTES.highLight;
  }
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

  // 5. Map to visualizer parameters
  return {
    distortion: 0.3 + energy * 2.2,
    rotationSpeed: 0.3 + energy * 2.2,
    audioBoost: 0.8 + energy * 2.2,
    audioReactivity: 0.5 + energy * 2.0,
    ringReactivity: 0.3 + energy * 0.9,
    palette: pickPalette(energy, darkness),
  };
}
