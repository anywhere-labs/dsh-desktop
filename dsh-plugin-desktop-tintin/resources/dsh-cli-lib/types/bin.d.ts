#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */
import type { RunProfileOptions } from './profile-boot.ts';
/** Installation-owned dependencies supplied by a packaged CLI launcher. */
export type RunCliOptions = Pick<RunProfileOptions, 'packageManager'> & {
    /** Permit plugin commands for Desktop's existing profile; reserved for its installed carrier. */
    manageDesktopProfile?: boolean;
};
/**
 * Run the public dsh command-line interface.
 * @param options - Package runtime and Desktop profile access supplied by the installation.
 * @returns a promise that settles when the selected command mode finishes.
 */
export declare function runCli(options?: RunCliOptions): Promise<void>;
//# sourceMappingURL=bin.d.ts.map