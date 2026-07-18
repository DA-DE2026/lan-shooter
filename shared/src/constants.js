// Shared gameplay constants. Both server and client import these so the
// simulation rules stay in sync across the wire.

export const TILE = 64;            // world pixels per map tile
export const WALL_HEIGHT = 26;     // visual extrusion height for the 2.5D wall look (client only)

export const PLAYER_RADIUS = 14;
export const PLAYER_SPEED = 280;   // px/sec
export const PLAYER_MAX_HP = 100;

// Fog of war: how far a player can see. Vision is blocked by tree lines and
// shared with teammates; the server only sends enemies your team can see.
export const VISION_RANGE = 520;

// Hiding bushes ('%' map tiles): a player inside a bush is invisible to
// enemies outside it, unless they are inside the same bush cluster, within
// point-blank range, or recently revealed by firing.
export const BUSH_PEEK_RANGE = 56;
export const BUSH_REVEAL_MS = 900;

// Weapon loot crates.
export const PICKUP_INTERVAL_MS = 12000; // spawn cadence while under the cap
export const MAX_PICKUPS = 3;
export const PICKUP_RADIUS = 34;         // walk this close to grab

export const MAX_TEAM_SIZE = 5;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 3;

export const TICK_RATE = 30;       // server simulation Hz
export const SNAPSHOT_RATE = 15;   // server -> client state broadcast Hz
export const MOVE_SEND_RATE = 20;  // client -> server position report Hz

export const RESPAWN_WAVE_MS = 8000;    // dead players respawn together on this cycle
export const RECONNECT_GRACE_MS = 60000; // dropped players may rejoin within this window
export const PING_LIFETIME_MS = 4000;    // how long a map ping marker stays visible
export const CHAT_MAX_LEN = 200;

export const DEFAULT_PORT = 3000;

// Host-configurable team identity presets (index = team number - 1).
export const TEAM_PRESETS = [
  { name: 'Red',  color: 0xe0524d },
  { name: 'Blue', color: 0x4d9de0 },
  { name: 'Gold', color: 0xe0b84d },
];

// Palette the host can recolor teams with.
export const TEAM_COLOR_CHOICES = [
  0xe0524d, 0x4d9de0, 0xe0b84d, 0x5cb85c, 0xb06ad4, 0xe8743b, 0x3fc1c9,
];

// Player outfit color choices (the torso/sleeves of the soldier figure).
export const SKIN_COLORS = [
  0xf2f2f2, 0x30343a, 0x8d6e63, 0x80cbc4, 0xba68c8, 0xffb74d, 0xaed581, 0x90a4ae,
];

// Socket.IO event names. C2S = client to server, S2C = server to client.
export const MSG = {
  // C2S
  JOIN: 'join',                // { token, name }
  SET_TEAM: 'setTeam',         // teamIndex
  SET_SKIN: 'setSkin',         // skinIndex
  SET_SETTINGS: 'setSettings', // partial settings object (host only)
  ADD_BOT: 'addBot',           // (host only) add an AI player to the match
  START_MATCH: 'startMatch',   // (host only)
  RESTART_MATCH: 'restartMatch',
  END_MATCH: 'endMatch',       // end early (host only)
  TO_LOBBY: 'toLobby',         // after summary (host only)
  KICK: 'kick',                // playerId (host only)
  MOVE: 'move',                // { x, y, a } position + aim angle
  FIRE: 'fire',                // { a } aim angle
  RELOAD: 'reload',
  SWITCH_WEAPON: 'switchWeapon', // weaponIndex
  CHAT: 'chat',                // text
  PING_MAP: 'pingMap',         // { x, y } world coords

  // S2C
  JOINED: 'joined',            // { selfId } ack after JOIN
  LOBBY: 'lobby',              // full lobby/roster state
  MATCH_STATE: 'matchState',   // full match bootstrap (on start / mid-match join)
  SNAPSHOT: 'snapshot',        // periodic dynamic state
  PROJ_SPAWN: 'projSpawn',
  PROJ_END: 'projEnd',
  HIT: 'hit',                  // { victimId, hp, x, y }
  KILL: 'kill',                // { killerId, victimId }
  CHAT_MSG: 'chatMsg',
  PING_MARK: 'pingMark',       // teammates-only ping broadcast
  MATCH_ENDED: 'matchEnded',   // summary payload
  KICKED: 'kicked',
  ERROR_MSG: 'errorMsg',
  PICKUP_SPAWN: 'pickupSpawn', // { id, x, y, w } weapon crate appeared
  PICKUP_TAKEN: 'pickupTaken', // { id, byId, w } weapon crate grabbed
};
