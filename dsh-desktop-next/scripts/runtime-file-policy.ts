/** Desktop-only omissions from the production dependency tree Electron Builder copies into the payload. */

/** Platform and every CPU architecture whose native dependencies one Next package carries. */
export interface NextPackagingTarget {
  readonly platform: NodeJS.Platform
  readonly archs: readonly string[]
}

/** Platform constraints published by an installed dependency. */
export interface RuntimePackageConstraints {
  readonly name?: string
  readonly os?: readonly string[]
  readonly cpu?: readonly string[]
}

function permits(values: readonly string[] | undefined, value: string): boolean {
  if (values === undefined || values.length === 0) return true
  if (values.includes(`!${value}`)) return false
  return values.includes(value) || values.includes('any') || values.every(item => item.startsWith('!'))
}

/**
 * Select sharp's platform package for the release. Linux runs the WebAssembly build: the native Linux
 * backends carry their own GLib, which collides with the one Electron links (src/host/sharp-wasm.ts).
 * @param name - Package name.
 * @param target - Release platform and CPUs.
 * @returns Omission reason for a sharp backend the release does not run.
 */
function sharpBackendExclusion(name: string, target: NextPackagingTarget): string | undefined {
  if (!name.startsWith('@img/sharp-')) return undefined
  const backends = target.platform === 'linux' ? ['wasm32'] : target.archs.map(arch => `${target.platform}-${arch}`)
  return backends.some(suffix => name === `@img/sharp-${suffix}` || name === `@img/sharp-libvips-${suffix}`) ? undefined : 'sharp other platform'
}

/**
 * Match published package constraints against the release, including every universal CPU.
 * Packages without constraints remain eligible regardless of their name, except sharp's platform
 * packages, which follow the backend the release runs.
 * @param manifest - Installed package metadata.
 * @param target - Release platform and CPUs, rather than the build host.
 * @returns Omission reason when no release architecture can use the package.
 */
export function nextRuntimePackageExclusion(manifest: RuntimePackageConstraints, target: NextPackagingTarget): string | undefined {
  const sharp = sharpBackendExclusion(manifest.name ?? '', target)
  if (sharp !== undefined) return sharp
  if (!permits(manifest.os, target.platform)) return 'package OS does not match target'
  if (!target.archs.some(arch => permits(manifest.cpu, arch))) return 'package CPU does not match target'
  return undefined
}

/**
 * Identify build and diagnostic files omitted from the packaged Next runtime.
 * Unrecognized assets and target runtime binaries are retained. Paths name the copied
 * node_modules tree, including nested package containers.
 * @param path - Path relative to the production node_modules directory.
 * @param target - Platform and CPU architectures of the packaged Electron Node runtime.
 * @returns Omission reason, or undefined when the entry must be kept.
 */
export function nextRuntimeFileExclusion(path: string, target: NextPackagingTarget): string | undefined {
  const parts = path.split(/[\\/]/u)
  if (parts.some(part => ['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json', '.yarn-state.yml'].includes(part))) {
    return 'package-manager metadata'
  }
  const file = parts.at(-1) ?? ''
  if (/\.(?:[cm]?[jt]s|css)\.map$/u.test(file)) return 'source map'
  if (/\.d\.[cm]?ts$/u.test(file)) return 'TypeScript declaration'
  if (/\.tsbuildinfo$/u.test(file)) return 'TypeScript build cache'
  const packageParts = parts.slice(parts.lastIndexOf('node_modules') + 1)
  const nameParts = packageParts[0]?.startsWith('@') ? 2 : 1
  const name = packageParts.slice(0, nameParts).join('/')
  const entry = packageParts.slice(nameParts).join('/')
  const targets = target.archs.map(arch => `${target.platform}-${arch}`)
  // pnpm vendors these optional prebuilds inside dist/node_modules, outside the manifest closure.
  const reflink = /^@reflink\/reflink-(darwin|linux|win32)-(x64|arm64|ia32)(?:-(?:gnu|musl|msvc))?$/u.exec(name)
  if (reflink !== null && !targets.includes(`${reflink[1]}-${reflink[2]}`)) return 'Reflink other platform or architecture'
  const officeEngines = target.platform === 'linux' ? ['wasm'] : targets
  if (name.startsWith('@deepseek-ai/libreoffice-kit-')) {
    if (!officeEngines.some(suffix => name === `@deepseek-ai/libreoffice-kit-${suffix}`)) return 'LibreOffice other platform'
  }
  const sharp = sharpBackendExclusion(name, target)
  if (sharp !== undefined) return sharp
  if (name === 'fs-ext' && /^build\/(?:Release|Debug)\/(?:obj(?:\/|$)|fs_ext\.(?:exp|lib|pdb|iobj|ipdb)$)/u.test(entry)) {
    return 'fs-ext compiler output'
  }
  if (name === 'fs-ext' && /^build\/(?:binding\.sln|config\.gypi|fs_ext\.vcxproj(?:\.filters)?)$/u.test(entry)) {
    return 'fs-ext build configuration'
  }
  if (name === '@mixmark-io/domino' && (entry === 'test' || entry.startsWith('test/'))) return 'Domino test fixtures'
  if (name === '@mixmark-io/domino' && (entry === '.yarn' || entry.startsWith('.yarn/'))) return 'Domino development tooling'
  if (name === 'node-pty' && target.platform !== 'win32' && /^third_party\/conpty(?:\/|$)/u.test(entry)) {
    return 'node-pty Windows ConPTY sources'
  }
  if (name === 'node-pty' && entry.startsWith('third_party/conpty/')) {
    const arch = entry.split('/').find(part => /^win10-(?:x64|arm64|ia32)$/u.test(part))?.slice('win10-'.length)
    if (arch !== undefined && !target.archs.includes(arch)) return 'node-pty ConPTY other architecture'
  }
  if (name === 'node-pty' && entry.startsWith('prebuilds/')) {
    const platform = packageParts[nameParts + 1]
    if (platform !== undefined && !targets.includes(platform)) return 'node-pty other platform'
    if (file.endsWith('.pdb')) return 'node-pty debug symbols'
  }
  if (name === '@koromix/koffi-win32-x64' && entry === 'win32_x64/koffi.lib') return 'Koffi import library'
  return undefined
}
