import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackageWithOptions } from '@electron/asar'
import { afterEach, expect, it } from 'vitest'
import { archivedPayload, auditNextPayload, nextPackagingTarget, nextPayloadRelease, universalMergeRewrite, UPDATER_MANIFEST_SHIM_MAX_BYTES, verifyArchiveAgainstPrepared, verifyNextPayload, verifyNextRuntime, verifyUpdaterManifestShim } from '../scripts/packaged-payload.ts'
import { DESKTOP_RUNTIME_FILE, physicalPayload, readDesktopRuntime, sealPayload } from '../src/runtime-tree.ts'
import { completeApplication, FIXTURE_RELEASE, FIXTURE_SHARED, writeApplication, writePackage } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const machO = (body: string): Buffer => Buffer.concat([Buffer.from([0xCF, 0xFA, 0xED, 0xFE]), Buffer.from(body)])
const unix = process.platform !== 'win32'
const target = nextPackagingTarget(process.platform, process.arch)
const HELPER_PLIST = 'node_modules/native-pkg/Helper.app/Contents/Info.plist'
/** A nested bundle's Info.plist as its package ships it. */
const PLIST = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n\t<key>CFBundleIdentifier</key>\n\t<string>org.example.helper</string>\n\t<key>CFBundleVersion</key>\n\t<string>1.0</string>\n</dict>\n</plist>\n"
/** The same plist after @electron/universal parsed it, injected the archive integrity and serialized it again. */
const MERGED_PLIST = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n  <dict>\n    <key>CFBundleIdentifier</key>\n    <string>org.example.helper</string>\n    <key>CFBundleVersion</key>\n    <string>1.0</string>\n    <key>ElectronAsarIntegrity</key>\n    <dict>\n      <key>Resources/app.asar</key>\n      <dict>\n        <key>algorithm</key>\n        <string>SHA256</string>\n        <key>hash</key>\n        <string>0000</string>\n      </dict>\n    </dict>\n  </dict>\n</plist>"

/**
 * A prepared Next payload with its sealed descriptor, then the archive Electron Builder assembles
 * from it: two copies of one installation, as the real build produces them.
 */
