# Runtime renderer surface watchdog

## Context

After #869, a window whose page became empty without a renderer exit could remain blank: recovery only observed process exits and load errors. A settled Loader does not prove that React still renders visible content. Stable uses a single renderer; beta retains its separately owned compatibility titlebar.

## Decision

The Electron shell owns a serial five-second watchdog for the content renderer after healthy startup. The probe checks the existing web mount container, root, for meaningful visible text, controls, images, SVG, or canvas within the viewport. It scans at most 2048 elements, returning inconclusive at the bound. Two consecutive failures feed the existing bounded recovery controller. Ten-second response deadlines are owned by the main process, so blocked renderer JavaScript cannot prevent detection. A persistently unresponsive renderer is terminated with forcefullyCrashRenderer before reload; the expected process-exit notification is consumed without charging a second recovery attempt.

Checks are disabled while the window is hidden/minimized, the page is navigating, startup is pending, or recovery has not received both document and Loader readiness. Hiding and navigation invalidate in-flight results. A probe delayed beyond twenty seconds is treated as inconclusive to avoid treating a suspended computer as renderer failure. All timers stop with the shell or shutdown. The existing recovery budget prevents blank/reload cycles from running indefinitely.

Visible recovery requires a successful DOM surface probe in addition to document load and Loader health. Hidden recovery can finish without geometry evidence, including a document Chromium reports hidden while its native window remains visible. Probes return only visible-content, hidden, or inconclusive status; no page content or screenshots are retained. They cannot detect compositor/GPU faults when the DOM remains valid and responsive.

## Validation

Shared controller tests cover empty pages, deadlines, visibility transitions, navigation epochs, suspension and disposal. Both variants have regression cases for a live-but-empty page and a renderer that never responds, as well as a visibility-aware recovery gate. A real headless Chrome check executes the production probe against normal content, missing/empty roots, transparent/hidden/offscreen content, loading indicators, and a root cleared after initial render. Windows Electron field reproduction still requires a current diagnostic bundle; these checks demonstrate the newly covered failure mechanisms rather than identifying the cause of every blank frame.
