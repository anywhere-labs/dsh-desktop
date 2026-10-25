/** Save original startup diagnostics while keeping the terminal report concise. */
import type { StartupError } from '@deepseek-ai/dsh-app-boot';
/** Launcher-owned context; no environment values or plugin configurations are collected. */
interface StartupDiagnosticContext {
    home: string;
    version: string;
    profile: string;
}
/**
 * Print the startup summary and save a private, uniquely named report under DSH_HOME/logs.
 * Failed writes print the complete report to stderr instead of claiming a saved path.
 * @param error - startup audit failure retaining plugin metadata and original errors.
 * @param context - resolved Harness home, application version, and selected profile.
 * @param write - terminal output sink; awaited before returning, defaults to stderr.
 * @returns after saving or printing the report and completing terminal writes.
 */
export declare function reportStartupFailure(error: StartupError, context: StartupDiagnosticContext, write?: (text: string) => void | Promise<void>): Promise<void>;
export {};
//# sourceMappingURL=startup-diagnostics.d.ts.map