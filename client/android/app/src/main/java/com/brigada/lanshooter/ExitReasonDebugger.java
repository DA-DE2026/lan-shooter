package com.brigada.lanshooter;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Date;
import java.util.List;

// Debug-only helper: reads Android's own record of why this app's process
// last exited, via ApplicationExitInfo (API 30+). Unlike CrashHandler's
// Thread.UncaughtExceptionHandler (which only sees Java-level exceptions),
// this is the OS's own bookkeeping, so it ALSO sees native crashes — e.g.
// a SIGSEGV inside a plugin's compiled C/C++ code — that never reach the
// JVM at all. No adb, no root, no READ_LOGS permission needed: this is a
// standard, permission-free API meant specifically for apps to self-
// diagnose their own exits.
final class ExitReasonDebugger {
    private static final String PREFS = "ExitReasonDebugger";
    private static final String KEY_LAST_SHOWN_TIMESTAMP = "lastShownTimestamp";
    private static final int MAX_TRACE_CHARS = 8000; // keep the dialog readable

    /** Returns a human-readable report of the app's last abnormal exit, or null if there's nothing new to show. */
    static String checkForNewCrash(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return null; // ApplicationExitInfo requires API 30+
        }

        ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        List<ApplicationExitInfo> reasons = am.getHistoricalProcessExitReasons(null, 0, 5);
        if (reasons.isEmpty()) return null;

        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long lastShown = prefs.getLong(KEY_LAST_SHOWN_TIMESTAMP, 0);

        ApplicationExitInfo latest = reasons.get(0);
        if (latest.getTimestamp() <= lastShown) return null; // already shown this one

        int reason = latest.getReason();
        if (!isAbnormal(reason)) {
            prefs.edit().putLong(KEY_LAST_SHOWN_TIMESTAMP, latest.getTimestamp()).apply();
            return null;
        }

        StringBuilder sb = new StringBuilder();
        sb.append("Reason: ").append(reasonToString(reason)).append(" (code ").append(reason).append(")\n");
        sb.append("Status: ").append(latest.getStatus()).append('\n');
        String description = latest.getDescription();
        if (description != null) sb.append("Description: ").append(description).append('\n');
        sb.append("Importance at exit: ").append(latest.getImportance()).append('\n');
        sb.append("PID: ").append(latest.getPid()).append('\n');
        sb.append("Timestamp: ").append(new Date(latest.getTimestamp())).append('\n');

        String trace = readTrace(latest);
        if (trace != null && !trace.isEmpty()) {
            sb.append("\n--- Trace ---\n").append(trace);
        }

        prefs.edit().putLong(KEY_LAST_SHOWN_TIMESTAMP, latest.getTimestamp()).apply();
        return sb.toString();
    }

    private static boolean isAbnormal(int reason) {
        return reason == ApplicationExitInfo.REASON_CRASH_NATIVE
            || reason == ApplicationExitInfo.REASON_CRASH
            || reason == ApplicationExitInfo.REASON_ANR
            || reason == ApplicationExitInfo.REASON_SIGNALED
            || reason == ApplicationExitInfo.REASON_LOW_MEMORY
            || reason == ApplicationExitInfo.REASON_DEPENDENCY_DIED
            || reason == ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE
            || reason == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE;
    }

    private static String readTrace(ApplicationExitInfo info) {
        try (InputStream in = info.getTraceInputStream()) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            int total = 0;
            while (total < MAX_TRACE_CHARS && (n = in.read(buf)) != -1) {
                int take = Math.min(n, MAX_TRACE_CHARS - total);
                out.write(buf, 0, take);
                total += take;
            }
            return out.toString("UTF-8");
        } catch (IOException e) {
            return null;
        }
    }

    private static String reasonToString(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_ANR: return "ANR (app not responding)";
            case ApplicationExitInfo.REASON_CRASH: return "Crash (Java exception)";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "Native crash (e.g. SIGSEGV)";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "A dependency (e.g. a bound service) died";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "Excessive resource usage";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "Initialization failure";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "Killed by the system (low memory)";
            case ApplicationExitInfo.REASON_SIGNALED: return "Killed by a Unix signal";
            default: return "Unknown (" + reason + ")";
        }
    }
}
