# Runtime renderer recovery

## Context

Issue #813 includes renderer exits reported as `oom`. The shell forwarded every exit to the one-shot startup health gate, which correctly ignores failures after healthy boot but provides no runtime recovery. A dead renderer therefore left the main window blank while the Host remained alive.

## Decision

After a committed healthy boot verdict, unexpected renderer exits automatically reload the existing renderer carrier without restarting the Host, changing window visibility, or asking for confirmation. Runtime main-frame load failures enter the same recovery path; aborted navigation and subframe errors do not. Startup health and installation recovery remain unchanged. Clean exits, explicit kills, and shutdown do not initiate recovery.

Each shell generation owns a recovery controller with three attempts, delayed by zero, one, and three seconds. A reload must produce both a completed page load and a healthy client Loader report within 30 seconds. Failures and missing health evidence consume the same bounded budget. Successfully loading a page alone does not count as recovery. The attempt count resets only after one minute of recovered health, preventing repeated crash/reload/healthy cycles from bypassing the limit. Pending retries coalesce additional failure events. Disposal and shutdown cancel every recovery timer and invalidate delayed fallback confirmations.

Only exhausted automatic recovery opens a user-facing fallback prompt. Explicit consent starts another bounded recovery cycle. Cancelling preserves the exhausted state so opening the window from the tray offers the fallback again. A hidden window is not revealed during automatic recovery. Reloading can briefly interrupt the display and lose unsent input; no claim of preserving arbitrary in-memory client state is made.

The degraded-state prompt deliberately uses Electron's system-native message box rather than DesktopDialogWindow: recovery from a renderer OOM must not require another Chromium-rendered UI. English and Chinese copy explains unsent-input loss and directs repeated failures to diagnostics. The existing error log retains the exit reason and Windows exit code.

## Scope and verification

Compatibility mode owns separate content and titlebar WebContents. Crash and load-failure listeners follow those carriers instead of the BrowserWindow host. Automatic recovery reloads both carriers and waits for both documents plus the content Loader's healthy report; a titlebar crash therefore cannot be mistaken for successful recovery after reloading only the conversation. Extended and advanced modes continue to use the window's renderer. Regression tests exercise content and titlebar crashes with distinct mocked WebContents.

This change restores the interface automatically after a renderer exit; it neither diagnoses nor fixes renderer memory growth. It does not modify the upstream submodule. Headless tests cover health evidence ordering, timeout and Loader failures, synchronous reload errors, stable-period budget reset, crash loops, silent OOM/native-crash recovery, hidden-window preservation, failed main-frame loads, fallback deduplication, explicit retry, localization, intentional termination, shutdown/disposal races, and prompt failure. Windows GUI verification remains necessary to confirm automatic reload and the fallback prompt against an actual crashed renderer.
