// Client session state: everything the UI and game scene need to share.
// One plain mutable object keeps the flow easy to follow.

export const state = {
  selfId: null,
  name: '',
  lobby: null,     // last LOBBY payload from the server
  match: null,     // last MATCH_STATE payload
  summary: null,   // last MATCH_ENDED payload
  inMatch: false,  // true while the Phaser scene is live
  clockOffset: 0,  // serverTime - clientTime, for countdown displays
};

/** Current server time estimate. */
export function serverNow() {
  return Date.now() + state.clockOffset;
}

/** Look up a player's roster entry (name/team/skin) by public id. */
export function rosterPlayer(id) {
  const list = state.lobby?.players ?? [];
  return list.find((p) => p.id === id) ?? null;
}

export function isHost() {
  return state.lobby?.hostId != null && state.lobby.hostId === state.selfId;
}

/** Team display name/color from current settings. */
export function teamInfo(teamIndex) {
  const s = state.lobby?.settings ?? state.match?.settings;
  return {
    name: s?.teamNames?.[teamIndex] ?? `Team ${teamIndex + 1}`,
    color: s?.teamColors?.[teamIndex] ?? 0x999999,
  };
}
