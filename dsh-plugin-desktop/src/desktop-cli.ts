/** Private RunAsNode bootstrap for the packaged DeepSeek Harness CLI. */

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import { assertDesktopProfileName } from './profile-manager.ts'
import { withoutForwardedDesktopPnpmPolicy } from './pnpm-policy.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const DEFAULT_PROFILE = 'DSH_DESKTOP_DEFAULT_PROFILE'
const DSH_ENTRY_URL = pathToFileURL(
  packagedDependencyPath(import.meta.url, '@deepseek-ai/dsh/lib/bin.js'),
).href

export function clearElectronRunAsNode(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === RUN_AS_NODE) delete environment[key]
  }
}

export function withDefaultDesktopProfile(argv: readonly string[], profileName: string): string[] {
  assertDesktopProfileName(profileName)
  if (argv.some(argument => argument === '--profile' || argument.startsWith('--profile='))) return [...argv]
  const first = argv[0]
  if (first === 'web' || first === '--help' || first === '-h' || first === '--version' || first === '-V') {
    return [...argv]
  }
  if (first === 'plugin') return ['plugin', '--profile', profileName, ...argv.slice(1)]
  return ['--profile', profileName, ...argv]
}

/** Resolver installer seam used by unit tests; production uses the Desktop hook. */
export type ProfilePackageResolverInstaller = (profileBaseUrl: string) => (() => void) | Promise<() => void>

async function defaultProfilePackageResolverInstaller(profileBaseUrl: string): Promise<() => void> {
  const { installProfilePackageResolver } = await import('./module-resolution.ts')
  return installProfilePackageResolver(profileBaseUrl)
}

/** Return a validated profile name, or undefined so the upstream parser owns the error. */
function validatedProfileName(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  try {
    assertDesktopProfileName(value)
    return value
  } catch {
    return undefined
  }
}

/**
 * Find the profile that the DSH parser will boot from its final argv.
 * Only launcher-owned options before pass-through arguments are inspected.
 */
export function profileBootNameFromArgv(argv: readonly string[]): string | undefined {
  const first = argv[0]
  if (first === 'plugin') return undefined

  const webAlias = first === 'web'
  let profileName: string | undefined = webAlias ? 'web' : undefined
  let index = webAlias ? 1 : 0
  if (!webAlias && first !== undefined && !first.startsWith('-')) return undefined

  while (index < argv.length) {
    const argument = argv[index]
    if (argument === undefined || argument === '--') break
    if (argument === '--dump-config' || argument === '--dump-default-config') return undefined

    if (argument === '--patch') {
      const patch = argv[index + 1]
      if (patch === undefined || patch === '--' || patch.length === 0) return undefined
      index += 2
      continue
    }
    if (argument.startsWith('--patch=')) {
      if (argument.length === '--patch='.length) return undefined
      index += 1
      continue
    }

    // The web alias owns only patch and dump flags; every other token belongs
    // to the web app and must not change its profile selection.
    if (webAlias) return profileName

    if (argument === '--profile') {
      const candidate = validatedProfileName(argv[index + 1])
      if (candidate === undefined || argv[index + 1] === '--') return undefined
      if (profileName !== undefined && profileName !== candidate) return undefined
      profileName = candidate
      index += 2
      continue
    }

    if (argument.startsWith('--profile=')) {
      const candidate = validatedProfileName(argument.slice('--profile='.length))
      if (candidate === undefined) return undefined
      if (profileName !== undefined && profileName !== candidate) return undefined
      profileName = candidate
      index += 1
      continue
    }

    // An unknown option or positional argument starts the pass-through app argv.
    return profileName
  }
  return profileName
}

/** Construct the same profile package anchor used by the GUI resolver. */
export function desktopCliProfilePackageUrl(
  profileName: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  assertDesktopProfileName(profileName)
  const home = resolveDshHome(undefined, environment)
  return pathToFileURL(join(resolveProfileDir(profileName, home), 'package.json')).href
}

/** Install the narrow Profile overlay resolver only for a real profile boot. */
export async function installCliProfileResolver(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
  installResolver: ProfilePackageResolverInstaller = defaultProfilePackageResolverInstaller,
): Promise<(() => void) | undefined> {
  const profileName = profileBootNameFromArgv(argv)
  if (profileName === undefined) return undefined
  return await installResolver(desktopCliProfilePackageUrl(profileName, environment))
}

function takeDefaultProfile(environment: NodeJS.ProcessEnv): string | undefined {
  let profileName: string | undefined
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() !== DEFAULT_PROFILE) continue
    const value = environment[key]
    if (value !== undefined && profileName !== undefined && value !== profileName) {
      throw new Error('dsh-desktop: conflicting default profile environment values')
    }
    profileName ??= value
    delete environment[key]
  }
  return profileName
}

/**
 * Enter the packaged DSH CLI without any plugin-install transaction wrapper.
 * Manual plugin commands and Market operations rely on unified checkpoints.
 */
export async function runDesktopDshCli(
  environment: NodeJS.ProcessEnv = process.env,
  load: (url: string) => Promise<unknown> = url => import(url),
  argv: string[] = process.argv,
  installResolver: ProfilePackageResolverInstaller = defaultProfilePackageResolverInstaller,
): Promise<void> {
  const profileName = takeDefaultProfile(environment)
  clearElectronRunAsNode(environment)
  const selected = profileName === undefined
    ? argv.slice(2)
    : withDefaultDesktopProfile(argv.slice(2), profileName)
  const forwarded = withoutForwardedDesktopPnpmPolicy(selected)
  argv.splice(2, argv.length - 2, ...forwarded)
  const releaseResolver = await installCliProfileResolver(forwarded, environment, installResolver)
  try {
    await load(DSH_ENTRY_URL)
  } catch (cause) {
    releaseResolver?.()
    throw cause
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && fileURLToPath(import.meta.url) === entry
}

if (isDirectExecution()) {
  void runDesktopDshCli().catch((cause: unknown) => {
    process.stderr.write(`dsh-desktop: failed to start packaged dsh: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}
