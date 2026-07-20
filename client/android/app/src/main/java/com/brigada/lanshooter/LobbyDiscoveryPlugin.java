package com.brigada.lanshooter;

import android.Manifest;
import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// Wraps Android's NsdManager (mDNS/DNS-SD) so the game can advertise a
// hostable lobby on the local network and let other devices discover it
// without typing an IP address. See docs/superpowers/specs/
// 2026-07-20-lan-discovery-design.md for the full design rationale.
//
// On Android 13+ (API 33+), NsdManager's advertise/discover calls require
// the runtime NEARBY_WIFI_DEVICES permission — without it, registerService()
// / discoverServices() can throw SecurityException. Uncaught exceptions
// from a Capacitor @PluginMethod are fatal: Bridge.callPluginMethod()
// re-throws them as a RuntimeException on the calling thread, which crashes
// the whole app (not just this plugin call) — this is what was happening
// when a player tapped "Host a Game" on a fresh install. Every method here
// now checks/requests the permission first and wraps the NsdManager calls
// in try/catch so a real failure rejects the call instead of crashing.
@CapacitorPlugin(
    name = "LobbyDiscovery",
    permissions = {
        @Permission(strings = { Manifest.permission.NEARBY_WIFI_DEVICES }, alias = "nearbyWifiDevices")
    }
)
public class LobbyDiscoveryPlugin extends Plugin {
    private static final String SERVICE_TYPE = "_lanshooter._tcp.";
    private static final String TAG = "LobbyDiscovery";
    private static final String NEARBY_WIFI_DEVICES_ALIAS = "nearbyWifiDevices";

    private NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;

    @Override
    public void load() {
        nsdManager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
    }

    @PluginMethod
    public void advertise(PluginCall call) {
        if (getPermissionState(NEARBY_WIFI_DEVICES_ALIAS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NEARBY_WIFI_DEVICES_ALIAS, call, "advertisePermissionCallback");
            return;
        }
        startAdvertising(call);
    }

    @PermissionCallback
    private void advertisePermissionCallback(PluginCall call) {
        if (getPermissionState(NEARBY_WIFI_DEVICES_ALIAS) == PermissionState.GRANTED) {
            startAdvertising(call);
        } else {
            // Not fatal: the host can still play, other devices just won't
            // discover the lobby automatically (manual IP entry still works).
            call.reject("Nearby Wi-Fi Devices permission was denied; the lobby won't be discoverable.");
        }
    }

    private void startAdvertising(PluginCall call) {
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

        NsdManager.RegistrationListener listener = new NsdManager.RegistrationListener() {
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

        try {
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener);
            registrationListener = listener;
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "registerService threw", e);
            call.reject("Could not start advertising the lobby: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        if (registrationListener != null) {
            try {
                nsdManager.unregisterService(registrationListener);
            } catch (Exception e) {
                // Already unregistered, or NSD in a bad state — safe to ignore.
            }
            registrationListener = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void browse(PluginCall call) {
        if (getPermissionState(NEARBY_WIFI_DEVICES_ALIAS) != PermissionState.GRANTED) {
            requestPermissionForAlias(NEARBY_WIFI_DEVICES_ALIAS, call, "browsePermissionCallback");
            return;
        }
        startBrowsing(call);
    }

    @PermissionCallback
    private void browsePermissionCallback(PluginCall call) {
        if (getPermissionState(NEARBY_WIFI_DEVICES_ALIAS) == PermissionState.GRANTED) {
            startBrowsing(call);
        } else {
            // Not fatal: manual IP entry and QR scanning still work.
            call.reject("Nearby Wi-Fi Devices permission was denied; discovered lobbies won't be shown.");
        }
    }

    private void startBrowsing(PluginCall call) {
        if (discoveryListener != null) {
            call.resolve();
            return;
        }

        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
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

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
            discoveryListener = listener;
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "discoverServices threw", e);
            call.reject("Could not browse for lobbies: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopBrowse(PluginCall call) {
        if (discoveryListener != null) {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener);
            } catch (Exception e) {
                // Already stopped, or NSD in a bad state — safe to ignore.
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
