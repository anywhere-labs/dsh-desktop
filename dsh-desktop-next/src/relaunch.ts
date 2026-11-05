import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { NEXT_APP_ID } from './update-installer.ts'

/** Explicit launch modes survive a native relaunch without leaking into later restarts. */
export const RECOVERY_ARGUMENT = '--next-recovery'
export const SAFE_ARGUMENT = '--next-safe-mode'
export const ONBOARDING_ARGUMENT = '--next-onboarding'
/** Marks the instance an elevated Windows launch restarted with the user's normal token; never carried forward. */
export const DE_ELEVATED_ARGUMENT = '--next-de-elevated'

export function relaunchArguments(argv: readonly string[], recovery: boolean, safe: boolean, onboarding = false): string[] {
  return [...argv.filter(value => value !== RECOVERY_ARGUMENT && value !== SAFE_ARGUMENT && value !== ONBOARDING_ARGUMENT && value !== DE_ELEVATED_ARGUMENT),
    ...recovery ? [RECOVERY_ARGUMENT] : safe ? [SAFE_ARGUMENT] : onboarding ? [ONBOARDING_ARGUMENT] : []]
}

/** The part of `child_process.spawn` that a relaunch through a detached shell needs. */
export type RelaunchSpawn = (command: string, args: readonly string[], options: SpawnOptions) => Pick<ChildProcess, 'on' | 'unref'>

/** Injectable process facts for {@link relaunchApp}. */
export interface RelaunchEnvironment {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  pid?: number
  /** Pid of the extracting AppImage runtime that owns this run, if any. */
  runtimePid?: number | undefined
  /** This process's executable; inside a macOS app, the bundle's main executable. */
  executable?: string
  /** Identifier of this app's bundle, which LaunchServices puts in `__CFBundleIdentifier`. */
  bundleIdentifier?: string
  spawn?: RelaunchSpawn
  reportError?: (cause: Error) => void
}

/**
 * POSIX `sh` handoff run as `sh -c SCRIPT <pid> <bundle> <executable> [args...]`.
 *
 * It waits for the old app to exit first: until then LaunchServices would only
 * activate the instance that is quitting, and a new one would lose the
 * single-instance lock to it. If `open` fails, the executable starts the way
 * Electron's relauncher would have started it.
 */
export const MAC_RELAUNCH_SCRIPT = [
  'bundle=$1 executable=$2',
  'shift 2',
  'while kill -0 "$0" 2>/dev/null; do sleep 0.1; done',
  '/usr/bin/open -n -a "$bundle" --args "$@" || exec "$executable" "$@"',
].join('\n')

/**
 * The app bundle to restart through LaunchServices, when LaunchServices started this run.
 *
 * LaunchServices sets `__CFBundleIdentifier` to the identifier of the app it
 * starts, and child processes inherit it. It therefore names this app after a
 * launch from Finder, the Dock, `open` or a login item, and after an in-app
 * relaunch of such a run. A run started from a terminal, a development script or
 * a test harness inherits its launcher's value instead.
 */
function launchServicesBundle(executable: string, env: NodeJS.ProcessEnv, bundleIdentifier: string): string | undefined {
  if (env.__CFBundleIdentifier !== bundleIdentifier) return undefined
  return /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/u.exec(executable)?.[1]
}

/**
 * Pid of the AppImage runtime that extracted this run, when there is one.
 *
 * With `--appimage-extract-and-run` (or `APPIMAGE_EXTRACT_AND_RUN=1`) the
 * runtime unpacks the image into a directory named after its hash, stays
 * behind as this process's parent, and deletes that directory once the app
 * exits. A FUSE-mounted run replaces the runtime with the app instead.
 */
export function appImageExtractingRuntimePid(
  appImage: string,
  parentPid: number = process.ppid,
  resolve: (path: string) => string = realpathSync,
): number | undefined {
  try {
    return resolve(`/proc/${parentPid}/exe`) === resolve(appImage) ? parentPid : undefined
  } catch {
    return undefined
  }
}

/**
 * Bash handoff run as `bash -c SCRIPT '<pid>...' <AppImage> [args...]`.
 *
 * It closes every inherited descriptor above stderr first (`child_process`
 * passes on whatever the main process left without close-on-exec: files in
 * the old mount, the old crash handler's socket, listening sockets), then
 * waits for every listed pid: the old app, so the new one gets the
 * single-instance lock, and an extracting runtime, so it has finished deleting
 * the directory the new runtime extracts into again. POSIX `sh` cannot close
 * descriptors above 9; `AppRun` needs bash anyway.
 */
