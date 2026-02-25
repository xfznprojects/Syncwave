import CONFIG from './config.js';
import { broadcast } from './room.js';
import { getCurrentUser } from './auth.js';

let chatContainer = null;
let gifPickerEl = null;
let gifSearchTimeout = null;

export function initChat(containerEl, gifPicker) {
  chatContainer = containerEl;
  gifPickerEl = gifPicker;
}

export function sendMessage(text) {
  const user = getCurrentUser();
  if (!text.trim() && !user) return;

  const message = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: user?.userId || 'anon',
    handle: user?.handle || 'Anonymous',
    name: user?.name || 'Anonymous',
    avatar: user?.profilePicture?.['150x150'] || null,
    text: text.trim(),
    gifUrl: null,
    timestamp: Date.now(),
  };

  broadcast('chat', message);
  renderMessage(message);
}

export function sendGif(gifUrl, previewUrl) {
  const user = getCurrentUser();

  const message = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: user?.userId || 'anon',
    handle: user?.handle || 'Anonymous',
    name: user?.name || 'Anonymous',
    avatar: user?.profilePicture?.['150x150'] || null,
    text: '',
    gifUrl,
    previewUrl: previewUrl || gifUrl,
    timestamp: Date.now(),
  };

  broadcast('chat', message);
  renderMessage(message);
}

export function handleIncomingMessage(message) {
  renderMessage(message);
}

function renderMessage(msg) {
  if (!chatContainer) return;

  const el = document.createElement('div');
  el.className = 'chat-message';

  const time = new Date(msg.timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let contentHtml = '';
  if (msg.gifUrl) {
    contentHtml = `<img class="chat-gif" src="${escapeHtml(msg.previewUrl || msg.gifUrl)}" alt="GIF" loading="lazy">`;
  } else {
    contentHtml = `<span class="chat-text">${escapeHtml(msg.text)}</span>`;
  }

  el.innerHTML = `
    <div class="chat-avatar">
      ${msg.avatar
        ? `<img src="${escapeHtml(msg.avatar)}" alt="${escapeHtml(msg.handle)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="chat-avatar-fallback" ${msg.avatar ? 'style="display:none"' : ''}>${(msg.name || '?')[0].toUpperCase()}</div>
    </div>
    <div class="chat-body">
      <div class="chat-header">
        <span class="chat-name">${escapeHtml(msg.name)}</span>
        <span class="chat-time">${timeStr}</span>
      </div>
      ${contentHtml}
    </div>
  `;

  chatContainer.appendChild(el);
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

export function clearChat() {
  if (chatContainer) chatContainer.innerHTML = '';
}
