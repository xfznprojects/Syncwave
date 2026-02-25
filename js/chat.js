import CONFIG from './config.js';
import { broadcast } from './room.js';
import { getCurrentUser } from './auth.js';

let chatContainer = null;
let gifPickerEl = null;
let gifSearchTimeout = null;

// Security constants
const MAX_MESSAGE_LENGTH = 500;
const MAX_NAME_LENGTH = 50;
const MAX_CHAT_MESSAGES = 200; // max DOM nodes before pruning old ones
const RATE_LIMIT_MS = 300;     // min time between messages per user
const rateLimitMap = new Map(); // userId → lastMessageTimestamp

export function initChat(containerEl, gifPicker) {
  chatContainer = containerEl;
  gifPickerEl = gifPicker;
}

export function sendMessage(text) {
  const user = getCurrentUser();
  if (!text.trim() && !user) return;

  // Truncate to max length
  const safeText = text.trim().slice(0, MAX_MESSAGE_LENGTH);

  const message = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: user?.userId || 'anon',
    handle: sanitizeName(user?.handle || 'Anonymous'),
    name: sanitizeName(user?.name || 'Anonymous'),
    avatar: sanitizeUrl(user?.profilePicture?.['150x150'] || null),
    text: safeText,
    gifUrl: null,
    timestamp: Date.now(),
  };

  broadcast('chat', message);
  renderMessage(message);
}

export function sendGif(gifUrl, previewUrl) {
  const user = getCurrentUser();

  // Validate GIF URLs are https
  const safeGifUrl = sanitizeUrl(gifUrl);
  const safePreviewUrl = sanitizeUrl(previewUrl || gifUrl);
  if (!safeGifUrl) return;

  const message = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: user?.userId || 'anon',
    handle: sanitizeName(user?.handle || 'Anonymous'),
    name: sanitizeName(user?.name || 'Anonymous'),
    avatar: sanitizeUrl(user?.profilePicture?.['150x150'] || null),
    text: '',
    gifUrl: safeGifUrl,
    previewUrl: safePreviewUrl || safeGifUrl,
    timestamp: Date.now(),
  };

  broadcast('chat', message);
  renderMessage(message);
}

export function handleIncomingMessage(message) {
  // Sanitize all incoming fields (attacker-controlled via broadcast)
  const safe = {
    id: message.id,
    userId: String(message.userId || 'anon').slice(0, 100),
    handle: sanitizeName(message.handle),
    name: sanitizeName(message.name),
    avatar: sanitizeUrl(message.avatar),
    text: String(message.text || '').slice(0, MAX_MESSAGE_LENGTH),
    gifUrl: sanitizeUrl(message.gifUrl),
    previewUrl: sanitizeUrl(message.previewUrl || message.gifUrl),
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
  };

  // Rate limit by userId (drop floods from same user)
  const lastTime = rateLimitMap.get(safe.userId) || 0;
  if (Date.now() - lastTime < RATE_LIMIT_MS) return;
  rateLimitMap.set(safe.userId, Date.now());

  renderMessage(safe);
}

function renderMessage(msg) {
  if (!chatContainer) return;

  const el = document.createElement('div');
  el.className = 'chat-message';

  const time = new Date(msg.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Build content — only allow https images for GIFs
  let contentHtml = '';
  if (msg.gifUrl) {
    contentHtml = `<img class="chat-gif" src="${escapeHtml(msg.previewUrl || msg.gifUrl)}" alt="GIF" loading="lazy">`;
  } else {
    contentHtml = `<span class="chat-text">${escapeHtml(msg.text)}</span>`;
  }

  // Build avatar safely — use error handler via JS, not inline onerror
  const safeAvatar = msg.avatar ? escapeHtml(msg.avatar) : '';
  const fallbackChar = escapeHtml((msg.name || '?')[0].toUpperCase());

  el.innerHTML = `
    <div class="chat-avatar">
      ${safeAvatar ? `<img src="${safeAvatar}" alt="${escapeHtml(msg.handle)}" loading="lazy">` : ''}
      <div class="chat-avatar-fallback" ${safeAvatar ? 'style="display:none"' : ''}>${fallbackChar}</div>
    </div>
    <div class="chat-body">
      <div class="chat-header">
        <span class="chat-name">${escapeHtml(msg.name)}</span>
        <span class="chat-time">${timeStr}</span>
      </div>
      ${contentHtml}
    </div>
  `;

  // Handle avatar load error via JS instead of inline onerror attribute
  if (safeAvatar) {
    const img = el.querySelector('.chat-avatar img');
    if (img) {
      img.addEventListener('error', () => {
        img.style.display = 'none';
        const fallback = img.nextElementSibling;
        if (fallback) fallback.style.display = 'flex';
      });
    }
  }

  chatContainer.appendChild(el);

  // Prune old messages to prevent DOM from growing unbounded
  while (chatContainer.children.length > MAX_CHAT_MESSAGES) {
    chatContainer.removeChild(chatContainer.firstChild);
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Tenor GIF search
export async function searchGifs(query) {
  if (!CONFIG.TENOR_API_KEY || !query.trim()) return [];

  const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${CONFIG.TENOR_API_KEY}&limit=20&media_filter=gif,tinygif`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(r => ({
      id: r.id,
      url: r.media_formats?.gif?.url || '',
      preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '',
      description: r.content_description || '',
    }));
  } catch {
    return [];
  }
}

export async function getTrendingGifs() {
  if (!CONFIG.TENOR_API_KEY) return [];

  const url = `https://tenor.googleapis.com/v2/featured?key=${CONFIG.TENOR_API_KEY}&limit=20&media_filter=gif,tinygif`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(r => ({
      id: r.id,
      url: r.media_formats?.gif?.url || '',
      preview: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || '',
      description: r.content_description || '',
    }));
  } catch {
    return [];
  }
}

export function renderGifPicker(gifs, onSelect) {
  if (!gifPickerEl) return;

  gifPickerEl.innerHTML = gifs.map(gif => `
    <div class="gif-item" data-url="${escapeHtml(gif.url)}" data-preview="${escapeHtml(gif.preview)}">
      <img src="${escapeHtml(gif.preview)}" alt="${escapeHtml(gif.description)}" loading="lazy">
    </div>
  `).join('');

  gifPickerEl.querySelectorAll('.gif-item').forEach(item => {
    item.addEventListener('click', () => {
      onSelect(item.dataset.url, item.dataset.preview);
    });
  });
}

// Debounced GIF search for input
export function setupGifSearch(inputEl, onResults) {
  inputEl.addEventListener('input', () => {
    clearTimeout(gifSearchTimeout);
    gifSearchTimeout = setTimeout(async () => {
      const query = inputEl.value.trim();
      if (query) {
        const results = await searchGifs(query);
        onResults(results);
      } else {
        const trending = await getTrendingGifs();
        onResults(trending);
      }
    }, 300);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Only allow https:// URLs (blocks javascript:, data:, blob:, etc.)
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://')) return trimmed; // allow http for dev
  return null; // reject everything else (javascript:, data:, blob:, etc.)
}

// Truncate and strip control characters from display names
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'Anonymous';
  // Strip control chars (U+0000–U+001F, U+007F–U+009F) except space
  return name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, MAX_NAME_LENGTH) || 'Anonymous';
}

export function clearChat() {
  if (chatContainer) chatContainer.innerHTML = '';
}
