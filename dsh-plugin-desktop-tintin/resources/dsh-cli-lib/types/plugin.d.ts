import { type ProfileContext } from '@deepseek-ai/dsh-app-boot';
/** Run package management for a profile.
 * @param profile Profile name; Desktop's reserved profile must already be initialized by the application.
 * @param args DSH exemption command or pnpm arguments relative to the invoking directory.
 * @param packageManager Installation-owned executable and environment for pnpm operations.
 * @returns Zero on success; nonzero on invalid approval or package-manager failure.
 */
export declare function runPlugin(profile: string, args: readonly string[], packageManager?: ProfileContext['packageManager']): Promise<number>;
//# sourceMappingURL=plugin.d.ts.map