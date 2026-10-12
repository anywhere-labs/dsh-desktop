/** Back up configuration without importing user packages or touching conversations. */
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { atomicJson, atomicText, privateDirectory, readPrivateFile } from './private-files.ts'
import { NextProfiles, profileName, WEB_BUNDLES, NEXT_PACKAGE } from './profiles.ts'
import { DEFAULT_PROFILE } from './desktop-contract.ts'

const FILES = ['package.json', 'cordis.patch.yml', 'desktop-next.features.json'] as const
type ConfigFile = typeof FILES[number]
interface Snapshot {
  version: 1
  profile: string
  created: string
  reason: string
  healthy: boolean
  files: Record<ConfigFile, { sha256: string } | null>
}
const digest = (text: string): string => createHash('sha256').update(text).digest('hex')

export class NextRecovery {
  readonly directory: string
  constructor(readonly profiles: NextProfiles) { this.directory = join(profiles.home, 'recovery') }

  backup(name: string, reason: string, healthy = false): string {
    const dir = this.profiles.directory(name)
    const contents = Object.fromEntries(FILES.map(file => [file, readPrivateFile(join(dir, file))])) as Record<ConfigFile, string | undefined>
    privateDirectory(this.directory)
    const target = join(this.directory, `${Date.now()}-${randomUUID()}`)
    privateDirectory(target)
    const files = Object.fromEntries(FILES.map(file => {
      const text = contents[file]
      if (text !== undefined) atomicText(join(target, file), text)
      return [file, text === undefined ? null : { sha256: digest(text) }]
    })) as Snapshot['files']
    atomicJson(join(target, 'snapshot.json'), { version: 1, profile: name, created: new Date().toISOString(), reason, healthy, files } satisfies Snapshot)
    return target
  }

  latest(name: string): { directory: string; created: string } | null { return this.checkpoints(name)[0] ?? null }

  checkpoints(name: string): { directory: string; created: string; id: string; fileCount: number; totalBytes: number }[] {
    const result: { directory: string; created: string; id: string; fileCount: number; totalBytes: number }[] = []
    profileName(name)
    if (!lstatSync(this.directory, { throwIfNoEntry: false })) return result
    privateDirectory(this.directory)
    const entries = readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse()
    for (const entry of entries) {
      const directory = join(this.directory, entry)
      try {
        const snapshot = this.readSnapshot(directory, name)
        if (snapshot.healthy) {
          const contents = FILES.map(file => readPrivateFile(join(directory, file)))
          result.push({ directory, id: entry, created: snapshot.created, fileCount: contents.filter(text => text !== undefined).length, totalBytes: contents.reduce((sum, text) => sum + Buffer.byteLength(text ?? ''), 0) })
          if (result.length === 3) break
        }
      } catch { /* A partial or corrupt backup cannot become a restore target. */ }
    }
    return result
  }

  checkpoint(name: string): void {
    const latest = this.latest(name)
    if (latest) {
      const previous = this.readSnapshot(latest.directory, name)
      if (FILES.every(file => {
        const text = readPrivateFile(join(this.profiles.directory(name), file))
        return text === undefined ? previous.files[file] === null : previous.files[file]?.sha256 === digest(text)
      })) return
    }
    this.backup(name, 'successful-start', true)
  }

  async restore(name: string, id?: string): Promise<void> {
    const latest = id === undefined ? this.latest(name) : this.checkpoints(name).find(item => item.id === id)
    if (!latest) throw new Error('No successful-start configuration is available')
    const dir = this.profiles.directory(name)
    await withFileLock(join(dir, 'lock'), async () => {
      const snapshot = this.readSnapshot(latest.directory, name)
      // Verify the complete snapshot before making any change.
      const contents = FILES.map(file => {
        const text = readPrivateFile(join(latest.directory, file))
        const saved = snapshot.files[file]
        if (saved === null ? text !== undefined : text === undefined || digest(text) !== saved.sha256) throw new Error('Recovery backup checksum mismatch')
        return [file, text] as const
      })
      this.backup(name, 'before-rollback')
      for (const [file, text] of contents) {
        const path = join(dir, file)
        if (text !== undefined) atomicText(path, text)
        else if (readPrivateFile(path) !== undefined) unlinkSync(path)
      }
    })
  }

