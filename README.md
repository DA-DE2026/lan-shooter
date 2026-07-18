# LAN Shooter

A 3D team-based multiplayer shooter for LAN parties. Three.js client,
Node.js + Socket.IO authoritative server, playable by up to 15 players
(3 teams × 5) on a local network.

![style](https://img.shields.io/badge/style-3D%20jungle-green)

## Features

- **3D jungle battlefield** — a lit Three.js world seen from an angled
  follow camera, in a stylized painterly MOBA-jungle art direction: big
  trees with thick tapered trunks and chunky lobed or conifer canopies,
  vertex-color gradients from deep shadow green to warm sunlit tops,
  hand-painted-looking terrain (sun/shade blotches, dark soil under trees,
  edge vignette), leafy shrubs, mushrooms and low-poly boulders, golden-hour
  lighting and fog. The whole forest merges into a handful of draw calls.
  Two maps: **Temple Ruins** (2 teams) and **Triple Canopy** (2 or 3 teams).
  Everything is generated in code — no 3D model files or textures to load. Players are human soldier figures: team-colored helmet
  and shoulder pads, custom outfit color, animated walk cycle, gun tracking
  the aim.
- **Teams** — host picks 2 or 3 teams, renames them, recolors them.
  Max 5 players per team; new joiners auto-balance to the smallest team.
- **Lobby** — host sets score limit, time limit and map; players pick a team
  and an outfit color; lobby chat.
- **Combat** — two starting weapons (auto Pulse Rifle, burst Scattergun)
  with clip sizes, reload times, fire rates and projectile speeds;
  server-side hit detection; respawn waves every 8 s.
- **Hiding bushes** — `%` tiles form bush clusters you can crouch into:
  enemies outside the bush can't see you (server-enforced, same as fog)
  unless they step in with you, get point-blank, or you fire — the muzzle
  flash reveals you for a moment. Your soldier turns translucent while
  hidden. Bots respect and exploit bushes too.
- **Weapon loot** — crates drop around the map (up to 3 at a time, marked
  gold on the minimap): the one-clip **Longshot Rifle** (4 × 60 dmg) and
  **Stinger SMG** (40-round spray). Grabbing one auto-equips it into a third
  slot (key 3); no reloads — when the clip's dry the weapon's gone, and
  death drops it. Bots grab crates as well.
- **Bots** — the host can add AI players from the lobby (or mid-match).
  Bots auto-balance onto teams, hunt with line-of-sight checks and BFS
  pathfinding, strafe in fights, switch to the scattergun up close, reload,
  respawn with the waves and score like anyone else. Kick to remove.
- **Comms** — in-game all-chat (Enter), team pings (Alt+Click the world or
  click the minimap) that only your team sees.
- **Fog of war** — vision is limited by range and blocked by tree lines,
  and it's shared across your team. The server only ever sends your client
  the enemies your team can actually see (it's not just cosmetic), the world
  darkens outside your team's vision with soft ray-cast edges, and the
  camera stays rigidly locked to your soldier (steady cam, no drift).
  Bots see by exactly the same rules.
- **Minimap** — walls, you, teammates, team pings and the fog of war.
  Enemies are hidden on purpose.
- **Spectator mode** — while dead you follow living teammates (←/→ to cycle)
  until the next respawn wave.
- **Reconnect** — a dropped player has 60 s to rejoin; same team, same stats.
  The client reconnects automatically.
- **Host controls** — start, kick, restart, end match early, return everyone
  to the lobby.
- **Summary screen** — winner, MVP, kills/deaths per player, rematch button.

## Project layout

```
├── shared/          # rules both sides must agree on
│   └── src/
│       ├── constants.js   # tick rates, player stats, socket event names
│       ├── weapons.js     # weapon definitions (add weapons here)
│       ├── maps.js        # ASCII-grid maps (add maps here)
│       └── mapUtils.js    # collision + spawn helpers
├── server/          # authoritative game server
│   ├── src/
│   │   ├── index.js       # HTTP + Socket.IO bootstrap, serves client build
│   │   ├── Match.js       # lobby/match state machine, host controls, scoring
│   │   ├── Player.js      # per-player record (survives reconnects)
│   │   └── Projectiles.js # projectile sim + hit detection
│   └── test/              # unit tests + real-socket e2e test
└── client/          # Three.js + Vite
    └── src/
        ├── main.js        # screen flow: connect → lobby → match → summary
        ├── net.js         # socket connection + auto-rejoin
        ├── ui/            # DOM screens: connect, lobby, summary, HUD
        └── game/          # Three.js: Game3D, Player3D, world3d, Minimap2D
```

## Running it

Requirements: Node.js 20+.

```bash
npm install

# development (two processes: server on :3000, Vite client on :5173)
npm run dev

# production-style (single process; server serves the built client on :3000)
npm run build
npm start
```

### Playing over LAN

1. The **host machine** runs `npm run build` then `npm start`.
   The server prints its LAN IPs on startup, e.g. `192.168.1.10:3000`.
2. Everyone else opens `http://192.168.1.10:3000` in a browser
   (same Wi-Fi/network), enters a name and that same address, and connects.
3. First player to connect is the **host** and controls match settings.
   If the host leaves, the next connected player inherits host powers.

> Windows may prompt to allow Node.js through the firewall — allow it on
> private networks, or other machines won't reach the server.

### Controls

| Input | Action |
|---|---|
| WASD / arrows | Move |
| Mouse | Aim; left-click fires (hold for auto weapons) |
| R | Reload |
| Q / 1 / 2 / 3 | Switch weapon (3 = looted weapon) |
| Enter | Chat (Esc cancels) |
| Alt+Click or middle-click | Ping location for your team |
| Click minimap | Ping that map location |
| ← / → while dead | Cycle spectated teammate |

**Touch devices** get twin-stick controls automatically: left half of the
screen is a floating movement joystick, right half is the aim joystick —
push it past ~40% deflection to fire. Round buttons handle reload and
weapon switching; tap the minimap to ping. An emptied clip reloads itself.

## Testing

```bash
npm test
```

Runs the server suite: map/collision sanity tests, match state-machine unit
tests (with a fake clock), and a full end-to-end test that boots the real
server and drives two Socket.IO clients through join → fight → kill → chat →
ping → summary.

## Extending

- **New weapon** — append to `shared/src/weapons.js`. Ammo, reload, HUD and
  projectiles all key off the definition. Add a hotkey in
  `Game3D.setupInput()` if you go past two weapons.
- **New map** — append an ASCII grid to `shared/src/maps.js`
  (`#` wall, `.` floor, `1`/`2`/`3` team spawn tiles) and declare which team
  counts it supports. Malformed grids throw at startup. It appears in the
  lobby map picker automatically.
- **New game mode** — the match flow lives in `server/src/Match.js`
  (`beginMatch` / `applyHit` / `endMatch`). Scoring is one array; a
  capture-point or flag mode would add its own tick logic there and extra
  fields to the snapshot in `broadcastSnapshot()`.
- **More teams** — bump `MAX_TEAMS` in `shared/src/constants.js`, add a
  preset color/name, and provide maps with `4` spawn tiles.

## Android APK

The Capacitor Android project lives in `client/android` (cleartext HTTP
enabled for LAN play, landscape-locked for the twin-stick controls).
Touch devices automatically get the twin-stick control layer.

**Easiest: let CI build it.** Pushing a version tag (e.g. `v0.1.0`) runs the
`Build Android APK` GitHub Actions workflow, which tests, builds and
attaches `lan-shooter.apk` to a GitHub Release — no Android Studio needed.
It can also be run manually from the Actions tab.

**Local build** (requires Android Studio / SDK):

```bash
npm run build
cd client
npx cap sync android
cd android && ./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

Install the APK on phones on the same Wi-Fi (allow "unknown apps" when
sideloading), start the server on the host PC, and connect to the host's
IP as usual.

## Architecture notes

- The **server is authoritative** for ammo, reloads, health, kills, scores,
  respawns and the match timer. Projectiles are simulated server-side in
  substeps so fast shots can't tunnel through walls or players.
- **Movement is client-predicted**: each client resolves its own collisions
  against the shared map data and reports position at 20 Hz — the right
  trade-off for a trusted LAN party (zero input latency, tiny server load).
- The server broadcasts **snapshots at 15 Hz**; remote players are smoothly
  interpolated on the client.
- Reconnects work via a **persistent random token** in `localStorage`:
  the server keeps a dropped player's seat for 60 s and reattaches the
  same `Player` record when the token reappears.
