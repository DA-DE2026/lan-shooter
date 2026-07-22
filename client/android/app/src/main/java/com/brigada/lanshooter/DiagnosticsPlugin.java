package com.brigada.lanshooter;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Exposes the app's last-crash report (see CrashHandler and
// ExitReasonDebugger) to the webview, so it can be shown directly in the
// connect screen's UI. A native AlertDialog was tried first, but proved
// unreliable — it never appeared on at least one real device, likely due
// to OEM Android skin restrictions on non-activity dialogs. Rendering the
// same text inside the already-working webview is far more robust, since
// that rendering pipeline is exactly what the rest of the game already
// depends on working.
@CapacitorPlugin(name = "Diagnostics")
public class DiagnosticsPlugin extends Plugin {
    @PluginMethod
    public void getLastCrashReport(PluginCall call) {
        StringBuilder report = new StringBuilder();

        String javaCrash = CrashHandler.readAndClear(getContext());
        if (javaCrash != null) {
            report.append("[Java exception]\n").append(javaCrash).append('\n');
        }

        String exitInfo = ExitReasonDebugger.checkForNewCrash(getContext());
        if (exitInfo != null) {
            report.append("[Process exit reason]\n").append(exitInfo);
        }

        JSObject result = new JSObject();
        result.put("report", report.length() > 0 ? report.toString() : null);
        call.resolve(result);
    }
}
