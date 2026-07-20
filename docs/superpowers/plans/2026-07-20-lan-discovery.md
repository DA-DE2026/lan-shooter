# LAN Lobby Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player opening the app on the same hotspot/Wi-Fi as a host sees
that game appear automatically in a list and taps to join — no typing an
IP address. The manual address field and QR scan stay as permanent
fallbacks; nothing about today's join flow is removed.

**Architecture:** A small custom Capacitor Android plugin wraps Android's
built-in `NsdManager` (mDNS/DNS-SD) — the OS-native "advertise a service /
browse for others" mechanism, chosen over hand-rolled UDP broadcast
because it already handles multicast locking and timing internally. The
host advertises a `_lanshooter._tcp` service while in the lobby; the Join
screen browses for it and renders discovered lobbies as tappable cards
that feed the exact same `connect()` path manual entry and QR scanning
already use.

**Tech Stack:** Android `NsdManager` (Java, via a custom
`@CapacitorPlugin`), Capacitor's `registerPlugin()` JS API.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-lan-discovery-design.md`.
- Depends on
  `docs/superpowers/plans/2026-07-20-embedded-server-solo.md` being
  implemented first (Host/Solo buttons must exist — this plan advertises
  from that same entry point). Do not start this plan's tasks until that
  one's Task 11 CI build has succeeded.
- Android only — `NsdManager` is an Android API; there is no iOS project
  in this repo, and PC/browser hosts have no equivalent (unaffected —
  still joinable by typed IP/QR as always).
- No server-side (`server/`, `shared/`) changes at all in this plan — this
  is 100% client + native Android.
- This feature is inherently not unit-testable under `node --test` (it's
  Android framework behavior). Verification is: does the Android project
  build (final task, same pattern as the previous plan), and then the
  user's own on-device test with two real phones.
- A discovered-lobbies list that's simply empty is a normal state, not an
  error — never show an error message for "nothing found yet."

---

### Task 1: `LobbyDiscoveryPlugin.java`

**Files:**
- Create: `client/android/app/src/main/java/com/brigada/lanshooter/LobbyDiscoveryPlugin.java`

**Interfaces:**
- Consumes: Android's `android.net.nsd.NsdManager` (framework API, no new
  dependency needed).
- Produces: a Capacitor plugin named `LobbyDiscovery` with four methods —
  `advertise({name, port})`, `stopAdvertising()`, `browse()`,
  `stopBrowse()` — and two events it emits — `lobbyFound {id, name, host,
  port}`, `lobbyLost {id}`. Task 2 registers this plugin; Task 3's JS
  wrapper is the only thing that calls it.

- [ ] **Step 1: Write the plugin**

Create `client/android/app/src/main/java/com/brigada/lanshooter/LobbyDiscoveryPlugin.java`:

