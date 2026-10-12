# Forced renderer replacement and its reload

## Context

The surface watchdog terminates a renderer that stops answering probes and then reloads it. `forcefullyCrashRenderer()` returns before the process is gone, so the reload issued in the same turn was handed to a RenderFrameHost already being torn down and was cancelled along with the process. The expected exit was consumed without a log line and without re-arming recovery, and `render-process-gone` excludes `killed` from recovery regardless, so nothing reissued the load. Every attempt therefore spent the full thirty-second health budget waiting for a page that had never been requested, and three attempts exhausted recovery 124 seconds after the first failed probe, with no user-visible state in between. On Windows the termination also writes a crash dump for the hung process, which triage could not separate from a spontaneous renderer crash.

## Decision

A forced termination now owns the reload that follows it. `reloadRenderer` issues the termination and returns; `render-process-gone` consumes the expected exit and starts the reload, which lets Chromium spawn a fresh renderer. A ten-second deadline covers an exit notification that never arrives and reloads without it, staying inside the recovery controller's thirty-second health budget. That deadline replaces the untimed expectation flag, which stayed armed indefinitely and could swallow the next genuine crash. Both the termination and the exit it produces are logged, so a deliberate crash dump is attributable in a collected diagnostic bundle.

The tray gains a Reload Interface command. Every other reload affordance is drawn by the content renderer or reached over its HTTP route, so all of them are gone exactly when a reload is needed. An exhausted recovery is restarted through its own controller, so a successful native reload also clears the degraded state instead of leaving the fallback prompt armed.

## Validation

Regression tests in both editions cover a terminated renderer whose exit arrives asynchronously, a termination that never reports one, and the native reload clearing an exhausted recovery. Recovery attempt budgets, the surface watchdog, and the fallback prompt are otherwise unchanged. This change does not address renderer memory growth, which remains the undiagnosed cause behind #813; it stops the watchdog from converting that growth into an unrecoverable blank window. Windows GUI verification against a genuinely hung renderer is still required.
