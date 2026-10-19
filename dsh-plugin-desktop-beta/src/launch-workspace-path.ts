import { posix, win32 } from 'node:path'

/**
 * Explicit launcher hand-off naming the folders to register as one workspace.
 *
 * The npm launcher spawns Electron with its own `main.js` entry, so a bare
 * folder argument would be indistinguishable from a background Node re-entry
 * once it reaches the running instance. The flag keeps the two apart.
 *
 * Repeat the flag once per folder. Pass every folder in the
 * `--dsh-desktop-workspace=<path>` form. Chromium rebuilds a second instance
 * command line as switches first and positional arguments last, which tears a
 * space separated value away from its flag and leaves several values merged
 * into one reordered tail that the flags no longer delimit.
 */
export const DESKTOP_WORKSPACE_ARGUMENT = '--dsh-desktop-workspace'

/** Attached form that survives a Chromium command line rebuild intact. */
const WORKSPACE_ARGUMENT_PREFIX = `${DESKTOP_WORKSPACE_ARGUMENT}=`

/** Folders hand-off recovered from a process command line. */
export interface DesktopLaunchWorkspaceRequest {
  /** Absolute folders the launch asked Desktop to open, in launch order. */
  readonly paths: readonly string[]
  /** Whether the launcher named the folders through its own flag. */
  readonly explicit: boolean
}

const NODE_ENTRY = /\.(?:c|m)?js$/iu

/** Judge absoluteness with the semantics of the launching platform. */
function isAbsoluteLaunchPath(value: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? win32.isAbsolute(value) : posix.isAbsolute(value)
}

/** Tell a bare folder argument apart from switches and Node entry scripts. */
function isBareLaunchPath(argument: string, platform: NodeJS.Platform): boolean {
  return !argument.startsWith('-')
    && !NODE_ENTRY.test(argument)
    && isAbsoluteLaunchPath(argument, platform)
}

/** Keep launch order while dropping a folder the launcher named twice. */
function pushUnique(paths: string[], value: string): void {
  if (!paths.includes(value)) paths.push(value)
}

/** Collect every absolute folder carried by the attached flag form. */
function attachedLaunchPaths(args: readonly string[], platform: NodeJS.Platform): string[] {
  const paths: string[] = []
  for (const argument of args) {
    if (!argument.startsWith(WORKSPACE_ARGUMENT_PREFIX)) continue
    const value = argument.slice(WORKSPACE_ARGUMENT_PREFIX.length)
    if (isAbsoluteLaunchPath(value, platform)) pushUnique(paths, value)
  }
  return paths
}

/** Collect every absolute folder that a flag still holds in the adjacent slot. */
function spacedLaunchPaths(args: readonly string[], platform: NodeJS.Platform): string[] {
  const paths: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== DESKTOP_WORKSPACE_ARGUMENT) continue
    const value = args[index + 1]
    if (value === undefined || value.startsWith('-') || !isAbsoluteLaunchPath(value, platform)) continue
    pushUnique(paths, value)
    index += 1
  }
  return paths
}

/**
 * Recover a folder hand-off from one argument tail.
 * @param args - arguments after the executable.
 * @param platform - platform whose path semantics apply.
 * @returns the requested folders, or `undefined` when the launch named none.
 */
export function desktopLaunchWorkspaceFromArguments(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): DesktopLaunchWorkspaceRequest | undefined {
  // The attached form wins because it is the only one a command line rebuild
  // cannot detach; repeating it is how one launch names several folders. An
  // attached flag carrying nothing usable refuses the hand-off outright rather
  // than falling back to an unrelated absolute path in the rebuilt tail.
  if (args.some(argument => argument.startsWith(WORKSPACE_ARGUMENT_PREFIX))) {
    const paths = attachedLaunchPaths(args, platform)
    return paths.length === 0 ? undefined : { paths, explicit: true }
  }
  const spaced = spacedLaunchPaths(args, platform)
  if (spaced.length > 0) return { paths: spaced, explicit: true }
  const bare = args.find(argument => isBareLaunchPath(argument, platform))
  if (bare === undefined) return undefined
  // A bare folder stays a single hand-off. The flag still proves intent when
  // Chromium moved the value away from it.
  return { paths: [bare], explicit: args.includes(DESKTOP_WORKSPACE_ARGUMENT) }
}

/**
 * Recover a folder hand-off from a complete command line.
 * @param argv - command line including the executable at index zero.
 * @param platform - platform whose path semantics apply.
 * @returns the requested folders, or `undefined` when the launch named none.
 */
export function desktopLaunchWorkspaceRequest(
  argv: readonly string[] = process.argv,
  platform: NodeJS.Platform = process.platform,
): DesktopLaunchWorkspaceRequest | undefined {
  return desktopLaunchWorkspaceFromArguments(argv.slice(1), platform)
}

/**
 * Drop a folder hand-off so one launch never survives into a relaunch.
 *
 * Every shape a hand-off can take goes, repeated flags included, so the result
 * always reads back as no request at all rather than as a differently shaped
 * one.
 * @param args - arguments after the executable.
 * @param platform - platform whose path semantics apply.
 * @returns the same arguments without the hand-off.
 */
export function desktopArgumentsWithoutLaunchWorkspace(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  const kept: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (argument.startsWith(WORKSPACE_ARGUMENT_PREFIX)) continue
    if (argument === DESKTOP_WORKSPACE_ARGUMENT) {
      const value = args[index + 1]
      if (value !== undefined && !value.startsWith('-')) index += 1
      continue
    }
    if (isBareLaunchPath(argument, platform)) continue
    kept.push(argument)
  }
  return kept
}
