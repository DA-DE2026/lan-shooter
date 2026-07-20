// Small client-side helpers shared across UI and game code.

/** 0xrrggbb int -> '#rrggbb' CSS string. */
export function cssColor(intColor) {
  return `#${intColor.toString(16).padStart(6, '0')}`;
}

/** mm:ss for a millisecond duration (clamped at 0). */
export function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Clean up a user-typed or QR-scanned server address into "host:port".
 * Strips a pasted "http://" prefix, trailing slash/whitespace, and fills in
 * the default port when the user only typed an IP — the single biggest
 * source of "it won't connect" on mobile is forgetting ":3000".
 */
export function normalizeAddress(raw) {
  let a = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (a && !a.includes(':')) a += ':3000';
  return a;
}

/**
 * True when this page can plausibly use the camera (getUserMedia needs a
 * "secure context" — https, or the app's own localhost-equivalent origin;
 * a plain http://192.168.x.x LAN page never qualifies). Used to hide the
 * "Scan QR" button instead of showing one that silently fails.
 */
export function cameraAvailable() {
  return window.isSecureContext
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window.BarcodeDetector !== 'undefined';
}

/**
 * Persistent random session token. Identifies this browser/device to the
 * server so a dropped connection can rejoin the same match slot.
 * (crypto.randomUUID is unavailable on insecure http:// LAN origins,
 * so build the token from getRandomValues instead.)
 */
export function getSessionToken() {
  const KEY = 'lanshooter.token';
  let token = localStorage.getItem(KEY);
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, token);
  }
  return token;
}

/** Simple toast popups for errors / notices. */
export function toast(message, { error = false, ms = 3500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Show exactly one of the full-screen UI screens (or none). */
export function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) {
    s.classList.toggle('hidden', s.id !== id);
  }
}

export const $ = (id) => document.getElementById(id);
