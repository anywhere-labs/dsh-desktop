/** Verify every final Electron executable after all artifact builds finish. */

import {
  FuseV1Options,
  getCurrentFuseWire,
  type FuseConfig,
} from '@electron/fuses'
import { FuseState } from '@electron/fuses/dist/constants.js'
import { Arch, archFromString, getArchSuffix } from 'builder-util'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolvePackagedExecutablePath,
  smokePackagedElectronRuntime,
  type PackagedElectronSmoke,
  type PackagedRuntimeContext,
} from './verify-packaged-runtime.ts'

/** Injectable official fuse reader used by focused tests. */
export type ElectronFuseReader = (executable: string) => Promise<FuseConfig<FuseState>>

/** Minimal BuildResult surface supplied to electron-builder's afterAllArtifactBuild hook. */
export interface ElectronArtifactBuildResult {
  readonly outDir: string
  readonly configuration: {
    readonly productName?: string | null
    readonly executableName?: string | null
    readonly linux?: ElectronPlatformOutputConfiguration | null
    readonly mac?: ElectronPlatformOutputConfiguration | null
    readonly win?: ElectronPlatformOutputConfiguration | null
  }
  readonly platformToTargets: ReadonlyMap<{
    readonly buildConfigurationKey: string
  }, unknown>
}

interface ElectronPlatformOutputConfiguration {
  readonly defaultArch?: string | null
  readonly executableName?: string | null
  readonly target?: ElectronTargetConfiguration | string
    | readonly (ElectronTargetConfiguration | string)[] | null
}

interface ElectronTargetConfiguration {
  readonly arch?: string | readonly string[] | null
  readonly target: string
}

type ElectronBuildConfigurationKey = 'linux' | 'mac' | 'win'
type ElectronPlatformName = 'darwin' | 'linux' | 'win32'

const DIR_TARGET = 'dir'

const DESKTOP_MANIFEST = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { readonly name: string; readonly productName?: string }

const REQUIRED_ELECTRON_FUSES = [
  { option: FuseV1Options.RunAsNode, name: 'RunAsNode' },
  {
    option: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
    name: 'EnableEmbeddedAsarIntegrityValidation',
  },
  { option: FuseV1Options.OnlyLoadAppFromAsar, name: 'OnlyLoadAppFromAsar' },
] as const

function fuseStateName(state: FuseState | undefined): string {
  return state === undefined ? 'MISSING' : (FuseState[state] ?? String(state))
}

