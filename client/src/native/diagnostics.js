// Wraps the custom Diagnostics Android plugin so the connect screen can
// show why the app closed unexpectedly last time (a Java exception or a
// native crash), directly in the page. A native AlertDialog was tried
// first but proved unreliable on at least one real device — rendering the
// same text in the already-working webview is far more robust.

import { registerPlugin, Capacitor } from '@capacitor/core';

const Diagnostics = registerPlugin('Diagnostics');

/** Resolves with the last crash report text, or null if there isn't one (or this isn't the installed app). */
export async function getLastCrashReport() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Diagnostics')) return null;
  try {
    const { report } = await Diagnostics.getLastCrashReport();
    return report ?? null;
  } catch {
    return null;
  }
}
