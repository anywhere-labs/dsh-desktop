/**
 * Commander adapter for the `dsh` command line.
 *
 * The launcher parses only what it owns — which profile to boot, which extra
 * patch overlays to apply, and the config dumps — and hands **everything after
 * its own flags** to the booted tree verbatim, where injected app plugins parse
 * their own flag families and print their own `--help` (see
 * `@deepseek-ai/dsh-cmdline`). Launcher flags therefore come first: the first
 * token this parser does not recognize starts the inner arguments, so
 * `dsh --profile tui --resume abc` boots the tui profile with `--resume abc`,
 * and `dsh --profile web -h` prints the web app's help, not this one's.
 *
 * `dsh <name>` abbreviates `dsh --profile <name>`; `plugin` manages a profile's
 * plugin dependencies by forwarding to pnpm.
 * @module @deepseek-ai/dsh/args
 */
/** Boot a named profile and hand it the invocation's inner arguments. */
interface ProfileInvocation {
    mode: 'profile';
    profile: string;
    /** Shipped template that replaces the named profile. */
    fromDefaultProfile?: string | undefined;
    /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
    patches: string[];
    /** Everything after the launcher's own flags, verbatim, for injected app plugins. */
    args: string[];
}
/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
    mode: 'dump-config';
    profile: string;
    /** Shipped template that replaces the named profile. */
    fromDefaultProfile?: string | undefined;
    /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
    defaultOnly: boolean;
    patches: string[];
}
/** Print declared plugin schemas without mounting the profile. */
interface DumpConfigSchemaInvocation {
    mode: 'dump-config-schema';
    profile: string;
    /** Shipped template that replaces the named profile. */
    fromDefaultProfile?: string | undefined;
    patches: string[];
}
/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
interface PluginInvocation {
    mode: 'plugin';
    profile: string;
    /** Raw pnpm arguments, verbatim. */
    args: string[];
}
/** The resolved `dsh` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
export type DshInvocation = ProfileInvocation | DumpConfigInvocation | DumpConfigSchemaInvocation | PluginInvocation;
/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @param manageDesktopProfile - permit Desktop's installed carrier to manage its reserved profile's plugins.
 * @returns the resolved invocation.
 */
export declare function parseDshArgs(argv: readonly string[], version: string, manageDesktopProfile?: boolean): DshInvocation;
export {};
//# sourceMappingURL=args.d.ts.map