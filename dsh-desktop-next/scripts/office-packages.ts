/** Locate the complete installed Office package closure used by standalone CLI processes; ported from upstream. */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, sep } from 'node:path'

interface PackageManifest {
  readonly name?: string
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
}

/** Distribution platform and CPU. */
export interface OfficeTarget {
  readonly platform: string
  readonly arch: string
}

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

/**
 * Require the declared native engine, or use WASM on other targets.
 * @param manifest - Installed kit manifest.
 * @param target - Distribution platform and CPU.
 * @returns Engine package suffix.
 */
export function selectOfficeEngine(manifest: PackageManifest, target: OfficeTarget): string {
  const native = `${target.platform}-${target.arch}`
  return Object.hasOwn(manifest.optionalDependencies ?? {}, `@deepseek-ai/libreoffice-kit-${native}`) ? native : 'wasm'
}

function supports(values: readonly string[] | undefined, value: string): boolean {
  return values === undefined || (!values.includes(`!${value}`)
    && (values.every(item => item.startsWith('!')) || values.includes(value) || values.includes('any')))
}

/**
 * Find every required package, retaining its installed dependency resolution and target engine.
 * @param root - Symlink-free installed Node project.
 * @param target - Distribution platform and CPU.
 * @returns Absolute package directories; rejects missing dependencies and paths outside the root.
 */
export function officePackageDirectories(root: string, target: OfficeTarget): string[] {
  const entry = join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit')
  const engineName = `@deepseek-ai/libreoffice-kit-${selectOfficeEngine(readManifest(join(entry, 'package.json')), target)}`
  const packages = new Set<string>()

  function visit(packageDirectory: string): void {
    if (packages.has(packageDirectory)) return
    const relativeDirectory = relative(root, packageDirectory)
    if (isAbsolute(relativeDirectory) || relativeDirectory === '..' || relativeDirectory.startsWith(`..${sep}`)) {
      throw new Error(`Office dependency is outside the deployed closure: ${packageDirectory}`)
    }
    const manifestPath = join(packageDirectory, 'package.json')
    const manifest = readManifest(manifestPath)
    packages.add(packageDirectory)
    const require = createRequire(manifestPath)
    const dependencies = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    for (const name of dependencies) {
      if (name.startsWith('@deepseek-ai/libreoffice-kit-')) continue
      const optional = manifest.optionalDependencies?.[name] !== undefined || manifest.peerDependenciesMeta?.[name]?.optional === true
      const dependencyDirectory = (require.resolve.paths(name) ?? [])
        .map(directory => join(directory, name))
        .find(directory => existsSync(directory))
      if (dependencyDirectory === undefined) {
        if (optional) continue
        throw new Error(`Office dependency ${name} required by ${manifest.name ?? manifestPath} is missing.`)
      }
      if (optional) {
        const dependency = readManifest(join(dependencyDirectory, 'package.json'))
        if (!supports(dependency.os, target.platform) || !supports(dependency.cpu, target.arch)) continue
      }
      visit(dependencyDirectory)
    }
  }

  visit(entry)
  const engineDirectory = join(root, 'node_modules', engineName)
  if (!existsSync(engineDirectory)) throw new Error(`Office engine ${engineName} required for ${target.platform}/${target.arch} is missing.`)
  visit(engineDirectory)
  return [...packages].sort()
}

/**
 * Archive unpack patterns for the Office closure of every CPU one package carries. The CLI and its
 * engine run under the bundled standalone Node, which reads no archive.
 * @param root - Installed application directory.
 * @param platform - Electron platform being packaged.
 * @param archs - CPUs whose engines the package carries.
 * @returns Sorted `asarUnpack` globs relative to the application directory.
 */
export function officeUnpackPatterns(root: string, platform: string, archs: readonly string[]): string[] {
  const directories = new Set<string>()
  for (const arch of archs) for (const directory of officePackageDirectories(root, { platform, arch })) directories.add(directory)
  return [...directories].sort().map(directory => `**/${relative(root, directory).split(sep).join('/')}/**/*`)
}
