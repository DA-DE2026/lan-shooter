// Connect screen: player name + host LAN address entry.

import { $ } from '../utils.js';

export function initConnect({ onSubmit }) {
  const nameEl = $('connect-name');
  const addrEl = $('connect-address');
  const btn = $('connect-btn');

  // Remember last-used values; default the address to wherever this page
  // was served from (on LAN that's already the host's IP).
  nameEl.value = localStorage.getItem('lanshooter.name') ?? '';
  addrEl.value = localStorage.getItem('lanshooter.address')
    ?? `${window.location.hostname || '192.168.1.10'}:3000`;

  const submit = () => {
    const name = nameEl.value.trim();
    const address = addrEl.value.trim();
    if (!name) return setStatus('Enter a name first.');
    if (!address) return setStatus('Enter the host’s address, e.g. 192.168.1.10:3000');
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
