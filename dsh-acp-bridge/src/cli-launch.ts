/** Use the official Desktop's public CLI environment; never boot its reserved desktop Profile. */
import { access, readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { appBundle, type DesktopLaunch } from './autostart.js'
import type { ProfileCheck } from './management-contract.js'
export const BRIDGE_PACKAGE = '@agents-anywhere/dsh-acp-bridge'
export async function exists(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }
export function bundledCli(executable: string, platform: NodeJS.Platform): string | undefined {
  const bundle = platform === 'darwin' ? appBundle(executable) : undefined
  const resources = platform === 'darwin' ? (bundle ? join(bundle, 'Contents', 'Resources') : undefined) : join(dirname(executable), 'resources')
  return resources ? join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js') : undefined
}
export async function checkProfile(dshHome: string, name: string): Promise<ProfileCheck> {
  const invalid = (reason: string): ProfileCheck => ({ name, valid: false, reason })
  if (!/^[\w-]{1,80}$/u.test(name)) return invalid('Invalid Profile name')
  if (name.toLowerCase() === 'desktop') return invalid('Desktop owns this Profile; the CLI cannot start it')
  try {
    const root = await realpath(join(dshHome, 'profiles'))
    const directory = await realpath(join(root, name))
    if (relative(root, directory).startsWith('..')) return invalid('Profile resolves outside the profiles directory')
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: unknown } }; dependencies?: Record<string, string> }
    const bundles = pkg.dsh?.profile?.bundles
    if (!Array.isArray(bundles) || !bundles.includes('@deepseek-ai/dsh-web-app')) return invalid('This release supports existing Web Profiles with --no-open')
    if (!bundles.includes(BRIDGE_PACKAGE)) return invalid('Enable ACP Bridge in this Profile first')
    if (!pkg.dependencies?.[BRIDGE_PACKAGE]) return invalid('Install ACP Bridge in this Profile first')
    return { name, valid: true, reason: 'Web Profile and ACP bundle declared; startup will verify the live endpoint' }
  } catch { return invalid('Cannot read this existing Profile') }
}
export async function listProfiles(dshHome: string): Promise<ProfileCheck[]> {
  let names: string[]
  try { names = await readdir(join(dshHome, 'profiles')) } catch { return [] }
  return Promise.all(names.filter(name => /^[\w-]{1,80}$/u.test(name)).sort().map(name => checkProfile(dshHome, name)))
}
export async function cliLaunch(executable: string, platform: NodeJS.Platform, dshHome: string, profile: string): Promise<DesktopLaunch> {
  const entry = bundledCli(executable, platform)
  if (!entry || !await exists(entry)) throw new Error('This installation does not provide the official Desktop CLI')
  const check = await checkProfile(dshHome, profile)
  if (!check.valid) throw new Error(check.reason)
  return { name: `DSH (${profile})`, command: executable,
    args: ['--expose-internals', entry, '--profile', profile, '--no-open', '--port', '0'], waitForExit: false, windowsHide: true,
    environment: { ELECTRON_RUN_AS_NODE: '1', DSH_HOME: resolve(dshHome) }, cwd: join(dshHome, 'profiles', profile) }
}
