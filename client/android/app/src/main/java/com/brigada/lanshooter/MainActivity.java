package com.brigada.lanshooter;

import android.app.AlertDialog;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        CrashHandler.install(this);
        registerPlugin(LobbyDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);

        String lastCrash = CrashHandler.readAndClear(this);
        if (lastCrash != null) {
            new AlertDialog.Builder(this)
                .setTitle("The app closed unexpectedly last time")
                .setMessage(lastCrash)
                .setPositiveButton("OK", null)
                .show();
        }
    }
}
