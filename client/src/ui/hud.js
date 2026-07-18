// In-match HUD: health, ammo/reload, team scores, match timer, killfeed,
// chat overlay, respawn/spectate overlay, damage flash.
// The game scene calls hudTick() every frame with current values.

import { MSG, WEAPONS } from '@lan-shooter/shared';
import { emit } from '../net.js';
import { state, serverNow, rosterPlayer, teamInfo } from '../state.js';
import { $, cssColor, formatTime } from '../utils.js';

let chatOpen = false;

export function initHud() {
  const input = $('chat-input');

  // Global chat keys, active only while in a match.
  window.addEventListener('keydown', (e) => {
    if (!state.inMatch) return;
    if (e.key === 'Enter' && !chatOpen) {
      openChat();
      e.preventDefault();
    } else if (chatOpen && e.key === 'Enter') {
      const text = input.value.trim();
      if (text) emit(MSG.CHAT, text);
      closeChat();
      e.preventDefault();
    } else if (chatOpen && e.key === 'Escape') {
      closeChat();
    }
  });
}

function openChat() {
  chatOpen = true;
  $('chat-input').classList.remove('hidden');
  $('chat-input').focus();
}

function closeChat() {
  chatOpen = false;
  const input = $('chat-input');
  input.value = '';
  input.classList.add('hidden');
  input.blur();
}

/** The game scene checks this to suppress movement/fire while typing. */
export function isChatOpen() {
  return chatOpen;
}

export function showHud() {
  $('hud').classList.remove('hidden');
  $('killfeed').innerHTML = '';
  $('chat-log').innerHTML = '';
  closeChat();
}

export function hideHud() {
  $('hud').classList.add('hidden');
  $('respawn-overlay').classList.add('hidden');
}

/** Per-frame HUD refresh, driven by the game scene. */
export function hudTick({ hp, alive, weaponIndex, ammo, reloadUntil, scores, endsAt, nextRespawnAt }) {
  const now = serverNow();

  // Health.
  const pct = Math.max(0, Math.min(100, hp));
  $('hud-health-fill').style.width = `${pct}%`;
  $('hud-health-fill').style.background = pct > 35
    ? 'linear-gradient(90deg,#3fae5a,#61d17e)'
    : 'linear-gradient(90deg,#c0392b,#e0524d)';
  $('hud-health-text').textContent = `${Math.round(pct)} HP`;

  // Weapon + ammo + reload progress.
  const w = WEAPONS[weaponIndex];
  $('hud-weapon-name').textContent = w.name;
  const reloading = reloadUntil > now;
  $('hud-ammo').textContent = reloading ? '· · ·' : `${ammo} / ${w.magSize}`;
  $('hud-ammo').classList.toggle('low', !reloading && ammo <= Math.ceil(w.magSize / 5));
  $('hud-reload-fill').style.width = reloading
    ? `${100 - ((reloadUntil - now) / w.reloadMs) * 100}%`
    : '0%';

  // Scores + timer.
  renderScores(scores);
  $('hud-timer').textContent = endsAt > 0 ? formatTime(endsAt - now) : '∞';

  // Respawn overlay while dead.
  const overlay = $('respawn-overlay');
  overlay.classList.toggle('hidden', alive);
  if (!alive) {
    const secs = Math.max(0, Math.ceil((nextRespawnAt - now) / 1000));
    $('respawn-text').textContent = `Respawn wave in ${secs}s`;
  }
}

function renderScores(scores) {
  const el = $('hud-scores');
  // Rebuild only when team count changes; otherwise update numbers in place.
  if (el.children.length !== scores.length) {
    el.innerHTML = '';
    scores.forEach((_, t) => {
      const chip = document.createElement('div');
      chip.className = 'hud-score';
      chip.style.borderTopColor = cssColor(teamInfo(t).color);
      const label = document.createElement('span');
      label.className = 'mini';
      label.textContent = teamInfo(t).name;
      chip.appendChild(label);
      chip.appendChild(document.createElement('b'));
      el.appendChild(chip);
    });
  }
  scores.forEach((score, t) => {
    el.children[t].querySelector('b').textContent = String(score);
  });
}

/** Kill feed entry: "Killer ▸ Victim" in team colors. */
export function addKillFeed(killerId, victimId) {
  const killer = rosterPlayer(killerId);
  const victim = rosterPlayer(victimId);
  const entry = document.createElement('div');
  entry.className = 'kf-entry';

  const k = document.createElement('span');
  k.style.color = killer ? cssColor(teamInfo(killer.team).color) : '#fff';
  k.textContent = killer?.name ?? '?';
  const v = document.createElement('span');
  v.style.color = victim ? cssColor(teamInfo(victim.team).color) : '#fff';
  v.textContent = victim?.name ?? '?';

  entry.append(k, document.createTextNode(' ▸ '), v);
  $('killfeed').prepend(entry);
  while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  setTimeout(() => entry.remove(), 6000);
}

/** In-game chat message. */
export function addGameChat({ name, team, text }) {
  const log = $('chat-log');
  const line = document.createElement('div');
  line.className = 'chat-line';
  const who = document.createElement('span');
  who.className = 'name';
  who.style.color = cssColor(teamInfo(team).color);
  who.textContent = name + ': ';
  line.appendChild(who);
  line.appendChild(document.createTextNode(text));
  log.appendChild(line);
  while (log.children.length > 8) log.firstChild.remove();
  setTimeout(() => line.remove(), 12000);
}

/** Red edge flash when the local player takes damage. */
export function damageFlash() {
  const el = $('damage-flash');
  el.style.transition = 'none';
  el.style.opacity = '1';
  requestAnimationFrame(() => {
    el.style.transition = 'opacity .35s';
    el.style.opacity = '0';
  });
}
