// Wraps the custom LobbyDiscovery Android plugin (see
// LobbyDiscoveryPlugin.java) so the rest of the client never has to know
// whether it's running on the installed app (real discovery available)
// or in a browser/dev server (silently unavailable — manual address
// entry and QR scanning keep working everywhere, unaffected).

import { registerPlugin, Capacitor } from '@capacitor/core';

const LobbyDiscovery = registerPlugin('LobbyDiscovery');

export function discoveryAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LobbyDiscovery');
}

export async function advertiseLobby(name, port) {
  if (!discoveryAvailable()) return;
  try {
    await LobbyDiscovery.advertise({ name, port });
  } catch {
    // Best-effort: advertising is a discovery convenience, not a
    // requirement for hosting. If it fails (e.g. the player denied the
    // Nearby Wi-Fi Devices permission), the embedded server the caller
    // already started keeps running — other players just have to type
    // the address instead of tapping a discovered lobby card.
  }
}

export async function stopAdvertising() {
  if (!discoveryAvailable()) return;
  await LobbyDiscovery.stopAdvertising();
}

/**
 * Starts browsing for lobbies. onFound({id, name, host, port}) and
 * onLost(id) fire as services appear/disappear. Returns a stop()
 * function; no-ops entirely (including the returned stop()) when
 * discovery isn't available.
 */
export async function browseLobbies({ onFound, onLost }) {
  if (!discoveryAvailable()) return async () => {};

  const foundHandle = await LobbyDiscovery.addListener('lobbyFound', (data) => onFound(data));
  const lostHandle = await LobbyDiscovery.addListener('lobbyLost', (data) => onLost(data.id));
  await LobbyDiscovery.browse();

  return async () => {
    await LobbyDiscovery.stopBrowse();
    foundHandle.remove();
    lostHandle.remove();
  };
}
