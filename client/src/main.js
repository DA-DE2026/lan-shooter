// Client entrypoint: wires the connect -> lobby -> match -> summary flow.
// Screens are DOM overlays; Phaser only runs during an active match.

import './styles.css';
import { MSG } from '@lan-shooter/shared';
import { connect, disconnect } from './net.js';
import { state } from './state.js';
import { showScreen, toast, $ } from './utils.js';
import { initConnect, setStatus } from './ui/connect.js';
import { initLobby, renderLobby, addLobbyChat } from './ui/lobby.js';
import { renderSummary } from './ui/summary.js';
import { initHud, showHud, hideHud, addGameChat } from './ui/hud.js';
import { startGame, destroyGame, activeScene } from './game/boot.js';

initConnect({ onSubmit: ({ name, address }) => {
  state.name = name;
  state.connectedAddress = address;
  setStatus('Connecting…');
  wireSocket(connect(address, name));
} });
initLobby();
initHud();
showScreen('screen-connect');

function leaveMatchUi() {
  destroyGame();
  hideHud();
  state.inMatch = false;
}

function wireSocket(socket) {
  socket.on('connect_error', () => {
    if (!state.inMatch) setStatus('Cannot reach the server — check the address and that the host is running.');
  });

  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') return; // kicked — handled below
    if (state.inMatch || state.summary) {
      toast('Connection lost — trying to reconnect…', { error: true });
    } else {
      setStatus('Disconnected from server.');
      showScreen('screen-connect');
    }
    // socket.io keeps retrying; on 'connect' we re-JOIN with our token and
    // the server restores our seat (see net.js).
  });

  socket.on(MSG.JOINED, ({ selfId }) => {
    state.selfId = selfId;
    setStatus('');
  });

  socket.on(MSG.LOBBY, (payload) => {
    state.lobby = payload;
    if (payload.state === 'lobby') {
      // Everyone is (back) in the lobby.
      leaveMatchUi();
      state.summary = null;
      showScreen('screen-lobby');
      renderLobby();
    } else {
      // Roster update mid-match (join/leave/rename) — refresh visuals.
      renderLobby();
      activeScene()?.refreshRoster();
    }
  });

  socket.on(MSG.MATCH_STATE, (payload) => {
    state.match = payload;
    state.clockOffset = payload.serverNow - Date.now();
    state.summary = null;
    showScreen('none'); // hide all overlay screens
    showHud();
    state.inMatch = true;
    startGame(payload);
  });

  socket.on(MSG.MATCH_ENDED, (summary) => {
    state.summary = summary;
    leaveMatchUi();
    renderSummary();
    showScreen('screen-summary');
  });

  socket.on(MSG.CHAT_MSG, (msg) => {
    if (state.inMatch) addGameChat(msg);
    else addLobbyChat(msg);
  });

  socket.on(MSG.KICKED, (message) => {
    leaveMatchUi();
    disconnect();
    state.lobby = null;
    showScreen('screen-connect');
    setStatus(message || 'You were removed from the match.');
  });

  socket.on(MSG.ERROR_MSG, (message) => toast(message, { error: true }));
}