```java
package com.brigada.lanshooter;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Wraps Android's NsdManager (mDNS/DNS-SD) so the game can advertise a
// hostable lobby on the local network and let other devices discover it
// without typing an IP address. See docs/superpowers/specs/
// 2026-07-20-lan-discovery-design.md for the full design rationale.
@CapacitorPlugin(name = "LobbyDiscovery")
public class LobbyDiscoveryPlugin extends Plugin {
    private static final String SERVICE_TYPE = "_lanshooter._tcp.";
    private static final String TAG = "LobbyDiscovery";

    private NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;

    @Override
    public void load() {
        nsdManager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
    }

    @PluginMethod
    public void advertise(PluginCall call) {
        String name = call.getString("name", "LAN Shooter Game");
        Integer port = call.getInt("port", 3000);

        if (registrationListener != null) {
            call.resolve();
            return;
        }

        NsdServiceInfo serviceInfo = new NsdServiceInfo();
        serviceInfo.setServiceName(name);
        serviceInfo.setServiceType(SERVICE_TYPE);
        serviceInfo.setPort(port);

        registrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo info) {
                Log.i(TAG, "Advertising as " + info.getServiceName());
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo info, int errorCode) {
                Log.w(TAG, "Advertise failed: " + errorCode);
                registrationListener = null;
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo info) {
                registrationListener = null;
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo info, int errorCode) {
                registrationListener = null;
            }
        };

        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener);
        call.resolve();
    }

    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        if (registrationListener != null) {
            try {
                nsdManager.unregisterService(registrationListener);
            } catch (IllegalArgumentException e) {
                // Already unregistered — safe to ignore.
            }
            registrationListener = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void browse(PluginCall call) {
        if (discoveryListener != null) {
            call.resolve();
            return;
        }

        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String regType) {
                Log.i(TAG, "Discovery started");
            }

            @Override
            public void onServiceFound(NsdServiceInfo service) {
                nsdManager.resolveService(service, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo info, int errorCode) {
                        Log.w(TAG, "Resolve failed for " + info.getServiceName() + ": " + errorCode);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo info) {
                        JSObject data = new JSObject();
                        data.put("id", info.getServiceName());
                        data.put("name", info.getServiceName());
                        data.put("host", info.getHost().getHostAddress());
                        data.put("port", info.getPort());
                        notifyListeners("lobbyFound", data);
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo service) {
                JSObject data = new JSObject();
                data.put("id", service.getServiceName());
                notifyListeners("lobbyLost", data);
            }

            @Override
            public void onDiscoveryStopped(String regType) {
                Log.i(TAG, "Discovery stopped");
            }

            @Override
            public void onStartDiscoveryFailed(String regType, int errorCode) {
                Log.w(TAG, "Start discovery failed: " + errorCode);
                discoveryListener = null;
            }

            @Override
            public void onStopDiscoveryFailed(String regType, int errorCode) {
                discoveryListener = null;
            }
        };

        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        call.resolve();
    }

    @PluginMethod
    public void stopBrowse(PluginCall call) {
        if (discoveryListener != null) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (IllegalArgumentException e) {
                // Already stopped — safe to ignore.
            }
            discoveryListener = null;
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (registrationListener != null) {
            try {
                nsdManager.unregisterService(registrationListener);
            } catch (Exception ignored) {
            }
        }
        if (discoveryListener != null) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (Exception ignored) {
            }
        }
        super.handleOnDestroy();
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/android/app/src/main/java/com/brigada/lanshooter/LobbyDiscoveryPlugin.java
git commit -m "Add the NsdManager-based lobby discovery Android plugin"
```

