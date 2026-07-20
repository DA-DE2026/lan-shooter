package com.brigada.lanshooter;

import android.content.Context;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;

// Installs a global uncaught-exception handler that writes the crash to a
// plain-text file before letting the process die normally, so it can be
// shown to the player on the next launch. capacitor-nodejs (the embedded
// Node.js runtime, still in beta) starts the mobile Node process on a bare
// Thread with no exception handling of its own — a failure there (or any
// other uncaught exception app-wide) previously just closed the app with
// no visible reason. This makes that reason readable instead of silent.
// Note: this only catches Java-level exceptions; a genuine native crash
// (e.g. a segfault inside the embedded Node runtime's own C/C++ code)
// bypasses the JVM entirely and won't be caught here.
final class CrashHandler implements Thread.UncaughtExceptionHandler {
    private static final String CRASH_FILE = "last_crash.txt";

    private final Context appContext;
    private final Thread.UncaughtExceptionHandler previousHandler;

    private CrashHandler(Context appContext, Thread.UncaughtExceptionHandler previousHandler) {
        this.appContext = appContext;
        this.previousHandler = previousHandler;
    }

    static void install(Context context) {
        Thread.UncaughtExceptionHandler existing = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new CrashHandler(context.getApplicationContext(), existing));
    }

    @Override
    public void uncaughtException(Thread thread, Throwable ex) {
        try {
            StringWriter sw = new StringWriter();
            ex.printStackTrace(new PrintWriter(sw));
            File file = new File(appContext.getFilesDir(), CRASH_FILE);
            try (FileWriter writer = new FileWriter(file)) {
                writer.write("Thread: " + thread.getName() + "\n\n" + sw);
            }
        } catch (IOException ignored) {
            // Best-effort — if we can't write the crash file, still let the
            // app terminate normally below.
        }

        if (previousHandler != null) {
            previousHandler.uncaughtException(thread, ex);
        } else {
            System.exit(1);
        }
    }

    /** Returns the last recorded crash text, or null if there isn't one. Clears it after reading. */
    static String readAndClear(Context context) {
        File file = new File(context.getFilesDir(), CRASH_FILE);
        if (!file.exists()) return null;

        try {
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line).append('\n');
                }
            }
            file.delete();
            return sb.toString();
        } catch (IOException e) {
            return null;
        }
    }
}
