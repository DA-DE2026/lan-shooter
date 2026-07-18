// End-of-match summary screen: final scores, MVP, per-player stats,
// host controls to rematch or return everyone to the lobby.

import { MSG } from '@lan-shooter/shared';
import { emit } from '../net.js';
import { state, isHost, teamInfo } from '../state.js';
import { $, cssColor } from '../utils.js';

export function renderSummary() {
  const summary = state.summary;
  if (!summary) return;

  const winners = summary.winners;
  if (winners.length === 1) {
    const w = teamInfo(winners[0]);
    $('summary-title').textContent = `${w.name.toUpperCase()} WINS!`;
    $('summary-title').style.color = cssColor(w.color);
  } else {
    $('summary-title').textContent = 'DRAW!';
    $('summary-title').style.color = '';
  }

  $('summary-reason').textContent = {
    score: 'Score limit reached',
    time: 'Time limit reached',
    host: 'Match ended by host',
  }[summary.reason] ?? '';

  // Team score chips.
  const scoresEl = $('summary-scores');
  scoresEl.innerHTML = '';
  summary.scores.forEach((score, t) => {
    const info = teamInfo(t);
    const chip = document.createElement('div');
    chip.className = 'score-chip' + (winners.includes(t) && winners.length === 1 ? ' winner' : '');
    chip.style.borderLeftColor = cssColor(info.color);
    chip.innerHTML = `<span class="mini"></span>`;
    chip.querySelector('.mini').textContent = info.name;
    chip.appendChild(document.createTextNode(String(score)));
    scoresEl.appendChild(chip);
  });

  // MVP callout.
  const mvp = summary.players.find((p) => p.id === summary.mvpId);
  $('summary-mvp').textContent = mvp
    ? `★ MVP: ${mvp.name} — ${mvp.kills} kills / ${mvp.deaths} deaths`
    : '';

  // Stats table, best killers first.
  const tbody = $('summary-table').querySelector('tbody');
  tbody.innerHTML = '';
  const sorted = [...summary.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  for (const p of sorted) {
    const tr = document.createElement('tr');
    if (p.id === summary.mvpId) tr.className = 'mvp-row';
    const info = teamInfo(p.team);
    const cells = [
      p.name + (p.id === state.selfId ? ' (you)' : ''),
      info.name,
      String(p.kills),
      String(p.deaths),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 1) td.style.color = cssColor(info.color);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  // Actions: host drives the group; everyone else waits.
  const actions = $('summary-actions');
  actions.innerHTML = '';
  if (isHost()) {
    const again = document.createElement('button');
    again.className = 'primary';
    again.style.marginTop = '0';
    again.textContent = 'Rematch';
    again.addEventListener('click', () => emit(MSG.RESTART_MATCH));
    const back = document.createElement('button');
    back.textContent = 'Return to lobby';
    back.addEventListener('click', () => emit(MSG.TO_LOBBY));
    actions.append(again, back);
  } else {
    const wait = document.createElement('p');
    wait.className = 'mini';
    wait.textContent = 'Waiting for the host to start a rematch or return to the lobby…';
    actions.appendChild(wait);
  }
}
