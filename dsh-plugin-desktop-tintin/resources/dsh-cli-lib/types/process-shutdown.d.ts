/** Bounded, escalating process shutdown for the long-lived CLI surfaces. */
/** Maximum grace allowed for the application tree to dispose before process exit. */
export declare const PROCESS_SHUTDOWN_TIMEOUT_MS = 5000;
/** Process-exit controller shared by normal completion and Unix signal handlers. */
export interface ProcessShutdown {
    /** Start or join graceful disposal before allowing natural completion with `code`. */
    shutdown(code: number): Promise<void>;
    /** Start graceful disposal followed by exit, or force exit when shutdown is already running. */
    interrupt(code: number): void;
}
/**
 * Create one process-exit controller around an application disposer.
 * @param dispose - Whole-application teardown that resolves at quiescence.
 * @param forceExit - Function that exits the process immediately, replaceable by tests.
 * @param complete - Function that records the natural completion code, replaceable by tests.
 * @param timeoutMs - Grace before forced exit, replaceable by tests.
 * @returns A controller whose normal calls coalesce and whose repeated signal call escalates.
 */
export declare function createProcessShutdown(dispose: () => Promise<void>, forceExit?: (code: number) => void, complete?: (code: number) => void, timeoutMs?: number): ProcessShutdown;
//# sourceMappingURL=process-shutdown.d.ts.map