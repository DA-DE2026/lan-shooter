// In-app QR scanning for the connect screen. Uses the browser's native
// BarcodeDetector (no external library, no network fetch — works fully
// offline) over a getUserMedia camera feed. Only usable in a "secure
// context" (see cameraAvailable() in utils.js): reliably works in the
// installed Capacitor app (its origin counts as secure) and in an https
// browser, but NOT over a plain http://192.168.x.x LAN page — the connect
// screen only shows the button when it will actually work.
//
// Scans whatever QR the host is showing (e.g. printed in their terminal on
// server startup, or read aloud) and extracts "host:port" from it.

import { $ } from '../utils.js';

let stream = null;
let detector = null;
let rafId = null;

/**
 * Open the camera overlay and scan for a QR code. Resolves with the
 * decoded "host:port" string, or null if the user cancels / it fails.
 */
export function scanForAddress() {
  return new Promise((resolve) => {
    const overlay = $('qr-overlay');
    const video = $('qr-video');
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(result);
    };

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      video.srcObject = null;
      overlay.classList.add('hidden');
      $('qr-cancel').removeEventListener('click', onCancel);
    };

    const onCancel = () => finish(null);
    $('qr-cancel').addEventListener('click', onCancel);

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        overlay.classList.remove('hidden');
        return video.play();
      })
      .then(() => {
        detector ??= new window.BarcodeDetector({ formats: ['qr_code'] });
        const tick = async () => {
          if (done) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            if (value) {
              const address = extractAddress(value);
              if (address) return finish(address);
            }
          } catch {
            // Transient decode errors are normal while framing the code;
            // just keep scanning.
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      })
      .catch(() => finish(null)); // permission denied / no camera
  });
}

/** Pull "host:port" out of a scanned QR payload — a URL, or raw text. */
function extractAddress(text) {
  try {
    const url = new URL(text);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    // Not a URL — accept it if it already looks like "host:port".
    return /^[\w.-]+:\d+$/.test(text.trim()) ? text.trim() : null;
  }
}