/** Fail when one final platform executable does not carry every required fuse. */
export async function verifyElectronExecutableFuses(
  executable: string,
  read: ElectronFuseReader = getCurrentFuseWire,
): Promise<void> {
  let wire: FuseConfig<FuseState>
  try {
    wire = await read(executable)
  } catch (cause) {
    throw new Error(`dsh-plugin-desktop: failed to inspect Electron fuses at ${executable}`, {
      cause,
    })
  }
  const invalid = REQUIRED_ELECTRON_FUSES.flatMap(({ option, name }) => {
    const state = wire[option]
    return state === FuseState.ENABLE ? [] : [`${name}=${fuseStateName(state)}`]
  })
  if (invalid.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: final Electron executable at ${executable} has invalid required fuses: ${invalid.join(', ')}`,
    )
  }
}

function architectureNumber(name: string, description: string): Arch {
  try {
    return archFromString(name)
  } catch (cause) {
    throw new Error(
      `dsh-plugin-desktop: unsupported Electron ${description} architecture ${JSON.stringify(name)}`,
      { cause },
    )
  }
}

function architectureName(arch: number, description: string): string {
  const name = Arch[arch]
  if (name === undefined) {
    throw new Error(
      `dsh-plugin-desktop: unsupported Electron ${description} architecture ${String(arch)}`,
    )
  }
  return name
}

function architectureKeys(value: unknown, description: string): Arch[] {
  if (!(value instanceof Map)) return []
  const keys = [...value.keys()]
  const numericKeys = keys.filter((key): key is number => typeof key === 'number')
  if (numericKeys.length > 0) {
    return numericKeys.map((key) => {
      architectureName(key, description)
      return key as Arch
    })
  }

  if (keys.length > 0 && keys.every(key => (
    typeof key === 'string'
    && Object.hasOwn(Arch, key)
    && typeof Arch[key as keyof typeof Arch] === 'number'
  ))) {
    return keys.map(key => architectureNumber(String(key), description))
  }
  return []
}

function targetPackagerArchitectures(
  platform: { readonly buildConfigurationKey: string },
  targets: unknown,
  description: string,
): Arch[] {
  if (!(targets instanceof Map)) return []
  const result = new Set<Arch>()
  for (const target of targets.values()) {
    if (typeof target !== 'object' || target === null) continue
    const targetRecord = target as {
      readonly archs?: unknown
      readonly packager?: {
        readonly packagerOptions?: { readonly targets?: unknown } | null
      } | null
    }
    for (const arch of architectureKeys(targetRecord.archs, description)) result.add(arch)

    const requestedTargets = targetRecord.packager?.packagerOptions?.targets
    if (!(requestedTargets instanceof Map)) continue
    for (const [candidatePlatform, archToTargets] of requestedTargets) {
      const candidateKey = typeof candidatePlatform === 'object' && candidatePlatform !== null
        ? (candidatePlatform as { readonly buildConfigurationKey?: unknown }).buildConfigurationKey
        : undefined
      if (candidatePlatform !== platform && candidateKey !== platform.buildConfigurationKey) continue
      for (const arch of architectureKeys(archToTargets, description)) result.add(arch)
    }
  }
  return [...result]
}

function configuredTargetArchitectures(
  configuration: ElectronPlatformOutputConfiguration | null | undefined,
  targetNames: ReadonlySet<string>,
  description: string,
): Arch[] {
  const targets = configuration?.target === undefined || configuration.target === null
    ? []
    : Array.isArray(configuration.target) ? configuration.target : [configuration.target]
  const result = new Set<Arch>()
  for (const target of targets) {
    const rawName = typeof target === 'string' ? target : target.target
    const separator = rawName.lastIndexOf(':')
    const name = separator > 0 ? rawName.slice(0, separator) : rawName
    if (!targetNames.has(name)) continue
    const configuredArch = typeof target === 'string'
      ? (separator > 0 ? rawName.slice(separator + 1) : undefined)
      : target.arch
    if (configuredArch === undefined || configuredArch === null) continue
    const names = Array.isArray(configuredArch) ? configuredArch : [configuredArch]
    for (const arch of names) result.add(architectureNumber(arch, description))
  }
  return [...result]
}

function requestedArchitectures(
  result: ElectronArtifactBuildResult,
  platform: { readonly buildConfigurationKey: string },
  targets: unknown,
): Arch[] {
  const key = platform.buildConfigurationKey as ElectronBuildConfigurationKey
  const description = `${key} output`
  const direct = architectureKeys(targets, description)
  if (direct.length > 0) return direct

  const fromPackager = targetPackagerArchitectures(platform, targets, description)
  if (fromPackager.length > 0) return fromPackager

  if (!(targets instanceof Map)) {
    throw new Error(
      `dsh-plugin-desktop: cannot determine requested Electron architecture(s) for ${key}`,
    )
  }
  const targetNames = new Set(
    [...targets.keys()].filter((name): name is string => typeof name === 'string'),
  )
  const fromConfiguration = configuredTargetArchitectures(
    result.configuration[key],
    targetNames,
    description,
  )
  if (fromConfiguration.length > 0) return fromConfiguration

  // electron-builder's NoOpTarget (used by --dir) deliberately retains neither
  // the arch nor its packager. With no explicit target.arch, electron-builder
  // itself defaults that target to the Node process architecture.
  if (targetNames.has(DIR_TARGET)) return [architectureNumber(process.arch, description)]

  throw new Error(
    `dsh-plugin-desktop: cannot determine requested Electron architecture(s) for ${key}`,
  )
}

function platformName(key: ElectronBuildConfigurationKey): ElectronPlatformName {
  switch (key) {
    case 'mac': return 'darwin'
    case 'win': return 'win32'
    case 'linux': return 'linux'
  }
}

function outputDirectoryName(
  result: ElectronArtifactBuildResult,
  key: ElectronBuildConfigurationKey,
  arch: Arch,
): string {
  const defaultArchitecture = result.configuration[key]?.defaultArch ?? undefined
  if (defaultArchitecture !== undefined) {
    architectureNumber(defaultArchitecture, `${key} output default`)
  }
  const suffix = getArchSuffix(arch, defaultArchitecture)
  return `${key}${suffix}${key === 'mac' ? '' : '-unpacked'}`
}

function outputProductFilename(
  result: ElectronArtifactBuildResult,
  key: ElectronBuildConfigurationKey,
): string {
  return result.configuration[key]?.executableName
    ?? result.configuration.executableName
    ?? result.configuration.productName
    ?? DESKTOP_MANIFEST.productName
    ?? DESKTOP_MANIFEST.name
}

/** Resolve only the unpacked applications requested by this electron-builder invocation. */
export function resolveFinalPackagedRuntimeContexts(
  result: ElectronArtifactBuildResult,
  exists: (filename: string) => boolean = existsSync,
): PackagedRuntimeContext[] {
  const missing: string[] = []
  const contexts = [...result.platformToTargets.entries()].flatMap(([platform, targets]) => {
    const key = platform.buildConfigurationKey as ElectronBuildConfigurationKey
    if (key !== 'linux' && key !== 'mac' && key !== 'win') {
      throw new Error(
        `dsh-plugin-desktop: unsupported Electron build platform ${JSON.stringify(platform.buildConfigurationKey)}`,
      )
    }
    return requestedArchitectures(result, platform, targets).map((arch) => {
      const appOutDir = join(result.outDir, outputDirectoryName(result, key, arch))
      const productFilename = outputProductFilename(result, key)
      const context: PackagedRuntimeContext = {
        appOutDir,
        arch,
        electronPlatformName: platformName(key),
        packager: {
          ...(key === 'linux'
          ? {
              executableName: result.configuration.linux?.executableName
                ?? result.configuration.executableName
                ?? DESKTOP_MANIFEST.name,
            }
          : {}),
          appInfo: { productFilename },
        },
      }
      const executable = resolvePackagedExecutablePath(context)
      if (!exists(executable)) {
        missing.push(`${key}/${architectureName(arch, `${key} output`)} at ${executable}`)
      }
      return context
    })
  })
  if (missing.length > 0) {
    throw new Error(
      `dsh-plugin-desktop: cannot locate final Electron executable(s) for ${missing.sort().join(', ')}`,
    )
  }
  return contexts.sort((left, right) => left.appOutDir.localeCompare(right.appOutDir, 'en'))
}

/** Electron Builder afterAllArtifactBuild hook; fuses have been flipped even for unsigned dir builds. */
export async function afterAllArtifactBuild(
  result: ElectronArtifactBuildResult,
  read: ElectronFuseReader = getCurrentFuseWire,
  exists: (filename: string) => boolean = existsSync,
  smoke: PackagedElectronSmoke = smokePackagedElectronRuntime,
): Promise<string[]> {
  const contexts = resolveFinalPackagedRuntimeContexts(result, exists)
  for (const context of contexts) {
    await verifyElectronExecutableFuses(resolvePackagedExecutablePath(context), read)
    smoke(context)
  }
  return []
}

export default afterAllArtifactBuild
