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
