/**
 * Linux without a display server (a server or an SSH session). Chromium picks its Ozone platform before this
 * script runs, so a launch that finds no display restarts itself on the headless platform. That launch shows no
 * tray, window or native dialog: the user reaches DSH through browser access at the link it prints.
 */

/** Chromium's display-free Ozone platform. */
export const HEADLESS_PLATFORM_SWITCH = '--ozone-platform=headless'

/**
 * The arguments that restart a Linux launch on the headless platform when no display server is available.
 * @param platform - Node platform; only Linux has Ozone platforms.
 * @param environment - The launch environment: X11 sets `DISPLAY`, Wayland sets `WAYLAND_DISPLAY`.
 * @param argv - `process.argv` of the main process.
 * @returns the arguments after the executable, or `undefined` when the launch proceeds: a display exists or a
 * platform was already chosen, which also ends the restart after one step.
 */
export function displaylessRestartArguments(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv, argv: readonly string[]): string[] | undefined {
  if (platform !== 'linux' || environment.DISPLAY || environment.WAYLAND_DISPLAY) return undefined
  const args = argv.slice(1)
  if (args.some(arg => arg === '--ozone-platform' || arg.startsWith('--ozone-platform='))) return undefined
  // Chromium reads no switch after `--`.
  const end = args.indexOf('--')
  args.splice(end < 0 ? args.length : end, 0, HEADLESS_PLATFORM_SWITCH)
  return args
}

/**
 * Whether this launch runs on the headless platform, whether restarted onto it or started there explicitly.
 * @param platform - Node platform.
 * @param argv - `process.argv` of the main process.
 */
export function displaylessLaunch(platform: NodeJS.Platform, argv: readonly string[]): boolean {
  return platform === 'linux' && argv.includes(HEADLESS_PLATFORM_SWITCH)
}
