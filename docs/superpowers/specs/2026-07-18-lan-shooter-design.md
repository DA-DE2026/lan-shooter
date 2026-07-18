# LAN Shooter — Design Decisions

Date: 2026-07-18. The feature list came fully specified by the requester;
this doc records the design choices made where the spec left room.

## Visual style: layered-depth top-down (not isometric)

The spec allowed "isometric or layered-depth sprites". Chosen: top-down with
fake-extruded walls (light top face, dark front face, bottom-aligned) and
y-sorted depth for players/walls. Rationale: aiming and collision stay in
simple 2D world space, maps stay editable ASCII grids, and the effect still
reads clearly as 2.5D. Isometric would have forced screen↔world coordinate
projection through every system (aim, netcode, minimap, pings) for mostly
cosmetic gain.

## Authority model

- **Server-authoritative:** ammo, reload timing, fire rate, projectile
  flight + hit detection (substepped to prevent tunneling), health, kills,
  scores, respawn waves, match timer, team membership, host powers.
- **Client-predicted:** own movement. Clients resolve collisions against the
  shared map module and report position at 20 Hz; the server clamps to map
  bounds and trusts the rest.

Rationale: on a trusted LAN, client-predicted movement gives zero input
latency and removes the need for server-side input replay, while keeping
everything competitive (shooting, damage, score) server-side. The shared
`mapUtils` module guarantees both sides use identical wall data.

## Netcode shape

- 30 Hz server simulation, 15 Hz snapshots (positions, hp, ammo, scores,
  timers), discrete events for spawns/hits/kills/chat/pings.
- Projectiles render client-side from spawn events (deterministic velocity),
  with server end-events to remove them early on impact — no per-projectile
  state in snapshots.
- Clock sync: clients keep `serverTime - clientTime` offset from snapshot
  timestamps for countdown displays.

## Rooms: one match per server process

"Host creates a match" is modeled as: first player to connect becomes host.
A LAN party runs one server = one match. Multi-room support would add a
lobby-of-lobbies layer nobody at a LAN party needs; the Match class is
self-contained, so rooms could be added later by instantiating one Match per
Socket.IO room.

## Reconnect

Clients hold a random persistent token (localStorage). The server keys
players by token, keeps disconnected players for 60 s during a match, and
reattaches the socket on rejoin (same team, stats, position). In the lobby,
disconnects just remove the player. Kicked tokens are blocked until the
host returns everyone to the lobby.

## Respawn/spectate

Respawn is wave-based (every 8 s, all dead players return together), which
gives spectating a natural window and keeps teams re-entering as groups.
Dead players auto-follow living teammates, ←/→ cycles.

## UI: DOM overlays, Phaser only for the world

Connect/lobby/summary/HUD/chat are plain DOM — crisper text, free layout,
form controls. Phaser boots only for a match and is destroyed after, so map
changes/rematches/reconnects always start from a clean scene.

## Testing

Server logic is testable without sockets (injected clock + fake IO);
an e2e test boots the real server and drives two real Socket.IO clients
through a full match. Client rendering is verified by `vite build` plus
manual play.
