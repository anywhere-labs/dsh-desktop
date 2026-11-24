/** Persistent application identities. The shared launcher is only a transport, never the selection. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { appBundle, desktopLaunch, type DesktopLaunch } from './autostart.js'
import { exists } from './cli-launch.js'
import type { LauncherTarget } from './launcher.js'
import type { EndpointRecord } from './endpoint.js'
import { readStartup, writePrivateJson, writeStartup } from './startup-settings.js'
import { withStartupLock } from './startup-lock.js'
const exec = promisify(execFile)
export interface Application {
  id: string
  kind: 'next' | 'beta' | 'official' | 'other'
  bundleId: string
  name: string
  version: string
  bridgeVersion: string
  dshHome: string
  profileDirectory: string
  profile: string
  background: boolean
  registeredAt: string
  launcher: LauncherTarget
}
/** Ignore malformed additive metadata rather than breaking older endpoint readers. */
export function parseApplication(value: unknown): Application | undefined {
  if (!value || typeof value !== 'object') return undefined
  const a = value as Application
  if (typeof a.id !== 'string' || !/^[a-f0-9]{24}$/u.test(a.id)
    || !['next', 'beta', 'official', 'other'].includes(a.kind) || typeof a.background !== 'boolean'
    || !['bundleId', 'name', 'version', 'bridgeVersion', 'dshHome', 'profileDirectory', 'profile', 'registeredAt']
      .every(key => typeof (value as Record<string, unknown>)[key] === 'string')
    || typeof a.launcher?.runtime !== 'string' || typeof a.launcher.script !== 'string'
    || typeof a.launcher.electron !== 'boolean') return undefined
  return a
}
export function applicationId(runtime: string, home: string, profile: string): string {
  return createHash('sha256').update(JSON.stringify([runtime, home, profile])).digest('hex').slice(0, 24)
}
export function applicationKind(identity: string): Application['kind'] {
  if (/next/iu.test(identity)) return 'next'
  if (/beta/iu.test(identity)) return 'beta'
  if (/deepseek|dsh/iu.test(identity)) return 'official'
  return 'other'
}
export async function identifyApplication(launcher: LauncherTarget, profileDirectory: string, bridgeVersion: string): Promise<Application | undefined> {
  if (!launcher.electron || !launcher.dshHome) return undefined
  const runtime = await realpath(launcher.runtime).catch(() => launcher.runtime)
  const dshHome = await realpath(launcher.dshHome).catch(() => launcher.dshHome!)
  profileDirectory = await realpath(profileDirectory).catch(() => profileDirectory)
  const bundle = appBundle(runtime)
  let bundleId = '', version = '', name = bundle ? basename(bundle, '.app') : basename(runtime)
  if (process.platform === 'darwin' && bundle) {
    const { stdout } = await exec('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(bundle, 'Contents', 'Info.plist')])
    const info = JSON.parse(stdout)
    bundleId = String(info.CFBundleIdentifier ?? '')
    version = String(info.CFBundleShortVersionString ?? '')
    name = String(info.CFBundleDisplayName ?? info.CFBundleName ?? name)
  } else {
    try {
      const pkg = JSON.parse(await readFile(join(dirname(runtime), 'resources', 'app.asar', 'package.json'), 'utf8'))
      bundleId = String(pkg.build?.appId ?? pkg.name ?? '')
      version = String(pkg.version ?? '')
      name = String(pkg.build?.productName ?? name)
    } catch { /* Older packages retain the executable identity. */ }
  }
  const kind = applicationKind(bundleId || name)
  return { id: applicationId(runtime, dshHome, profileDirectory), kind, bundleId, name, version, bridgeVersion,
    dshHome, profileDirectory, profile: basename(profileDirectory), background: kind === 'next' || kind === 'beta',
    registeredAt: new Date().toISOString(), launcher: { ...launcher, runtime, dshHome } }
}
export async function applications(home: string): Promise<Application[]> {
  const directory = join(home, 'apps')
  const result: Application[] = []
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    if (!/^[a-f0-9]{24}\.json$/u.test(name)) continue
    try {
      const a = parseApplication(JSON.parse(await readFile(join(directory, name), 'utf8')))
      if (!a || `${a.id}.json` !== name || !['next', 'beta', 'official', 'other'].includes(a.kind)
        || typeof a.registeredAt !== 'string' || typeof a.name !== 'string' || typeof a.profile !== 'string'
        || typeof a.background !== 'boolean' || typeof a.launcher?.runtime !== 'string' || typeof a.launcher.script !== 'string'
        || typeof a.dshHome !== 'string' || typeof a.profileDirectory !== 'string') continue
      if (await exists(a.launcher.runtime) && await exists(a.launcher.script)) result.push(a)
    } catch { /* Invalid or removed registrations cannot be startup targets. */ }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}
export function defaultApplication(apps: Application[], preferred?: string): Application | undefined {
  return apps.find(a => a.id === preferred) ?? [...apps].sort((a, b) =>
    Number(!a.background) - Number(!b.background) || a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id))[0]
}
export async function registerApplication(home: string, app: Application): Promise<void> {
  await withStartupLock(home, 10_000, async () => {
    const previous = (await applications(home)).find(a => a.id === app.id)
    await mkdir(join(home, 'apps'), { recursive: true, mode: 0o700 })
    await writePrivateJson(join(home, 'apps'), `${app.id}.json`, { ...app, registeredAt: previous?.registeredAt ?? app.registeredAt })
    // Only the first registration chooses the default. Later startup order never changes it.
    const settings = await readStartup(home).catch(() => undefined)
    if (settings && !settings.defaultApp) await writeStartup(home, { ...settings, defaultApp: app.id })
  }, 'applications.lock')
}
export async function unregisterApplication(home: string, id: string): Promise<void> {
  await rm(join(home, 'apps', `${id}.json`), { force: true })
}
export function selectApplication(apps: Application[], selector?: string, preferred?: string): Application | undefined {
  if (!selector) return defaultApplication(apps, preferred)
  const matches = apps.filter(a => a.id === selector || a.kind === selector)
  if (matches.length !== 1) throw new Error(`Application ${selector}: ${matches.length ? 'multiple installations; use the application ID shown in the panel' : 'not registered; open it and enable ACP first'}`)
  return matches[0]
}
export function orderedInstances(records: EndpointRecord[], preferred?: Application, strict = false): EndpointRecord[] {
  const matching = (r: EndpointRecord) => r.application?.id === preferred?.id
    || (preferred !== undefined && r.launcher?.runtime === preferred.launcher.runtime && r.profileDirectory === preferred.profileDirectory)
  return records.filter(r => !strict || matching(r)).sort((a, b) => {
    const rank = (r: EndpointRecord) => matching(r) ? 0 : preferred && r.profileDirectory === preferred.profileDirectory ? 1 : 2
    return rank(a) - rank(b) || (a.application?.id ?? a.instanceId).localeCompare(b.application?.id ?? b.instanceId)
  })
}
export function applicationLaunch(app: Application, platform = process.platform): DesktopLaunch | undefined {
  const launch = desktopLaunch(app.launcher.runtime, platform, app.launcher.electron)
  if (!launch) return undefined
  return { ...launch, name: app.name, environment: { DSH_HOME: app.dshHome },
    args: platform === 'darwin'
      ? [...(app.background ? ['-n'] : []), '-g', appBundle(app.launcher.runtime)!, '--env', `DSH_HOME=${app.dshHome}`, ...(app.background ? ['--args', '--next-background'] : [])]
      : app.background ? ['--next-background'] : [] }
}
/** Inspect main application processes before launching, including those whose plugin is not ready yet. */
export async function runningApplications(apps: Application[]): Promise<Application[]> {
  if (!apps.length) return []
  const { stdout } = process.platform === 'win32'
    ? await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'])
    : await exec('ps', ['-axo', 'pid=,args='])
  const rows: { pid: number; command: string }[] = process.platform === 'win32'
    ? [JSON.parse(stdout)].flat().map(p => ({ pid: p.ProcessId, command: p.CommandLine ?? '' }))
    : stdout.split('\n').map(line => { const m = /^\s*(\d+)\s+(.*)$/u.exec(line); return { pid: Number(m?.[1]), command: m?.[2] ?? '' } })
  return applicationsInProcesses(apps, rows)
}

export function applicationsInProcesses(apps: Application[], rows: { pid: number; command: string }[], ownPid = process.pid): Application[] {
  return apps.filter(app => rows.some(row => {
    if (row.pid === ownPid) return false
    const command = row.command.replace(/^"([^"\n]+)"/u, '$1')
    if (!command.startsWith(app.launcher.runtime)) return false
    const rest = command.slice(app.launcher.runtime.length)
    return (rest === '' || /^\s/u.test(rest)) && !/\.(?:[cm]?js|ts)(?:\s|$)|--type=|--expose-internals/u.test(rest)
  }))
}