export const APPIMAGE_RELAUNCH_SCRIPT = [
  'for fd in /proc/$$/fd/*; do fd=${fd##*/}; if [ "$fd" -gt 2 ]; then eval "exec $fd>&-"; fi; done',
  'for pid in $0; do while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done; done',
  'exec "$@"',
].join('\n')

/** Drop this run's mount from the search paths `AppRun` prefixed, so restarts do not pile them up. */
export function appImageRelaunchEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  const appDir = env.APPDIR
  if (!appDir) return next
  for (const name of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']) {
    const value = next[name]
    if (value === undefined) continue
    const kept = value.split(':').filter(entry => entry !== appDir && !entry.startsWith(`${appDir}/`))
    if (kept.length === 0) delete next[name]
    else next[name] = kept.join(':')
  }
  return next
}

/**
 * Schedule a new app process with `args` once this one exits.
 *
 * Usually this is `app.relaunch({ args })`. Two kinds of run are restarted by a
 * detached shell spawned from the main process instead.
 *
 * On macOS, Electron's relauncher waits for this process to exit and then
 * spawns the new one itself, so macOS keeps this exited process responsible for
 * the new app and every child it starts. Permissions such as Local Network then
 * no longer reach the app: its children's LAN connections fail at once with
 * EHOSTUNREACH and no prompt appears (#1515). A run that LaunchServices started
 * is restarted through LaunchServices, as Finder and the Dock start it, and gets
 * the environment LaunchServices gives every launch. Other runs keep Electron's
 * relauncher, which preserves the environment they inherited.
 *
 * Inside an AppImage, Electron's relauncher cannot restart the app: its default
 * target lives in this run's `/tmp/.mount_*` FUSE mount, which is torn down with
 * this process, and targeting `$APPIMAGE` instead fails because Chromium starts
 * the relauncher helper with `no_new_privs`, so the new runtime's setuid
 * `fusermount` cannot mount the image. The shell keeps normal privileges, waits
 * for this pid to exit, then execs the AppImage file. An extracted run restarts
 * extracted, since the runtime consumes `--appimage-extract-and-run` and FUSE is
 * usually why it was used.
 */
export function relaunchApp(
  app: { relaunch(options: { args: string[] }): void },
  args: readonly string[],
  environment: RelaunchEnvironment = {},
): void {
  const platform = environment.platform ?? process.platform
  const env = environment.env ?? process.env
  const executable = environment.executable ?? process.execPath
  const bundle = platform === 'darwin' ? launchServicesBundle(executable, env, environment.bundleIdentifier ?? NEXT_APP_ID) : undefined
  if (bundle !== undefined) {
    const child = (environment.spawn ?? spawn)('/bin/sh',
      ['-c', MAC_RELAUNCH_SCRIPT, String(environment.pid ?? process.pid), bundle, executable, ...args],
      { detached: true, stdio: 'ignore', env })
    child.on('error', environment.reportError
      ?? ((cause: Error) => { console.error(`LaunchServices relaunch failed: ${cause.message}`) }))
    child.unref()
    return
  }
  const appImage = platform === 'linux' ? env.APPIMAGE : undefined
  if (!appImage) {
    app.relaunch({ args: [...args] })
    return
  }
  const reportError = environment.reportError
    ?? ((cause: Error) => { console.error(`AppImage relaunch failed: ${cause.message}`) })
  const runtimePid = 'runtimePid' in environment ? environment.runtimePid : appImageExtractingRuntimePid(appImage)
  const pids = [environment.pid ?? process.pid, ...(runtimePid === undefined ? [] : [runtimePid])]
  const childEnv = appImageRelaunchEnvironment(env)
  if (runtimePid !== undefined) childEnv.APPIMAGE_EXTRACT_AND_RUN = '1'
  const child = (environment.spawn ?? spawn)('/usr/bin/env',
    ['bash', '-c', APPIMAGE_RELAUNCH_SCRIPT, pids.join(' '), appImage, ...args],
    { detached: true, stdio: 'ignore', env: childEnv })
  child.on('error', reportError)
  child.unref()
}
