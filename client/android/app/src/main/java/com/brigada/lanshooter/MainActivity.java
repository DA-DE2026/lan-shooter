package com.brigada.lanshooter;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
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
        showCrashReportIfAny();
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

    // Debug-only: surfaces why the app last exited abnormally, combining
    // two sources — a Java-level uncaught exception (CrashHandler, catches
    // anything the JVM sees) and Android's own ApplicationExitInfo record
    // (ExitReasonDebugger, which ALSO sees native crashes — e.g. a SIGSEGV
    // inside a plugin's compiled C/C++ code — that never reach the JVM at
    // all and so are invisible to CrashHandler). Shown with a Copy button
    // so the text can be pasted elsewhere for diagnosis.
    private void showCrashReportIfAny() {
        StringBuilder report = new StringBuilder();

        String javaCrash = CrashHandler.readAndClear(this);
        if (javaCrash != null) {
            report.append("[Java exception]\n").append(javaCrash).append('\n');
        }

        String exitInfo = ExitReasonDebugger.checkForNewCrash(this);
        if (exitInfo != null) {
            report.append("[Process exit reason]\n").append(exitInfo);
        }

        if (report.length() == 0) return;

        String reportText = report.toString();
        new AlertDialog.Builder(this)
            .setTitle("The app closed unexpectedly last time")
            .setMessage(reportText)
            .setPositiveButton("Copy", (dialog, which) -> {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("Crash report", reportText));
            })
            .setNegativeButton("Dismiss", null)
            .show();
    }
}
