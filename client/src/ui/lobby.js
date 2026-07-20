// Lobby screen: team columns, host settings panel, skin picker, lobby chat.
// Re-rendered from every LOBBY broadcast; static wiring happens once in init.

import { MSG, SKIN_COLORS, TEAM_COLOR_CHOICES, MAX_TEAM_SIZE } from '@lan-shooter/shared';
import { emit } from '../net.js';
import { state, isHost } from '../state.js';
import { $, cssColor } from '../utils.js';

export function initLobby() {
  // Host settings inputs -> SET_SETTINGS patches.
  $('set-teamcount').addEventListener('change', (e) => {
    emit(MSG.SET_SETTINGS, { teamCount: Number(e.target.value) });
  });
  $('set-map').addEventListener('change', (e) => {
    emit(MSG.SET_SETTINGS, { mapId: e.target.value });
  });
  $('set-scorelimit').addEventListener('change', (e) => {
    emit(MSG.SET_SETTINGS, { scoreLimit: Number(e.target.value) });
  });
  $('set-timelimit').addEventListener('change', (e) => {
    emit(MSG.SET_SETTINGS, { timeLimitMin: Number(e.target.value) });
  });
  $('add-bot-btn').addEventListener('click', () => emit(MSG.ADD_BOT));
  $('start-btn').addEventListener('click', () => emit(MSG.START_MATCH));

  $('lobby-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('lobby-chat-input');
    if (input.value.trim()) emit(MSG.CHAT, input.value);
    input.value = '';
  });
}

/** Rebuild the lobby UI from the latest LOBBY payload. */
export function renderLobby() {
  const lobby = state.lobby;
  if (!lobby) return;
  const host = isHost();
  const s = lobby.settings;

  $('lobby-role').textContent = host
    ? 'You are the host — configure the match and press Start.'
    : `Waiting for the host to start. (${lobby.players.length} player${lobby.players.length === 1 ? '' : 's'} in lobby)`;

  // Show whatever address this device used to connect, so it's easy to
  // read aloud or copy for teammates who are still trying to join.
  const addrEl = $('lobby-address');
  if (state.connectedAddress) {
    addrEl.classList.remove('hidden');
    addrEl.innerHTML = `Share to join: <b>${state.connectedAddress}</b>`;
  } else {
    addrEl.classList.add('hidden');
  }

  renderTeams(lobby, host);
  renderHostPanel(lobby, host);
  renderSkinPicker(lobby);
}

function renderTeams(lobby, host) {
  const wrap = $('lobby-teams');
  wrap.innerHTML = '';
  const s = lobby.settings;

  for (let t = 0; t < s.teamCount; t++) {
    const members = lobby.players.filter((p) => p.team === t);
    const col = document.createElement('div');
    col.className = 'team-col';
    col.style.borderTopColor = cssColor(s.teamColors[t]);

    // Team name: editable input for the host, plain heading otherwise.
    const head = document.createElement('h3');
    if (host) {
      const nameInput = document.createElement('input');
      nameInput.value = s.teamNames[t];
      nameInput.maxLength = 12;
      nameInput.addEventListener('change', () => {
        const teamNames = [...s.teamNames];
        teamNames[t] = nameInput.value;
        emit(MSG.SET_SETTINGS, { teamNames });
      });
      head.appendChild(nameInput);
    } else {
      head.textContent = s.teamNames[t];
    }
    col.appendChild(head);

    // Host-only team color picker.
    if (host) {
      const row = document.createElement('div');
      row.className = 'team-color-row';
      for (const c of TEAM_COLOR_CHOICES) {
        const sw = document.createElement('div');
        sw.className = 'swatch' + (c === s.teamColors[t] ? ' sel' : '');
        sw.style.background = cssColor(c);
        sw.addEventListener('click', () => {
          const teamColors = [...s.teamColors];
          teamColors[t] = c;
          emit(MSG.SET_SETTINGS, { teamColors });
        });
        row.appendChild(sw);
      }
      col.appendChild(row);
    }

    const count = document.createElement('div');
    count.className = 'team-count';
    count.textContent = `${members.length} / ${MAX_TEAM_SIZE}`;
    col.appendChild(count);

    const list = document.createElement('div');
    list.className = 'team-players';
    for (const p of members) {
      list.appendChild(playerRow(p, lobby, host));
    }
    col.appendChild(list);

    const me = lobby.players.find((p) => p.id === state.selfId);
    if (me && me.team !== t && members.length < MAX_TEAM_SIZE) {
      const joinBtn = document.createElement('button');
      joinBtn.className = 'join-team';
      joinBtn.textContent = `Join ${s.teamNames[t]}`;
      joinBtn.addEventListener('click', () => emit(MSG.SET_TEAM, t));
      col.appendChild(joinBtn);
    }

    wrap.appendChild(col);
  }
}