async function assembled(extra: (app: string) => void = () => {}, seal = true): Promise<{ resources: string; app: string }> {
  const root = mkdtempSync(join(tmpdir(), 'desktop-archived-'))
  roots.push(root)
  const app = join(root, 'payload')
  writeApplication(app)
  completeApplication(app)
  const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies['native-pkg'] = '*'
  writeFileSync(join(app, 'package.json'), JSON.stringify(manifest) + '\n')
  const native = writePackage(join(app, 'node_modules'), 'native-pkg')
  mkdirSync(join(native, 'bin'))
  writeFileSync(join(native, 'bin', 'uv'), machO('uv'))
  writeFileSync(join(native, 'addon.node'), machO('addon'))
  mkdirSync(join(native, 'Helper.app', 'Contents'), { recursive: true })
  writeFileSync(join(app, ...HELPER_PLIST.split('/')), PLIST)
  if (unix) chmodSync(join(native, 'bin', 'uv'), 0o755)
  extra(app)
  if (seal) sealPayload(physicalPayload(app), join(app, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE, Object.keys(manifest.dependencies), target)
  const resources = join(root, 'Resources')
  mkdirSync(resources)
  await createPackageWithOptions(app, join(resources, 'app.asar'), {
    unpack: '{**/*.node,**/bin/uv}', unpackDir: '{scripts/node-bin,assets,build,node_modules/pnpm,**/Helper.app}',
  })
  return { resources, app }
}

it('describes the architectures each release target carries', () => {
  expect(nextPackagingTarget('darwin')).toEqual({ platform: 'darwin', archs: ['arm64', 'x64'] })
  expect(nextPackagingTarget('win32')).toEqual({ platform: 'win32', archs: ['x64'] })
  expect(nextPackagingTarget('linux', 'arm64')).toEqual({ platform: 'linux', archs: ['arm64'] })
})

it('reads archive entries from their offsets, unpacked entries from the physical sibling and the embedded descriptor', async () => {
  const { resources, app } = await assembled()
  const source = archivedPayload(resources)
  try {
    const paths = source.list().map(entry => entry.path)
    expect(paths).toEqual([...paths].sort())
    expect(paths).toContain('lib/main.js')
    expect(source.entry('lib/main.js')).toMatchObject({ unpacked: false, executable: false })
    expect(source.entry('lib/main.js')!.read().toString('utf8')).toBe('export {}\n')
    expect(source.entry('node_modules/native-pkg/addon.node')).toMatchObject({ unpacked: true })
    expect(source.entry('node_modules/native-pkg/bin/uv')).toMatchObject({ unpacked: true, executable: unix })
    expect(source.entry('scripts/node-bin/node')).toMatchObject({ unpacked: true, executable: unix })
    expect(source.entry('node_modules/pnpm/bin/pnpm.mjs')).toMatchObject({ unpacked: true })
    expect(source.entry('node_modules/@deepseek-ai/dsh/index.js')!.read().toString('utf8')).toBe('export const identity = {}\n')
    // The descriptor rides inside the archive but, as in the prepared tree, stays outside the inventory.
    expect(paths).not.toContain(DESKTOP_RUNTIME_FILE)
    expect(source.entry(DESKTOP_RUNTIME_FILE)).toMatchObject({ unpacked: false })
    expect(source.descriptor()).toEqual(readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE)))
    expect(existsSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'bin', 'uv'))).toBe(true)
    expect(existsSync(join(resources, 'app.asar.unpacked', 'lib', 'main.js'))).toBe(false)
    expect(() => verifyNextPayload(source)).not.toThrow()
    expect(auditNextPayload(source, target)).toEqual([])
    expect(nextPayloadRelease(source, '44.0.0')).toEqual(FIXTURE_RELEASE)
  } finally { source.close() }
  rmSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'addon.node'))
  expect(() => archivedPayload(resources)).toThrow(/no physical file/u)
})

it('reports stray root entries, policy leftovers, packed native code and packed shell-executed files', async () => {
  const { resources } = await assembled((app) => {
    mkdirSync(join(app, '.desktop-next', 'home'), { recursive: true })
    writeFileSync(join(app, '.desktop-next', 'home', 'desktop-next.json'), '{}')
    writeFileSync(join(app, 'README.md'), '# leak\n')
    writeFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh', 'index.js.map'), '{}')
    writeFileSync(join(app, 'node_modules', 'native-pkg', 'helper'), machO('helper'))
    mkdirSync(join(app, 'node_modules', '@agents-anywhere', 'dsh-bridge-next', 'lib', 'bundled-connector'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@agents-anywhere', 'dsh-bridge-next', 'lib', 'bundled-connector', 'main.py'), 'print()\n')
    mkdirSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills', 'agent-experience'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-preset', 'skills', 'agent-experience', 'SKILL.md'), '---\nname: agent-experience\n---\n')
    mkdirSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-skill-badge', 'assets'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@deepseek-ai', 'dsh-skill-badge', 'assets', 'dsh-badge.png'), 'png\n')
    mkdirSync(join(app, 'node_modules', '@trycua', 'cua-driver-darwin-arm64'), { recursive: true })
    writeFileSync(join(app, 'node_modules', '@trycua', 'cua-driver-darwin-arm64', 'package.json'), '{"name":"@trycua/cua-driver-darwin-arm64"}\n')
  })
  const source = archivedPayload(resources)
  try {
    expect(auditNextPayload(source, target)).toEqual([
      '.desktop-next: outside the declared application files',
      'README.md: outside the declared application files',
      'node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/main.py: must be unpacked beside app.asar',
      'node_modules/@deepseek-ai/dsh-agent-preset/skills/agent-experience/SKILL.md: must be unpacked beside app.asar',
      'node_modules/@deepseek-ai/dsh-skill-badge/assets/dsh-badge.png: must be unpacked beside app.asar',
      'node_modules/@deepseek-ai/dsh/index.js.map: source map must not be packaged',
      'node_modules/@trycua/cua-driver-darwin-arm64/package.json: must be unpacked beside app.asar',
      'node_modules/native-pkg/helper: native code is packed inside app.asar',
    ])
  } finally { source.close() }
})

