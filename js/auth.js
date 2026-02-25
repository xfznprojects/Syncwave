import CONFIG from './config.js';

const STORAGE_KEY = 'syncwave_user';
const TOKEN_KEY = 'syncwave_token';
let currentUser = null;
let encodedToken = null;

// Load persisted session on startup
export function initAuth() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      currentUser = JSON.parse(stored);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  encodedToken = localStorage.getItem(TOKEN_KEY) || null;
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

export function isLoggedIn() {
  return currentUser !== null;
}

// Open Audius OAuth popup and return user profile on success
export function loginWithAudius() {
  return new Promise((resolve, reject) => {
    const origin = window.location.origin;
    const authUrl =
      `https://audius.co/oauth/auth?scope=write` +
      `&api_key=${CONFIG.AUDIUS_API_KEY}` +
      `&redirect_uri=postmessage` +
      `&origin=${encodeURIComponent(origin)}` +
      `&display=popup`;

    const popup = window.open(authUrl, 'audius-login', 'width=480,height=720');
    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    function onMessage(event) {
      if (event.origin !== 'https://audius.co') return;

      window.removeEventListener('message', onMessage);
      clearInterval(checkClosed);

      // Close the popup now that we have the token
      try { popup.close(); } catch { /* cross-origin or already closed */ }

      const { token, error } = event.data || {};
      if (error) {
        reject(new Error(error));
        return;
      }
      if (!token) {
        reject(new Error('No token received'));
        return;
      }

      // Decode JWT payload (no verification needed — Audius signed it)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = {
          userId: payload.userId,
          handle: payload.handle,
          name: payload.name,
          profilePicture: payload.profilePicture,
          verified: payload.verified,
        };
        encodedToken = token;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
        localStorage.setItem(TOKEN_KEY, token);
        resolve(currentUser);
      } catch (e) {
        reject(new Error('Failed to decode token'));
      }
    }

    window.addEventListener('message', onMessage);

    // Clean up if popup is closed without completing (with 5-minute safety timeout)
    let popupCheckCount = 0;
    const MAX_POPUP_CHECKS = 600; // 5 minutes at 500ms intervals
    const checkClosed = setInterval(() => {
      popupCheckCount++;
      if (popup.closed || popupCheckCount >= MAX_POPUP_CHECKS) {
        clearInterval(checkClosed);
        window.removeEventListener('message', onMessage);
        reject(new Error(popup.closed ? 'Login cancelled' : 'Login timed out'));
      }
    }, 500);
  });
}

export function getToken() {
  return encodedToken;
}

export function logout() {
  currentUser = null;
  encodedToken = null;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_KEY);
}
