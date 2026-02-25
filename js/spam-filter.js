// ─── CHAT SPAM FILTER ───────────────────────────────────────
// Production-grade anti-spam for chat messages and GIFs.
// Covers: rate limiting, duplicate detection, character spam,
// caps abuse, link spam, and escalating cooldowns.

// ── Rate Limits ──────────────────────────────────────────────
const MSG_LIMIT = 5;           // max text messages per window
const MSG_WINDOW_MS = 10_000;  // 10 seconds
const GIF_LIMIT = 3;           // max GIFs per window
const GIF_WINDOW_MS = 20_000;  // 20 seconds
const MIN_GAP_MS = 600;        // minimum time between any two messages (slow mode)

// ── Duplicate Detection ──────────────────────────────────────
const DUPE_HISTORY = 5;        // remember last N messages
const DUPE_WINDOW_MS = 30_000; // within this window

// ── Content Rules ────────────────────────────────────────────
const MAX_LINKS = 2;           // max URLs per message
const CAPS_THRESHOLD = 0.7;    // 70%+ uppercase = caps abuse (min 8 chars)
const CAPS_MIN_LENGTH = 8;     // don't flag short messages
const REPEAT_CHAR_LIMIT = 10;  // "aaaaaaaaaa" — 10+ consecutive identical chars
const REPEAT_WORD_LIMIT = 4;   // same word repeated 4+ times

// ── Escalating Cooldowns ─────────────────────────────────────
const VIOLATION_WINDOW_MS = 60_000;  // track violations within 1 minute
const COOLDOWN_TIERS = [2_000, 5_000, 15_000, 30_000, 60_000]; // escalating cooldowns

// ── State ────────────────────────────────────────────────────
const msgTimestamps = [];      // sliding window of message send times
const gifTimestamps = [];      // sliding window of GIF send times
let lastSendTime = 0;          // timestamp of last message/GIF of any kind
const recentMessages = [];     // last N message texts for dupe detection
const violations = [];         // timestamps of recent violations
let cooldownUntil = 0;         // timestamp when current cooldown expires

// ── Helpers ──────────────────────────────────────────────────

function pruneWindow(arr, windowMs) {
  const cutoff = Date.now() - windowMs;
  while (arr.length > 0 && arr[0] < cutoff) arr.shift();
}

function getViolationCount() {
  pruneWindow(violations, VIOLATION_WINDOW_MS);
  return violations.length;
}

function addViolation() {
  violations.push(Date.now());
  const count = getViolationCount();
  const tier = Math.min(count - 1, COOLDOWN_TIERS.length - 1);
  cooldownUntil = Date.now() + COOLDOWN_TIERS[tier];
}

function normalize(text) {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Checks ───────────────────────────────────────────────────

function checkCooldown() {
  if (Date.now() < cooldownUntil) {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    return `Slow down — try again in ${remaining}s`;
  }
  return null;
}

function checkMinGap() {
  if (Date.now() - lastSendTime < MIN_GAP_MS) {
    return 'You\'re sending messages too fast';
  }
  return null;
}

function checkMsgRate() {
  pruneWindow(msgTimestamps, MSG_WINDOW_MS);
  if (msgTimestamps.length >= MSG_LIMIT) {
    return `Max ${MSG_LIMIT} messages per ${MSG_WINDOW_MS / 1000}s`;
  }
  return null;
}

function checkGifRate() {
  pruneWindow(gifTimestamps, GIF_WINDOW_MS);
  if (gifTimestamps.length >= GIF_LIMIT) {
    return `Max ${GIF_LIMIT} GIFs per ${GIF_WINDOW_MS / 1000}s`;
  }
  return null;
}

function checkDuplicate(text) {
  const norm = normalize(text);
  if (!norm) return null;
  const cutoff = Date.now() - DUPE_WINDOW_MS;
  for (const entry of recentMessages) {
    if (entry.time > cutoff && entry.text === norm) {
      return 'Duplicate message — say something new';
    }
  }
  return null;
}

function checkCharacterSpam(text) {
  // Repeated characters: "aaaaaaaaaaaa"
  const charRepeat = new RegExp(`(.)\\1{${REPEAT_CHAR_LIMIT - 1},}`);
  if (charRepeat.test(text)) {
    return 'Too many repeated characters';
  }
  // Repeated words: "lol lol lol lol"
  const words = text.toLowerCase().split(/\s+/);
  if (words.length >= REPEAT_WORD_LIMIT) {
    const counts = {};
    for (const w of words) {
      counts[w] = (counts[w] || 0) + 1;
      if (counts[w] >= REPEAT_WORD_LIMIT) {
        return 'Too many repeated words';
      }
    }
  }
  return null;
}

function checkCapsAbuse(text) {
  if (text.length < CAPS_MIN_LENGTH) return null;
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length < CAPS_MIN_LENGTH) return null;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (upper / letters.length > CAPS_THRESHOLD) {
    return 'Too many CAPS — tone it down';
  }
  return null;
}

function checkLinks(text) {
  const urlPattern = /https?:\/\/\S+/gi;
  const matches = text.match(urlPattern);
  if (matches && matches.length > MAX_LINKS) {
    return `Max ${MAX_LINKS} links per message`;
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Validate a text message before sending.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function validateMessage(text) {
  let reason;

  reason = checkCooldown();
  if (reason) return { ok: false, reason };

  reason = checkMinGap();
  if (reason) return { ok: false, reason };

  reason = checkMsgRate();
  if (reason) return { ok: false, reason };

  reason = checkDuplicate(text);
  if (reason) { addViolation(); return { ok: false, reason }; }

  reason = checkCharacterSpam(text);
  if (reason) { addViolation(); return { ok: false, reason }; }

  reason = checkCapsAbuse(text);
  if (reason) { addViolation(); return { ok: false, reason }; }

  reason = checkLinks(text);
  if (reason) { addViolation(); return { ok: false, reason }; }

  return { ok: true };
}

/**
 * Validate a GIF send before sending.
 * Returns { ok: true } or { ok: false, reason: string }.
 */
export function validateGif() {
  let reason;

  reason = checkCooldown();
  if (reason) return { ok: false, reason };

  reason = checkMinGap();
  if (reason) return { ok: false, reason };

  reason = checkGifRate();
  if (reason) return { ok: false, reason };

  return { ok: true };
}

/**
 * Call after a message is successfully sent to update rate-limit state.
 */
export function recordMessage(text) {
  const now = Date.now();
  msgTimestamps.push(now);
  lastSendTime = now;
  // Track for dupe detection
  const norm = normalize(text);
  if (norm) {
    recentMessages.push({ text: norm, time: now });
    while (recentMessages.length > DUPE_HISTORY) recentMessages.shift();
  }
}

/**
 * Call after a GIF is successfully sent to update rate-limit state.
 */
export function recordGif() {
  const now = Date.now();
  gifTimestamps.push(now);
  lastSendTime = now;
}

/**
 * Reset all state (e.g., when leaving a room).
 */
export function resetSpamFilter() {
  msgTimestamps.length = 0;
  gifTimestamps.length = 0;
  recentMessages.length = 0;
  violations.length = 0;
  lastSendTime = 0;
  cooldownUntil = 0;
}
