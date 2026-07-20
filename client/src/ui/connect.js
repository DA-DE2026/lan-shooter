// Connect screen: player name + host LAN address entry. This is the single
// biggest friction point on mobile, so it gets extra help: a smart (never
// misleading) default, a mobile-friendly keyboard, automatic ":3000" when
// the port is omitted, and an optional camera QR scan button.

import { $, normalizeAddress, cameraAvailable } from '../utils.js';
import { scanForAddress } from './qrscan.js';
import { embeddedServerAvailable, startEmbeddedServer, onBackgroundStateChange } from '../native/embeddedServer.js';
import { advertiseLobby, browseLobbies } from '../native/discovery.js';

/** Is `host` a real LAN-reachable name, as opposed to a loopback/empty one? */
function isRealNetworkHost(host) {
  return !!host && host !== 'localhost' && host !== '127.0.0.1' && !host.startsWith('[');
}

export function initConnect({ onSubmit }) {
  const nameEl = $('connect-name');
  const addrEl = $('connect-address');
  const btn = $('connect-btn');
  const scanBtn = $('scan-qr-btn');

  // Remember last-used values. Only auto-fill the address from the page's
  // own origin when that's a real LAN hostname (i.e. this page was loaded
  // as http://192.168.x.x:3000 on the LAN) — never fall back to a fake
  // placeholder IP or to "localhost", both of which look plausible but
  // silently fail to connect from another device.
  nameEl.value = localStorage.getItem('lanshooter.name') ?? '';
  const savedAddress = localStorage.getItem('lanshooter.address');
  if (savedAddress) {
    addrEl.value = savedAddress;
  } else if (isRealNetworkHost(window.location.hostname)) {
    addrEl.value = `${window.location.hostname}:3000`;
  }

  if (cameraAvailable()) {
    scanBtn.classList.remove('hidden');
    scanBtn.addEventListener('click', async () => {
      const address = await scanForAddress();
      if (address) {
        addrEl.value = address;
        setStatus('Scanned! Review and press Join.');
      }
    });
  }

  const hostBtn = $('host-btn');
  const soloBtn = $('solo-btn');
  if (!embeddedServerAvailable()) {
    hostBtn.disabled = true;
    soloBtn.disabled = true;
    hostBtn.title = soloBtn.title = 'Only available in the installed app';
  } else {
    hostBtn.addEventListener('click', () => startHosted(true));
    soloBtn.addEventListener('click', () => startHosted(false));
  }

  const lobbies = new Map(); // id -> {id, name, host, port}
  const listEl = $('discovered-lobbies');

  const renderLobbies = () => {
    listEl.classList.toggle('hidden', lobbies.size === 0);
    listEl.innerHTML = '';
    for (const lobby of lobbies.values()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'lobby-card';
      // lobby.name comes from a remote device's mDNS advertisement, so it's
      // attacker-controlled — build the card with real nodes, never innerHTML.
      const nameSpan = document.createElement('span');
      nameSpan.textContent = lobby.name;
      const hintSpan = document.createElement('span');
      hintSpan.className = 'mini';
      hintSpan.textContent = 'tap to join';
      card.append(nameSpan, hintSpan);
      card.addEventListener('click', () => {
        addrEl.value = `${lobby.host}:${lobby.port}`;
        submit();
      });
      listEl.appendChild(card);
    }
  };

  browseLobbies({
    onFound: (lobby) => { lobbies.set(lobby.id, lobby); renderLobbies(); },
    onLost: (id) => { lobbies.delete(id); renderLobbies(); },
  }).catch(() => {
    // Best-effort: if browsing can't start (e.g. permission denied), the
    // discovered-lobbies list just stays empty — manual IP entry and QR
    // scanning still work.
  });

  async function startHosted(shareable) {
    const name = nameEl.value.trim();
    if (!name) return setStatus('Enter a name first.');
    setStatus('Starting local server…');
    hostBtn.disabled = true;
    soloBtn.disabled = true;
    try {
      const port = await startEmbeddedServer();
      await advertiseLobby(name, port);
      onBackgroundStateChange((backgrounded) => {
        $('background-warning').classList.toggle('hidden', !backgrounded);
      });
      let address = `localhost:${port}`;
      if (shareable) {
        try {
          const res = await fetch(`http://localhost:${port}/api/host-info`);
          const info = await res.json();
          if (info.ips?.[0]) address = `${info.ips[0]}:${port}`;
        } catch {
          // Fall back to localhost — still works for this device; the
          // lobby's "Share to join" banner just won't show a real LAN IP.
        }
      }
      localStorage.setItem('lanshooter.name', name);
      onSubmit({ name, address });
    } catch (err) {
      setStatus(err.message || 'Could not start the local server.');
      hostBtn.disabled = false;
      soloBtn.disabled = false;
    }
  }

  const submit = () => {
    const name = nameEl.value.trim();
    const address = normalizeAddress(addrEl.value);
    if (!name) return setStatus('Enter a name first.');
    if (!address) return setStatus('Enter the host’s address, e.g. 192.168.1.10:3000');
    addrEl.value = address;
    localStorage.setItem('lanshooter.name', name);
    localStorage.setItem('lanshooter.address', address);
    onSubmit({ name, address });
  };

  btn.addEventListener('click', submit);
  for (const el of [nameEl, addrEl]) {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }
}

export function setStatus(text) {
  $('connect-status').textContent = text;
}
