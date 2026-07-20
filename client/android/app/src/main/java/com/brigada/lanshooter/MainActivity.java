package com.brigada.lanshooter;

import android.app.AlertDialog;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        CrashHandler.install(this);
        registerPlugin(LobbyDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);

        enterImmersiveFullscreen();

        String lastCrash = CrashHandler.readAndClear(this);
        if (lastCrash != null) {
            new AlertDialog.Builder(this)
                .setTitle("The app closed unexpectedly last time")
                .setMessage(lastCrash)
                .setPositiveButton("OK", null)
                .show();
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // The system status/nav bars can reappear after a dialog, keyboard,
        // or app-switch — re-hide them whenever this window regains focus,
        // which is the standard pattern for sticky immersive mode.
        if (hasFocus) {
            enterImmersiveFullscreen();
        }
    }

    // Draws the WebView edge-to-edge behind the status/navigation bars and
    // hides them, swipe-to-reveal only. Without this, Android reserves
    // space for those bars and the game never actually covers the whole
    // screen even though its own CSS fills 100vw/100vh of what's left.
    private void enterImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }
}
