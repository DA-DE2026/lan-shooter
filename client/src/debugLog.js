// For debugger purposes only. Captures console.error/warn, uncaught JS
// errors, and unhandled promise rejections into an in-memory log shown in
// the connect screen's #debug-console panel — live, not just after a full
// app crash. That's the gap this fills: the native crash report (see
// native/diagnostics.js) only covers the one moment the app relaunches
// after crashing; ordinary in-app errors that don't bring down the whole
// process previously had nowhere to show beyond a single overwritten
// status line.

const MAX_ENTRIES = 300;
const entries = [];
let render = null;

function stringifyArgs(args) {
  return args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
}

function push(level, text) {
  const time = new Date().toLocaleTimeString();
  entries.push(`[${time}] ${level}: ${text}`);
  if (entries.length > MAX_ENTRIES) entries.shift();
  render?.();
}

/** Starts capturing console.error/warn and uncaught errors. Call once, as early as possible. */
export function startCapture() {
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args) => { origError(...args); push('error', stringifyArgs(args)); };
  console.warn = (...args) => { origWarn(...args); push('warn', stringifyArgs(args)); };

  window.addEventListener('error', (e) => {
    push('error', `${e.message} (${e.filename}:${e.lineno}:${e.colno})`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? (e.reason.stack || e.reason.message) : String(e.reason);
    push('error', `Unhandled promise rejection: ${reason}`);
  });
}

/** Adds a plain info-level line — e.g. the last-crash report, or an explicit debug note. */
export function logInfo(text) {
  push('info', text);
}

/** Wires the on-screen #debug-console panel. Call once, after the DOM is ready. */
export function mountDebugConsole() {
  const panel = document.getElementById('debug-console');
  const textEl = document.getElementById('debug-console-text');
  const toggleBtn = document.getElementById('debug-console-toggle');
  const hideBtn = document.getElementById('debug-console-hide');
  const clearBtn = document.getElementById('debug-console-clear');
  const copyBtn = document.getElementById('debug-console-copy');
  if (!panel || !textEl) return;

  render = () => {
    textEl.textContent = entries.length ? entries.join('\n') : '(no errors yet)';
    textEl.scrollTop = textEl.scrollHeight;
  };
  render();

  hideBtn.addEventListener('click', () => {
    panel.classList.add('hidden');
    toggleBtn.classList.remove('hidden');
  });
  toggleBtn.addEventListener('click', () => {
    panel.classList.remove('hidden');
    toggleBtn.classList.add('hidden');
  });
  clearBtn.addEventListener('click', () => { entries.length = 0; render(); });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(entries.join('\n'));
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    } catch {
      // Clipboard access can fail (e.g. no secure context) — the text is
      // still readable/selectable in the pre either way.
    }
  });
}