function playerRow(p, lobby, host) {
  const row = document.createElement('div');
  row.className = 'player-row' + (p.connected ? '' : ' dc');

  const dot = document.createElement('div');
  dot.className = 'dot';
  dot.style.background = cssColor(SKIN_COLORS[p.skin] ?? 0x999999);
  row.appendChild(dot);

  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = p.name;
  row.appendChild(who);

  const tags = [];
  if (p.isBot) tags.push('BOT');
  if (p.id === lobby.hostId) tags.push('HOST');
  if (p.id === state.selfId) tags.push('YOU');
  if (!p.connected && !p.isBot) tags.push('D/C');
  if (tags.length) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tags.join(' · ');
    row.appendChild(tag);
  }

  if (host && p.id !== state.selfId) {
    const kick = document.createElement('button');
    kick.className = 'kick';
    kick.textContent = 'Kick';
    kick.addEventListener('click', () => emit(MSG.KICK, p.id));
    row.appendChild(kick);
  }
  return row;
}

function renderHostPanel(lobby, host) {
  const s = lobby.settings;
  $('settings-lock').textContent = host ? '' : '(host only)';

  // Don't clobber a field the user is actively editing.
  const setIfIdle = (el, value) => {
    if (document.activeElement !== el) el.value = value;
  };
  setIfIdle($('set-teamcount'), String(s.teamCount));
  setIfIdle($('set-scorelimit'), s.scoreLimit);
  setIfIdle($('set-timelimit'), s.timeLimitMin);

  // Map list filtered to maps that support the chosen team count.
  const mapSel = $('set-map');
  if (document.activeElement !== mapSel) {
    mapSel.innerHTML = '';
    for (const m of lobby.maps.filter((m) => m.teams.includes(s.teamCount))) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      mapSel.appendChild(opt);
    }
    mapSel.value = s.mapId;
  }

  for (const el of [
    'set-teamcount', 'set-map', 'set-scorelimit', 'set-timelimit',
    'add-bot-btn', 'start-btn',
  ]) {
    $(el).disabled = !host;
  }
}

function renderSkinPicker(lobby) {
  const me = lobby.players.find((p) => p.id === state.selfId);
  const wrap = $('skin-picker');
  wrap.innerHTML = '';
  SKIN_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (me?.skin === i ? ' sel' : '');
    sw.style.background = cssColor(c);
    sw.addEventListener('click', () => emit(MSG.SET_SKIN, i));
    wrap.appendChild(sw);
  });
}

/** Append a chat message to the lobby chat log. */
export function addLobbyChat({ name, team, text }) {
  const log = $('lobby-chat-log');
  const line = document.createElement('div');
  const who = document.createElement('span');
  who.style.color = cssColor(state.lobby?.settings?.teamColors?.[team] ?? 0xffffff);
  who.style.fontWeight = '700';
  who.textContent = name + ': ';
  line.appendChild(who);
  line.appendChild(document.createTextNode(text));
  log.appendChild(line);
  while (log.children.length > 50) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
