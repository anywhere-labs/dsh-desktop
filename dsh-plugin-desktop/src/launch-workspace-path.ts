import { posix, win32 } from 'node:path'

/**
 * Explicit launcher hand-off naming the folder to register as a workspace.
 *
 * The npm launcher spawns Electron with its own `main.js` entry, so a bare
 * folder argument would be indistinguishable from a background Node re-entry
 * once it reaches the running instance. The flag keeps the two apart.
 *
 * Pass the folder in the `--dsh-desktop-workspace=<path>` form. Chromium
 * rebuilds a second instance command line as switches first and positional
 * arguments last, which tears a space separated value away from its flag.
 */
export const DESKTOP_WORKSPACE_ARGUMENT = '--dsh-desktop-workspace'

/** Attached form that survives a Chromium command line rebuild intact. */
const WORKSPACE_ARGUMENT_PREFIX = `${DESKTOP_WORKSPACE_ARGUMENT}=`

/** One folder hand-off recovered from a process command line. */
export interface DesktopLaunchWorkspaceRequest {
  /** Absolute folder the launch asked Desktop to open. */
  readonly path: string
  /** Whether the launcher named the folder through its own flag. */
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

/**
 * Recover a folder hand-off from one argument tail.
 * @param args - arguments after the executable.
 * @param platform - platform whose path semantics apply.
 * @returns the requested folder, or `undefined` when the launch named none.
 */
export function desktopLaunchWorkspaceFromArguments(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): DesktopLaunchWorkspaceRequest | undefined {
  const attached = args.find(argument => argument.startsWith(WORKSPACE_ARGUMENT_PREFIX))
  if (attached !== undefined) {
    const value = attached.slice(WORKSPACE_ARGUMENT_PREFIX.length)
    return isAbsoluteLaunchPath(value, platform) ? { path: value, explicit: true } : undefined
  }
  const bare = args.find(argument => isBareLaunchPath(argument, platform))
  if (!args.includes(DESKTOP_WORKSPACE_ARGUMENT)) {
    return bare === undefined ? undefined : { path: bare, explicit: false }
  }
  const adjacent = args[args.indexOf(DESKTOP_WORKSPACE_ARGUMENT) + 1]
  if (adjacent !== undefined && isAbsoluteLaunchPath(adjacent, platform)) {
    return { path: adjacent, explicit: true }
  }
  // Chromium reordered the command line and the value no longer follows the
  // flag. The flag still proves the launcher named this folder on purpose.
  return bare === undefined ? undefined : { path: bare, explicit: true }
}

/**
 * Recover a folder hand-off from a complete command line.
 * @param argv - command line including the executable at index zero.
 * @param platform - platform whose path semantics apply.
 * @returns the requested folder, or `undefined` when the launch named none.
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
 * Every shape a hand-off can take goes, so the result always reads back as no
 * request at all rather than as a differently shaped one.
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