it('requires every sharp of a Linux package to find the WebAssembly build of its own release', async () => {
  const audit = async (packageTarget: ReturnType<typeof nextPackagingTarget>, wasmVersion?: string): Promise<string[]> => {
    const { resources } = await assembled((app) => {
      writePackage(join(app, 'node_modules'), 'sharp', { version: '0.35.5' })
      if (wasmVersion !== undefined) writePackage(join(app, 'node_modules'), '@img/sharp-wasm32', { version: wasmVersion })
    })
    const source = archivedPayload(resources)
    try { return auditNextPayload(source, packageTarget) } finally { source.close() }
  }
  const linux = nextPackagingTarget('linux', 'x64')
  expect(await audit(linux, '0.35.5')).toEqual([])
  expect(await audit(linux)).toEqual(['node_modules/sharp/package.json: sharp 0.35.5 has no packaged @img/sharp-wasm32 to run on Linux'])
  expect(await audit(linux, '0.35.4')).toEqual(['node_modules/@img/sharp-wasm32/package.json: 0.35.4 does not match sharp 0.35.5 at node_modules/sharp/package.json'])
  // Elsewhere sharp runs its native backends, and the WebAssembly build is not packaged at all.
  expect(await audit(nextPackagingTarget('darwin'))).toEqual([])
})

it('rejects an archive missing a declared dependency or a shell-owned file', async () => {
  const { resources } = await assembled((app) => {
    rmSync(join(app, 'node_modules', '@deepseek-ai', 'cordis'), { recursive: true })
  }, false)
  const source = archivedPayload(resources)
  try { expect(() => verifyNextPayload(source)).toThrow(/Missing packaged dependency @deepseek-ai\/cordis/u) } finally { source.close() }
  const { resources: without } = await assembled((app) => { rmSync(join(app, 'host.cordis.patch.yml')) }, false)
  const missing = archivedPayload(without)
  try { expect(() => verifyNextPayload(missing)).toThrow(/Missing Next payload: host\.cordis\.patch\.yml/u) } finally { missing.close() }
})

it('rejects incompatible native package manifests even inside a nested archived dependency', async () => {
  const { resources } = await assembled((app) => {
    writePackage(join(app, 'node_modules'), '@fixture/wrong-cpu', { os: [target.platform], cpu: ['mips'] })
    writePackage(join(app, 'node_modules', 'native-pkg', 'node_modules'), '@fixture/wrong-os', { os: ['unsupported-platform'] })
    mkdirSync(join(app, 'node_modules', 'native-pkg', 'assets'))
    writeFileSync(join(app, 'node_modules', 'native-pkg', 'assets', 'package.json'), '{"cpu":["mips"]}')
  })
  const source = archivedPayload(resources)
  try {
    expect(auditNextPayload(source, target)).toEqual([
      'node_modules/@fixture/wrong-cpu/package.json: package CPU does not match target must not be packaged',
      'node_modules/native-pkg/node_modules/@fixture/wrong-os/package.json: package OS does not match target must not be packaged',
    ])
  } finally { source.close() }
})

