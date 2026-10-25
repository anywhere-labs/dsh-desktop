/**
 * Config-dump entry for `dsh --profile <name> --dump-config`: compose the
 * profile's patch layers through the include plugin's patch algorithm without
 * booting or evaluating `!!js`, with one source layer per bundle, the
 * profile's own patch file, and each `--patch` overlay.
 * @module @deepseek-ai/dsh/dump-config
 */
import { type ConfigDumpLayer, type Profile } from '@deepseek-ai/dsh-app-boot';
/**
 * Print a profile composition with comments naming each source file and patch layer.
 * @param profile - the profile name.
 * @param defaultOnly - omit the profile's user layer and `--patch` overlays
 * (the recovery diagnostic for a broken `cordis.patch.yml`, which is then
 * never parsed).
 * @param patches - `--patch` overlay paths, in argv order.
 * @param fromDefaultProfile - shipped template that replaces the profile before loading it.
 */
export declare function runDumpConfig(profile: string, defaultOnly: boolean, patches: readonly string[], fromDefaultProfile?: string): void;
/**
 * Read dump layers in bundle, profile, home, then argv order without composing them.
 * @param loaded - prepared profile and parsed bundle and profile patches.
 * @param defaultOnly - omit profile, home, and argv layers without reading their files.
 * @param patches - overlay paths relative to the invoking directory, in argv order.
 * @returns the labeled layers shared by YAML and schema dumps.
 */
export declare function collectConfigDumpLayers(loaded: Profile, defaultOnly: boolean, patches: readonly string[]): ConfigDumpLayer[];
//# sourceMappingURL=dump-config.d.ts.map