(No automated test — this is Android framework code with no equivalent
under `node --test`. Verified by Task 6's CI build compiling it, and the
user's on-device pass.)

---

### Task 2: Register the plugin

**Files:**
- Modify: `client/android/app/src/main/java/com/brigada/lanshooter/MainActivity.java`

**Interfaces:**
- Consumes: `LobbyDiscoveryPlugin` (Task 1).
- Produces: makes `LobbyDiscovery` resolvable from JS via
  `registerPlugin('LobbyDiscovery')` (Task 3). `capacitor-nodejs` (from
  the previous plan) does not need manual registration here — it
  registers itself automatically via Capacitor's npm-plugin discovery,
  since it's an installed package rather than an app-local plugin like
  this one.

- [ ] **Step 1: Update `MainActivity.java`**

Current content:

```java
package com.brigada.lanshooter;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
```

Replace with:

```java
package com.brigada.lanshooter;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LobbyDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/android/app/src/main/java/com/brigada/lanshooter/MainActivity.java
git commit -m "Register the lobby discovery plugin"
```

---

### Task 3: `discovery.js` — the webview-side wrapper

**Files:**
- Create: `client/src/native/discovery.js`

**Interfaces:**
- Consumes: `registerPlugin`, `Capacitor` from `@capacitor/core`.
- Produces:
  - `discoveryAvailable(): boolean`
  - `advertiseLobby(name: string, port: number): Promise<void>` — no-ops
    when unavailable.
  - `stopAdvertising(): Promise<void>` — no-ops when unavailable.
  - `browseLobbies({ onFound, onLost }): Promise<() => Promise<void>>` —
    starts browsing, calls `onFound({id, name, host, port})` /
    `onLost(id)` as services appear/disappear, and returns a `stop()`
    function; no-ops (returns a no-op `stop`) when unavailable.
  Task 4 uses `advertiseLobby`. Task 5 uses `browseLobbies` — note
  `discoveryAvailable` doesn't need to be called separately by either
  consumer, since `advertiseLobby`/`browseLobbies` already check it
  internally and no-op when unavailable; it's exported for completeness
  and any future direct use.

- [ ] **Step 1: Write the file**

Create `client/src/native/discovery.js`:

```js
// Wraps the custom LobbyDiscovery Android plugin (see
// LobbyDiscoveryPlugin.java) so the rest of the client never has to know
// whether it's running on the installed app (real discovery available)
// or in a browser/dev server (silently unavailable — manual address
// entry and QR scanning keep working everywhere, unaffected).

import { registerPlugin, Capacitor } from '@capacitor/core';

const LobbyDiscovery = registerPlugin('LobbyDiscovery');

export function discoveryAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LobbyDiscovery');
}

export async function advertiseLobby(name, port) {
  if (!discoveryAvailable()) return;
  await LobbyDiscovery.advertise({ name, port });
}

export async function stopAdvertising() {
  if (!discoveryAvailable()) return;
  await LobbyDiscovery.stopAdvertising();
}

/**
 * Starts browsing for lobbies. onFound({id, name, host, port}) and
 * onLost(id) fire as services appear/disappear. Returns a stop()
 * function; no-ops entirely (including the returned stop()) when
 * discovery isn't available.
 */
export async function browseLobbies({ onFound, onLost }) {
  if (!discoveryAvailable()) return async () => {};

  const foundHandle = await LobbyDiscovery.addListener('lobbyFound', (data) => onFound(data));
  const lostHandle = await LobbyDiscovery.addListener('lobbyLost', (data) => onLost(data.id));
  await LobbyDiscovery.browse();

  return async () => {
    await LobbyDiscovery.stopBrowse();
    foundHandle.remove();
    lostHandle.remove();
  };
}
```

- [ ] **Step 2: Confirm the client builds**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add client/src/native/discovery.js
git commit -m "Add the webview-side wrapper for lobby discovery"
```

---

### Task 4: Advertise while hosting

**Files:**
- Modify: `client/src/ui/connect.js`

**Interfaces:**
- Consumes: `advertiseLobby` from `client/src/native/discovery.js`
  (Task 3).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Wire it into `startHosted`**

In `client/src/ui/connect.js`, update the import to add
`advertiseLobby`:

```js
import { advertiseLobby } from '../native/discovery.js';
```

Inside `startHosted(shareable)` (added in the previous plan), find the
line `const port = await startEmbeddedServer();` and add immediately
after it:

```js
      await advertiseLobby(name, port);
```

Both Host and Solo advertise identically — there is no functional
difference between them beyond which button the player pressed (see the
"Why embed Node" consolidation note in the design doc's Host/Solo
section); if someone finds and joins a "Solo" game, it simply becomes a
normal hosted match, which is fine.

- [ ] **Step 2: Confirm the client builds**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/connect.js
git commit -m "Advertise the lobby over mDNS while hosting"
```

---

### Task 5: Discovered-lobbies list on the Join screen

**Files:**
- Modify: `client/index.html`
- Modify: `client/src/styles.css`
- Modify: `client/src/ui/connect.js`

**Interfaces:**
- Consumes: `discoveryAvailable`, `browseLobbies` from
  `client/src/native/discovery.js` (Task 3); `normalizeAddress` from
  `client/src/utils.js` (already imported).
- Produces: nothing consumed elsewhere — this is the final user-facing
  piece.

- [ ] **Step 1: Add the list container**

In `client/index.html`, find:

```html
        <label>Server address <span class="mini">(ask the host, or scan their QR)</span>
```

Insert immediately before it:

```html
        <div id="discovered-lobbies" class="hidden"></div>
```

- [ ] **Step 2: Style it**

In `client/src/styles.css`, find the `.connect-help` rule block (added in
the previous plan) and add immediately after it:

```css
#discovered-lobbies { display: flex; flex-direction: column; gap: 6px; margin: 14px 0; }
.lobby-card {
  display: flex; justify-content: space-between; align-items: center;
  width: 100%; padding: 10px 14px; text-align: left;
  background: #232837; border: 1px solid #333a4d; border-radius: 8px;
  color: #e8eaf0; font-size: 14px; cursor: pointer;
}
.lobby-card:hover { background: #2b3244; }
.lobby-card .mini { color: #8b93a7; }
```

- [ ] **Step 3: Render discovered lobbies**

In `client/src/ui/connect.js`, update the import to add
`browseLobbies`:

```js
import { advertiseLobby, browseLobbies } from '../native/discovery.js';
```

Inside `initConnect({ onSubmit })`, after the `hostBtn`/`soloBtn` wiring
block added in the previous plan, add:

```js
  const lobbies = new Map(); // id -> {id, name, host, port}
  const listEl = $('discovered-lobbies');

  const renderLobbies = () => {
    listEl.classList.toggle('hidden', lobbies.size === 0);
    listEl.innerHTML = '';
    for (const lobby of lobbies.values()) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'lobby-card';
      card.innerHTML = `<span>${lobby.name}</span><span class="mini">tap to join</span>`;
      card.addEventListener('click', () => {
        addrEl.value = `${lobby.host}:${lobby.port}`;
        submit();
      });
      listEl.appendChild(card);
    }
  };

  browseLobbies({
    onFound: (lobby) => { lobbies.set(lobby.id, lobby); renderLobbies(); },
    onLost: (id) => { lobbies.delete(id); renderLobbies(); },
  });
```

This starts browsing once, for the whole app session — there is no
per-screen start/stop lifecycle in this codebase to hook into, and
letting it run is a deliberate, low-cost simplification (an idle mDNS
browse has negligible impact for a session-length LAN party app).

Note: this block references `submit`, which is declared later in the
same function via `const submit = () => { ... };`. That's fine — `const`
in a function body is only "unusable before its declaration" if
*executed* before that line runs; here, `submit()` is only called from
inside `card`'s click handler, which fires long after `initConnect()` has
finished running top-to-bottom and `submit` has been assigned.

- [ ] **Step 4: Confirm the client builds**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/src/styles.css client/src/ui/connect.js
git commit -m "Show discovered lobbies as tap-to-join cards on the Join screen"
```

---

### Task 6: CI build check

**Files:** none (verification-only task; no code changes)

**Interfaces:** none.

- [ ] **Step 1: Confirm the full local test suite still passes**

Run: `npm test -w server`
Expected: all tests PASS (this plan made no server changes, so this is a
regression check, not new coverage).

- [ ] **Step 2: Confirm the full build succeeds**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Tag and push to trigger the Android CI build**

```bash
git tag v0.4.0
git push origin master
git push origin v0.4.0
```

- [ ] **Step 4: Watch the Android build**

```bash
gh run list -R DA-DE2026/lan-shooter --limit 1
```

Wait for `completed`. This is the real check that
`LobbyDiscoveryPlugin.java` actually compiles against the Capacitor
Android SDK and that `MainActivity.java`'s registration is valid Java —
neither is checkable without either this CI run or a local Android SDK.
On failure:

```bash
gh run view --log-failed -R DA-DE2026/lan-shooter
```

and fix whatever the compiler error reports.

- [ ] **Step 5: Confirm the release has the APK**

```bash
gh release view v0.4.0 -R DA-DE2026/lan-shooter
```

Expected: `asset: lan-shooter.apk` listed. From here, the remaining
verification is entirely on-device and belongs to the user: install this
APK on two phones on the same hotspot, host on one, confirm the other
sees it appear in the list within a few seconds with no typing, and tap
to join.

- [ ] **Step 6: No commit needed** (verification-only task).
