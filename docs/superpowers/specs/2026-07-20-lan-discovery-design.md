# LAN Lobby Discovery — Design

Date: 2026-07-20. Goal: a joining player sees available games on the local
network and taps to join — no IP address typing, no QR scan required
(those remain as fallbacks, never removed). Builds on top of
`2026-07-20-embedded-server-solo-design.md` but doesn't depend on it
functioning — discovery is a client-side layer that works the same
whether the server being discovered is embedded on a phone or running on
a PC.

## Why Android's NsdManager over hand-rolled UDP broadcast

- **`NsdManager`** (Android's built-in mDNS/DNS-SD service) — the OS-native
  mechanism for exactly this: advertise a service, browse for others.
  Handles multicast locking and announce/query timing internally. Chosen.
- **Hand-rolled UDP broadcast** (`DatagramSocket` to 255.255.255.255) —
  conceptually simpler protocol, but we'd own the correctness burden
  ourselves: multicast lock acquisition, retry/timeout logic, and it faces
  the exact same "some networks block this" risk as mDNS, with none of the
  OS-level help. Rejected as primary; not needed as a fallback either,
  since the manual/QR path already covers the "discovery didn't work" case.

## Architecture

```
Host device                          Joining device
────────────                         ──────────────
LobbyDiscoveryPlugin.advertise(      LobbyDiscoveryPlugin.browse()
  name: "Alice's Game", port: 3000)    │
  │                                    ▼
  ▼                              NsdManager discovers
NsdManager registers              "_lanshooter._tcp" services
"_lanshooter._tcp"                on the local network
service                                │
                                        ▼
                                  resolve() → {name, host, port}
                                        │
                                        ▼
                                  Join screen shows a live card;
                                  tap → connect(host:port, name)
                                  (same connect() path as manual
                                   entry / QR today)
```

Discovery only ever *fills in* the address field's job faster. The
underlying join mechanism — `normalizeAddress()` → `connect()` — is
unchanged from what manual entry and QR scanning already use.

## Components

**`client/android/app/src/main/java/com/brigada/lanshooter/LobbyDiscoveryPlugin.java`**
(new) — a small `@CapacitorPlugin` wrapping `NsdManager`:
- `advertise({name, port})` → `NsdManager.registerService(...)` with
  service type `_lanshooter._tcp.`, instance name = `name`.
- `stopAdvertising()` → `unregisterService(...)`.
- `browse()` → `discoverServices("_lanshooter._tcp.", ...)`; on each
  `onServiceFound`, calls `resolveService(...)` and emits a Capacitor
  plugin event (`lobbyFound`) with `{id, name, host, port}`; on
  `onServiceLost`, emits `lobbyLost` with the id so the UI can remove it.
- `stopBrowse()` → `stopServiceDiscovery(...)`.

Registered in `MainActivity.java` alongside the existing plugin setup.

**`client/src/native/discovery.js`** (new) — thin JS wrapper. Feature-
detects the plugin (`Capacitor.isPluginAvailable('LobbyDiscovery')`); if
unavailable (browser, dev server, iOS-never-built), every method silently
no-ops so the Join screen degrades to exactly today's manual/QR-only UX
with zero special-casing needed elsewhere.

**Join screen update** (`client/src/ui/connect.js` /
`modeselect.js` flow) — while the Join screen is open, calls
`discovery.browse()`. Discovered lobbies render as tappable cards above
the existing manual address field: `"Alice's Game — tap to join"`. Tapping
one fills and submits the address exactly like a QR scan does today.
Cards disappear on `lobbyLost`. Browsing stops when the screen is left.

**Host advertising** — `NsdManager` is an Android-only API, so only the
installed app can advertise; a PC/browser host has no equivalent and
simply isn't discoverable (unaffected — it's still joinable by typed
IP/QR, exactly as today). On entering the lobby as host, the Android app
calls `discovery.advertise({name: hostPlayerName, port})`. Stop advertising
when the match ends or the host returns to the mode select screen.

## Data flow

1. Host (Android app) enters the lobby → `discovery.advertise(...)`.
2. Joiner opens the Join screen → `discovery.browse()` starts listening.
3. Android's mDNS resolver finds the advertised service, resolves its
   host/port, plugin emits `lobbyFound`.
4. Join screen renders a card. User taps it.
5. Existing `normalizeAddress()` + `connect()` path runs — identical to
   today's manual/QR flow from this point on.

## Error handling / fallbacks

- No services found (multicast blocked by the network, host hasn't
  advertised yet, etc.): the list is simply empty — the manual address
  field and QR scan button remain fully functional below it. No error
  shown; an empty list on a LAN discovery feature is a normal, expected
  state, not a failure to report.
- Plugin unavailable (browser/PC): `discovery.js` no-ops; Join screen looks
  exactly like it does today, nothing missing, nothing broken.
- Stale entries (host closed the app without a clean `lobbyLost` event):
  `NsdManager`'s own service-lost detection handles this on a timeout; no
  custom heartbeat protocol needed.

## Testing

- No server-side code changes at all — the 29 existing tests are
  untouched and irrelevant to verifying this feature.
- This is inherently on-device-only to verify (multicast behavior varies
  by router/hotspot/OEM) — CI only confirms the Android project still
  builds with the new plugin registered. Manual verification checklist
  covers: same-device advertise+browse sanity check, then two real phones
  on the same hotspot.

## Explicitly out of scope here

- iOS discovery (Bonjour/NSNetService) — no iOS project exists in this
  repo.
- Discovery across networks the phone isn't directly on (routed Wi-Fi,
  VPNs) — LAN-local only, as scoped by the original request.