it('cross-checks the archive against the prepared descriptor, then the final application against the embedded copy', async () => {
  const { resources, app } = await assembled()
  const prepared = join(app, DESKTOP_RUNTIME_FILE)
  const sealed = readDesktopRuntime(prepared)
  expect(sealed.sharedPackages.map(entry => entry.name)).toEqual([...FIXTURE_SHARED, '@deepseek-ai/dsh-web-frontend', 'native-pkg'].sort())
  expect(sealed.files.find(file => file.path === 'node_modules/native-pkg/addon.node')).toMatchObject({ machO: true })
  expect(sealed.files.find(file => file.path === 'lib/main.js')).toMatchObject({ machO: false, executable: false })
  const shim = join(resources, 'app.asar.unpacked', 'scripts', 'node-bin', 'node')
  const source = archivedPayload(resources)
  try {
    expect(verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toEqual({ descriptor: sealed, rewrittenPlists: [] })
    expect(() => verifyArchiveAgainstPrepared(source, prepared, '2.0.1-beta.1', target)).toThrow(/not the expected 2\.0\.1-beta\.1/u)
    // The archive must carry the prepared descriptor byte for byte, not merely an equivalent one.
    writeFileSync(prepared, JSON.stringify(sealed))
    expect(() => verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toThrow(/differs from the prepared one/u)
    writeFileSync(prepared, `${JSON.stringify(sealed, undefined, 2)}\n`)
    // Any file that differs between the two copies names itself.
    writeFileSync(shim, 'tampered')
    expect(() => verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toThrow(/integrity verification failed: changed scripts\/node-bin\/node/u)
    writeFileSync(shim, 'payload:scripts/node-bin/node\n')
    expect(verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target).descriptor).toEqual(sealed)
  } finally { source.close() }
  // After packaging only the archive remains, and signing has rewritten the unpacked Mach-O file.
  expect(verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toEqual(sealed)
  writeFileSync(join(resources, 'app.asar.unpacked', 'node_modules', 'native-pkg', 'addon.node'), machO('addon, now signed'))
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toThrow(/integrity/u)
  expect(verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true })).toEqual(sealed)
  expect(() => verifyNextRuntime(resources, '2.0.1-beta.1', target, { afterCodeSigning: true })).toThrow(/not the expected 2\.0\.1-beta\.1/u)
  // A changed shell shim is never acceptable.
  writeFileSync(shim, 'tampered')
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true })).toThrow(/changed scripts\/node-bin\/node/u)
})

it('tolerates the Info.plist rewrites of a universal merge, and nothing else', async () => {
  const { resources, app } = await assembled()
  const prepared = join(app, DESKTOP_RUNTIME_FILE)
  const sealed = readDesktopRuntime(prepared)
  const shipped = join(resources, 'app.asar.unpacked', ...HELPER_PLIST.split('/'))
  expect(existsSync(shipped)).toBe(true)
  writeFileSync(shipped, MERGED_PLIST)
  const source = archivedPayload(resources)
  try {
    expect(verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toEqual({ descriptor: sealed, rewrittenPlists: [HELPER_PLIST] })
    // Content that changed is a changed file, and so is a prepared copy that drifted from its record.
    writeFileSync(shipped, MERGED_PLIST.replace('<string>1.0</string>', '<string>2.0</string>'))
    expect(() => verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toThrow(/changed node_modules\/native-pkg\/Helper\.app\/Contents\/Info\.plist/u)
    writeFileSync(shipped, MERGED_PLIST)
    writeFileSync(join(app, ...HELPER_PLIST.split('/')), MERGED_PLIST)
    expect(() => verifyArchiveAgainstPrepared(source, prepared, FIXTURE_RELEASE.version, target)).toThrow(/changed node_modules\/native-pkg\/Helper\.app\/Contents\/Info\.plist/u)
    writeFileSync(join(app, ...HELPER_PLIST.split('/')), PLIST)
    // Only plists qualify: a re-serialized manifest is still a changed file.
    const packedManifest = source.entry('node_modules/native-pkg/package.json')!
    expect(universalMergeRewrite(app).accept(sealed.files.find(file => file.path === 'node_modules/native-pkg/package.json')!, Buffer.from(JSON.stringify(JSON.parse(packedManifest.read().toString('utf8')), undefined, 2)))).toBe(false)
  } finally { source.close() }
  // The final application carries the same rewrites; the check must be told about the prepared tree.
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true })).toThrow(/changed node_modules\/native-pkg\/Helper\.app\/Contents\/Info\.plist/u)
  const merge = universalMergeRewrite(app)
  expect(verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { afterCodeSigning: true, acceptRewrite: merge.accept })).toEqual(sealed)
  expect(merge.accepted).toEqual([HELPER_PLIST])
  // Without the prepared tree nothing can be proved equivalent.
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target, { acceptRewrite: universalMergeRewrite(join(app, '..', 'elsewhere')).accept })).toThrow(/changed .*Info\.plist/u)
})

