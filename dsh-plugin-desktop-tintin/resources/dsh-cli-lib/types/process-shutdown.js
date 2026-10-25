/** Bounded, escalating process shutdown for the long-lived CLI surfaces. */
/** Maximum grace allowed for the application tree to dispose before process exit. */
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000;
/**
 * Create one process-exit controller around an application disposer.
 * @param dispose - Whole-application teardown that resolves at quiescence.
 * @param forceExit - Function that exits the process immediately, replaceable by tests.
 * @param complete - Function that records the natural completion code, replaceable by tests.
 * @param timeoutMs - Grace before forced exit, replaceable by tests.
 * @returns A controller whose normal calls coalesce and whose repeated signal call escalates.
 */
export function createProcessShutdown(dispose, forceExit = (code) => { process.exit(code); }, complete = (code) => { process.exitCode = code; }, timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS) {
    let pending;
    let timeout;
    let completed = false;
    let forceExited = false;
    const clearExitTimeout = () => {
        /* v8 ignore else -- shutdown() arms the timer before any asynchronous exit path can run. */
        if (timeout !== undefined)
            clearTimeout(timeout);
    };
    const forceExitOnce = (code) => {
        if (forceExited)
            return;
        forceExited = true;
        clearExitTimeout();
        forceExit(code);
    };
    const completeOnce = (code) => {
        if (completed || forceExited)
            return;
        completed = true;
        clearExitTimeout();
        complete(code);
    };
    const start = (code, forceAfterDispose) => {
        if (pending !== undefined)
            return pending;
        timeout = setTimeout(() => { forceExitOnce(code); }, timeoutMs);
        pending = Promise.resolve().then(dispose).then(() => {
            if (forceAfterDispose)
                forceExitOnce(code);
            else
                completeOnce(code);
        }, () => { forceExitOnce(code); });
        return pending;
    };
    return {
        shutdown(code) {
            return start(code, false);
        },
        interrupt(code) {
            if (pending !== undefined) {
                forceExitOnce(code);
                return;
            }
            void start(code, true);
        },
    };
}
//# sourceMappingURL=process-shutdown.js.map