  bundles(name: string) {
    const manifest = JSON.parse(readPrivateFile(join(this.profiles.directory(name), 'package.json')) ?? '{}')
    const bundles: unknown = manifest.dsh?.profile?.bundles
    const ledger: unknown = manifest.dsh?.desktopNextDeselectedBundles ?? []
    if (!Array.isArray(bundles) || bundles.some(item => typeof item !== 'string')
      || !Array.isArray(ledger) || ledger.some(item => typeof item !== 'string')) throw new Error('Invalid Next Profile manifest')
    // Default web layers are only part of the product: optional shipped bundles
    // and official extensions must never become recovery uninstall targets.
    const shipped = JSON.parse(readPrivateFile(NEXT_PACKAGE)!) as {
      name: string; dependencies?: Record<string, string>; dsh?: { optionalBundles?: string[] }
    }
    const protectedNames = new Set([shipped.name, ...WEB_BUNDLES,
      ...Object.keys(shipped.dependencies ?? {}), ...shipped.dsh?.optionalBundles ?? []])
    const eligible = (packageName: string): boolean =>
      !protectedNames.has(packageName) && !packageName.startsWith('@deepseek-ai/')
    const selected = [...new Set(bundles as string[])].filter(eligible)
    // A deselected name is only shown while it is still a declared dependency:
    // reselected or uninstalled elsewhere, the ledger entry is simply forgotten.
    const dependencies = new Set(Object.keys(manifest.dependencies ?? {}))
    const deselected = [...new Set(ledger as string[])].filter(packageName =>
      eligible(packageName) && dependencies.has(packageName) && !selected.includes(packageName))
    return [
      ...selected.map(packageName => ({ bundleId: packageName, packageName,
        status: 'active' as const, owner: 'profile' as const, action: 'uninstall' as const, toggle: 'disable' as const })),
      ...deselected.map(packageName => ({ bundleId: packageName, packageName,
        status: 'disabled' as const, owner: 'profile' as const, action: 'uninstall' as const, toggle: 'enable' as const })),
    ]
  }

  /**
   * Select or deselect one eligible bundle in `dsh.profile.bundles`. Nothing is
   * deleted: the dependency entry and the installed package both stay, so the
   * change is reversible and needs no package manager run.
   */
  async setBundleSelected(name: string, packageName: string, selected: boolean): Promise<void> {
    const target = this.bundles(name).find(item => item.packageName === packageName)
    if (!target || target.toggle !== (selected ? 'enable' : 'disable')) throw new Error('This plugin cannot be changed')
    const dir = this.profiles.directory(name)
    await withFileLock(join(dir, 'lock'), async () => {
      this.backup(name, selected ? 'before-plugin-enable' : 'before-plugin-disable')
      const manifest = JSON.parse(readPrivateFile(join(dir, 'package.json')) ?? '{}')
      const bundles: unknown = manifest.dsh?.profile?.bundles
      if (!Array.isArray(bundles) || bundles.some(item => typeof item !== 'string')) throw new Error('Invalid Next Profile manifest')
      manifest.dsh.profile.bundles = selected
        ? [...(bundles as string[]).filter(item => item !== packageName), packageName]
        : (bundles as string[]).filter(item => item !== packageName)
      const previous: unknown = manifest.dsh.desktopNextDeselectedBundles ?? []
      const ledger = new Set(Array.isArray(previous) ? previous as string[] : [])
      if (selected) ledger.delete(packageName)
      else ledger.add(packageName)
      if (ledger.size === 0) delete manifest.dsh.desktopNextDeselectedBundles
      else manifest.dsh.desktopNextDeselectedBundles = [...ledger].sort()
      atomicJson(join(dir, 'package.json'), manifest)
    })
  }

  /** The original environment is stopped by the shell before resetting its data. */
  factoryReset(): string {
    privateDirectory(this.directory)
    const backup = join(this.directory, `factory-reset-${Date.now()}-${randomUUID()}`)
    privateDirectory(backup)
    for (const entry of readdirSync(this.profiles.home)) {
      if (['recovery', 'electron-user-data', 'desktop-next-location.json'].includes(entry)) continue
      renameSync(join(this.profiles.home, entry), join(backup, entry))
    }
    return backup
  }

  repairGlobalPatch(): void {
    const path = join(this.profiles.home, 'cordis.patch.yml')
    const text = readPrivateFile(path)
    if (text === undefined) return
    privateDirectory(this.directory)
    const backup = join(this.directory, `global-patch-${Date.now()}-${randomUUID()}.yml`)
    atomicText(backup, text)
    atomicText(path, '[]\n')
  }

  removeProfile(name: string, active: string): void {
    if (name === active || name === DEFAULT_PROFILE) throw new Error('The active and default Profiles cannot be removed')
    const source = this.profiles.directory(name)
    if (!this.profiles.list().includes(name)) throw new Error('Profile does not exist')
    privateDirectory(this.directory)
    const removed = join(this.directory, 'removed-profiles')
    privateDirectory(removed)
    renameSync(source, join(removed, `${name}-${Date.now()}-${randomUUID()}`))
  }

  private readSnapshot(directory: string, name: string): Snapshot {
    const value = JSON.parse(readPrivateFile(join(directory, 'snapshot.json'), 16_384) ?? 'null') as Snapshot | null
    if (!value || value.version !== 1 || value.profile !== name || typeof value.healthy !== 'boolean'
      || typeof value.created !== 'string' || !Number.isFinite(Date.parse(value.created)) || !value.files
      || Object.keys(value.files).length !== FILES.length || FILES.some(file => value.files[file] !== null
        && (typeof value.files[file]?.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.files[file]!.sha256)))) {
      throw new Error('Invalid recovery backup')
    }
    return value
  }
}