it('rejects an archive that carries no descriptor', async () => {
  const { resources, app } = await assembled(() => {}, false)
  const source = archivedPayload(resources)
  try {
    expect(() => source.descriptor()).toThrow(/desktop-runtime\.json is missing from the archive/u)
    expect(() => verifyArchiveAgainstPrepared(source, join(app, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE.version, target)).toThrow(/ENOENT/u)
    writeFileSync(join(app, DESKTOP_RUNTIME_FILE), '{}')
    expect(() => verifyArchiveAgainstPrepared(source, join(app, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE.version, target)).toThrow(/missing from the archive/u)
  } finally { source.close() }
  expect(() => verifyNextRuntime(resources, FIXTURE_RELEASE.version, target)).toThrow(/missing from the archive/u)
})

it('refuses to describe a payload whose pnpm has no version', async () => {
  const { resources } = await assembled((app) => { writeFileSync(join(app, 'node_modules', 'pnpm', 'package.json'), '{"name":"pnpm"}') }, false)
  const source = archivedPayload(resources)
  try { expect(() => nextPayloadRelease(source, '44.0.0')).toThrow(/pnpm has no version/u) } finally { source.close() }
})

it('requires the manifest copy earlier updaters read beside the archive on macOS, and nothing else there', async () => {
  const { resources, app } = await assembled()
  const source = archivedPayload(resources)
  try {
    const shim = join(resources, 'app', 'package.json')
    const check = (platform: NodeJS.Platform = 'darwin', version = FIXTURE_RELEASE.version): void => verifyUpdaterManifestShim(resources, source, platform, version)
    // Windows ships no app directory; macOS must carry the copy.
    expect(() => check('win32')).not.toThrow()
    expect(() => check()).toThrow(/must ship app\/package\.json/u)
    mkdirSync(join(resources, 'app'))
    copyFileSync(join(app, 'package.json'), shim)
    expect(() => check()).not.toThrow()
    expect(() => check('win32')).toThrow(/must not ship an unpacked application directory/u)
    expect(() => check('darwin', '9.9.9-beta.1')).toThrow(/names dsh-plugin-desktop-beta 2\.0\.0-beta\.1, not dsh-plugin-desktop-beta 9\.9\.9-beta\.1/u)
    // Anything beside the copy would make the directory an unpacked application again.
    writeFileSync(join(resources, 'app', 'main.js'), 'export {}\n')
    expect(() => check()).toThrow(/may hold only package\.json/u)
    rmSync(join(resources, 'app', 'main.js'))
    // The copy is the archived manifest itself, not a hand-written one, and a regular file of bounded size.
    writeFileSync(shim, JSON.stringify({ name: 'dsh-plugin-desktop-beta', version: FIXTURE_RELEASE.version }))
    expect(() => check()).toThrow(/differs from the archived application manifest/u)
    rmSync(shim)
    if (unix) {
      symlinkSync(join(app, 'package.json'), shim)
      expect(() => check()).toThrow(/regular file/u)
      rmSync(shim)
    }
    writeFileSync(shim, Buffer.alloc(UPDATER_MANIFEST_SHIM_MAX_BYTES + 1, 0x20))
    expect(() => check()).toThrow(/exceeds/u)
  } finally { source.close() }
})
