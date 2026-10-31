import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DESKTOP_RUNTIME_FILE, inventoryPayload, inventoryPayloadAsync, physicalPayload, readDesktopRuntime, readInstalledPackageVersion, runtimePath, sealPayload, sealPayloadAsync, verifyPackagedRuntimeIdentity, verifyPayload, type PayloadEntry } from '../src/runtime-tree.ts'
import { FIXTURE_RELEASE, FIXTURE_SHARED, FIXTURE_TARGET, runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-runtime-'))
  roots.push(root)
  runtimeFixture(join(root, 'app'))
  return join(root, 'app')
}
const verify = (app: string, version = '2.0.0-beta.1', target = FIXTURE_TARGET, options = {}) =>
  verifyPayload(physicalPayload(app), join(app, DESKTOP_RUNTIME_FILE), version, target, options)
const unix = process.platform !== 'win32'
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('verifies a payload after relocation without depending on build paths', () => {
  const app = fixture()
  const before = verify(app)
  expect(before.files.map(file => file.path)).toContain('lib/main.js')
  expect(before.files.some(file => file.path === DESKTOP_RUNTIME_FILE)).toBe(false)
  expect(before.files.every(file => file.machO === false)).toBe(true)
  expect(Object.keys(before.files[0]!)).toEqual(['path', 'bytes', 'sha256', 'executable', 'machO'])
  cpSync(app, join(app, '..', 'moved'), { recursive: true })
  expect(verify(join(app, '..', 'moved'))).toEqual(before)
  // Build steps that already hold the parsed descriptor need not read it again.
  expect(verifyPayload(physicalPayload(app), readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE)), '2.0.0-beta.1', FIXTURE_TARGET)).toEqual(before)
})

it('writes byte-identical descriptors with streamed bounded hashing, including empty and large files', async () => {
  const app = fixture()
  writeFileSync(join(app, 'empty'), '')
  writeFileSync(join(app, 'short'), Buffer.from([0xFE, 0xED]))
  writeFileSync(join(app, 'macho'), Buffer.from([0xCF, 0xFA, 0xED, 0xFE]))
  writeFileSync(join(app, 'large'), Buffer.alloc(5 * 1024 * 1024, 42))
  const source = physicalPayload(app)
  const file = join(app, DESKTOP_RUNTIME_FILE)
  const before = sealPayload(source, file, FIXTURE_RELEASE, FIXTURE_SHARED, FIXTURE_TARGET)
  const bytes = readFileSync(file)
  expect(await sealPayloadAsync(source, file, FIXTURE_RELEASE, FIXTURE_SHARED, FIXTURE_TARGET)).toEqual(before)
  expect(readFileSync(file)).toEqual(bytes)
  expect(verify(app)).toEqual(before)
})

it('limits concurrent readers and preserves sorted output when readers finish out of order', async () => {
  let active = 0
  let maximum = 0
  const completed: string[] = []
  const entries: PayloadEntry[] = Array.from({ length: 7 }, (_, index) => {
    const body = Buffer.from([0xCF, 0xFA, 0xED, 0xFE, index])
    return { path: `${index}.node`, unpacked: false, executable: index % 2 === 0, read: () => body,
      readChunks: async function* () {
        maximum = Math.max(maximum, ++active)
        try {
          await new Promise(resolve => setTimeout(resolve, index === 0 ? 30 : 1))
          yield body.subarray(0, 2)
          yield body.subarray(2)
          completed.push(`${index}.node`)
        } finally { active-- }
      } }
  })
  const source = { list: () => entries, entry: (path: string) => entries.find(entry => entry.path === path) }
  expect(await inventoryPayloadAsync(source, 2)).toEqual(inventoryPayload(source))
  expect(maximum).toBe(2)
  expect(active).toBe(0)
  expect(completed[0]).toBe('1.node')
})

it('drains active readers after a failure, stops scheduling and leaves the descriptor unwritten', async () => {
  const app = fixture()
  const original = physicalPayload(app)
  let active = 0
  const started: string[] = []
  const entries: PayloadEntry[] = Array.from({ length: 8 }, (_, index) => ({
    path: `${index}.js`, unpacked: false, executable: false, read: () => Buffer.alloc(0),
    readChunks: async function* () {
      active++
      started.push(`${index}.js`)
      try {
        await new Promise(resolve => setTimeout(resolve, index === 0 ? 1 : 20))
        if (index === 0) throw new Error('fixture read failure')
        yield Buffer.from('content')
      } finally { active-- }
    },
  }))
  const file = join(app, '..', 'failed-descriptor.json')
  await expect(sealPayloadAsync({ ...original, list: () => entries }, file, FIXTURE_RELEASE, FIXTURE_SHARED, FIXTURE_TARGET, 2))
    .rejects.toThrow('fixture read failure')
  expect(started).toEqual(['0.js', '1.js'])
  expect(active).toBe(0)
  expect(existsSync(file)).toBe(false)
  // Real filesystem stream errors also propagate, retaining the previous sealed descriptor.
  const before = readFileSync(join(app, DESKTOP_RUNTIME_FILE))
  rmSync(join(app, 'lib', 'main.js'))
  await expect(sealPayloadAsync(original, join(app, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE, FIXTURE_SHARED, FIXTURE_TARGET)).rejects.toThrow(/ENOENT/u)
  expect(readFileSync(join(app, DESKTOP_RUNTIME_FILE))).toEqual(before)
})

it('validates reader limits and accepts an empty inventory', async () => {
  const empty = { list: () => [], entry: () => undefined }
  for (const concurrency of [0, -1, 1.5, 33, Infinity, NaN]) {
    await expect(inventoryPayloadAsync(empty, concurrency)).rejects.toThrow(/hash concurrency/u)
  }
  expect(await inventoryPayloadAsync(empty)).toEqual([])
})

it.each(['changed', 'same-size', 'extra', 'missing'])('checks %s payload bytes only during build verification', (operation) => {
  const app = fixture()
  const before = readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE))
  if (operation === 'changed') writeFileSync(join(app, 'lib', 'main.js'), 'export const changed = 1\n')
  if (operation === 'same-size') writeFileSync(join(app, 'lib', 'main.js'), 'export {}\r')
  if (operation === 'extra') writeFileSync(join(app, 'extra'), '')
  if (operation === 'missing') rmSync(join(app, 'lib', 'main.js'))
  expect(readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE))).toEqual(before)
  expect(() => verify(app)).toThrow(/integrity/u)
  // The failure names the first file that differs, so a build log says what moved.
  expect(() => verify(app)).toThrow({ changed: /changed lib\/main\.js/u, 'same-size': /changed lib\/main\.js/u, extra: /unexpected extra/u, missing: /missing lib\/main\.js/u }[operation]!)
})

it('rejects filesystem links and incompatible targets', () => {
  const app = fixture()
  expect(() => verify(app, '2.0.0-beta.1', { platform: process.platform, archs: ['wrong'] })).toThrow(/incompatible/u)
  expect(() => verify(app, '2.0.0-beta.1', { platform: 'aix', archs: [process.arch] })).toThrow(/incompatible/u)
  symlinkSync(join(app, 'node_modules'), join(app, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE)).release.version).toBe('2.0.0-beta.1')
  expect(() => verify(app)).toThrow(/unsupported filesystem/u)
})

it('reads file inventory records unchanged during startup', () => {
  const app = fixture()
  const path = join(app, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { files: unknown[] }
  descriptor.files.unshift({ path: '../outside', bytes: -1.5, sha256: 'unchecked', executable: 'unchecked', machO: 'unchecked' })
  writeFileSync(path, JSON.stringify(descriptor))
  expect(readDesktopRuntime(path).files).toEqual(descriptor.files)
})

it('checks the bundled version only during build verification', () => {
  const app = fixture()
  expect(readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE)).release.version).toBe('2.0.0-beta.1')
  expect(() => verify(app, '2.0.1-beta.1')).toThrow(/bundled 2\.0\.0-beta\.1 is not the expected 2\.0\.1-beta\.1/u)
})

it.each([
  { schemaVersion: 2 },
  { platform: '' },
  { archs: [] },
  { archs: [process.arch, process.arch] },
  { release: { schemaVersion: 2 } },
  { release: { version: 'latest' } },
  { release: { dshVersion: '' } },
  { release: { electronVersion: 'v44' } },
  { release: { pnpmVersion: 11 } },
  { sharedPackages: [] },
])('rejects an invalid descriptor at startup: %j', (patch) => {
  const app = fixture()
  const path = join(app, DESKTOP_RUNTIME_FILE)
  const original = JSON.parse(readFileSync(path, 'utf8')) as { release: Record<string, unknown> }
  writeFileSync(path, JSON.stringify({ ...original, ...patch, release: { ...original.release, ...patch.release } }))
  expect(() => readDesktopRuntime(path)).toThrow(/desktop runtime/u)
})

it.each(['missing', 'invalid-json', 'mismatched'])('checks %s shared manifests only during build verification', (operation) => {
  const app = fixture()
  const before = readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE))
  const path = join(app, 'node_modules', '@deepseek-ai', 'cordis', 'package.json')
  if (operation === 'missing') rmSync(path)
  else writeFileSync(path, operation === 'invalid-json' ? '{' : '{}')
  expect(readDesktopRuntime(join(app, DESKTOP_RUNTIME_FILE))).toEqual(before)
  expect(() => verify(app)).toThrow()
})

it('rejects a descriptor that maps a shared package outside node_modules or mislabels dsh', () => {
  const app = fixture()
  const path = join(app, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { sharedPackages: { name: string; path: string; version: string }[] }
  const original = JSON.stringify(descriptor)
  descriptor.sharedPackages[0]!.path = '../outside'
  writeFileSync(path, JSON.stringify(descriptor))
  expect(() => readDesktopRuntime(path)).toThrow(/shared package record/u)
  const relabeled = JSON.parse(original) as typeof descriptor
  relabeled.sharedPackages.find(entry => entry.name === '@deepseek-ai/dsh')!.version = '9.9.9'
  writeFileSync(path, JSON.stringify(relabeled))
  expect(() => readDesktopRuntime(path)).toThrow(/@deepseek-ai\/dsh/u)
})

it('verifies recorded executable permissions only on Unix', () => {
  const app = fixture()
  const path = join(app, DESKTOP_RUNTIME_FILE)
  const descriptor = JSON.parse(readFileSync(path, 'utf8')) as { files: { executable: boolean }[] }
  descriptor.files[0]!.executable = !descriptor.files[0]!.executable
  writeFileSync(path, JSON.stringify(descriptor))
  if (unix) expect(() => verify(app)).toThrow(/integrity/u)
  else expect(verify(app)).toMatchObject(descriptor)
})

it('tolerates code-signing rewrites of Mach-O files and signature directories, but nothing else', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-runtime-signed-'))
  roots.push(root)
  const app = join(root, 'app')
  mkdirSync(join(app, 'node_modules', 'native', 'Helper.app', 'Contents', '_CodeSignature'), { recursive: true })
  // Thin arm64 Mach-O magic, then a body the signer will rewrite.
  writeFileSync(join(app, 'node_modules', 'native', 'binary.node'), Buffer.concat([Buffer.from([0xCF, 0xFA, 0xED, 0xFE]), Buffer.from('unsigned')]))
  writeFileSync(join(app, 'node_modules', 'native', 'Helper.app', 'Contents', '_CodeSignature', 'CodeResources'), 'before')
  if (unix) chmodSync(join(app, 'node_modules', 'native', 'binary.node'), 0o755)
  const sealed = runtimeFixture(app)
  expect(sealed.files.find(file => file.path === 'node_modules/native/binary.node')?.machO).toBe(true)
  writeFileSync(join(app, 'node_modules', 'native', 'binary.node'), Buffer.concat([Buffer.from([0xCF, 0xFA, 0xED, 0xFE]), Buffer.from('signed with a longer body')]))
  writeFileSync(join(app, 'node_modules', 'native', 'Helper.app', 'Contents', '_CodeSignature', 'CodeResources'), 'after signing')
  writeFileSync(join(app, 'node_modules', 'native', 'Helper.app', 'Contents', 'CodeResources'), 'stapled')
  expect(() => verify(app)).toThrow(/integrity/u)
  expect(verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { afterCodeSigning: true })).toEqual(sealed)
  writeFileSync(join(app, 'lib', 'main.js'), 'export const tampered = 1\n')
  expect(() => verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { afterCodeSigning: true })).toThrow(/changed lib\/main\.js/u)
  writeFileSync(join(app, 'lib', 'main.js'), 'export {}\n')
  rmSync(join(app, 'node_modules', 'native', 'binary.node'))
  expect(() => verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { afterCodeSigning: true })).toThrow(/missing payload file/u)
})

it('lets a build step accept a rewrite it can prove equivalent, and nothing else', () => {
  const app = fixture()
  writeFileSync(join(app, 'lib', 'main.js'), 'export {}\r')
  const seen: string[] = []
  const accept = (file: { path: string }, shipped: Buffer): boolean => { seen.push(file.path); return shipped.toString('utf8') === 'export {}\r' }
  expect(verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { acceptRewrite: accept }).release).toEqual(FIXTURE_RELEASE)
  expect(seen).toEqual(['lib/main.js'])
  expect(() => verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { acceptRewrite: () => false })).toThrow(/changed lib\/main\.js/u)
  // Signed verification consults it for the files it still compares.
  expect(verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { afterCodeSigning: true, acceptRewrite: accept }).release).toEqual(FIXTURE_RELEASE)
  expect(() => verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { afterCodeSigning: true })).toThrow(/changed lib\/main\.js/u)
  // Missing and unexpected files are never rewrites.
  writeFileSync(join(app, 'extra'), '')
  expect(() => verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { acceptRewrite: () => true })).toThrow(/unexpected extra/u)
  rmSync(join(app, 'extra'))
  rmSync(join(app, 'lib', 'main.js'))
  expect(() => verify(app, '2.0.0-beta.1', FIXTURE_TARGET, { acceptRewrite: () => true })).toThrow(/missing lib\/main\.js/u)
})

it('checks the running application against the sealed identity at startup', () => {
  const app = fixture()
  const file = join(app, DESKTOP_RUNTIME_FILE)
  const identity = { version: '2.0.0-beta.1', dshVersion: readInstalledPackageVersion(app, '@deepseek-ai/dsh'), platform: process.platform, arch: process.arch }
  expect(verifyPackagedRuntimeIdentity(file, identity).release).toEqual(FIXTURE_RELEASE)
  expect(() => verifyPackagedRuntimeIdentity(file, { ...identity, version: '2.0.1-beta.1' })).toThrow(/does not belong to DSH Desktop Beta 2\.0\.1-beta\.1/u)
  expect(() => verifyPackagedRuntimeIdentity(file, { ...identity, dshVersion: '1.0.1' })).toThrow(/declares dsh 1\.0\.0 but 1\.0\.1 is installed/u)
  expect(() => verifyPackagedRuntimeIdentity(file, { ...identity, arch: 'mips' })).toThrow(/cannot run on/u)
  expect(() => verifyPackagedRuntimeIdentity(file, { ...identity, platform: 'aix' })).toThrow(/cannot run on/u)
  rmSync(file)
  expect(() => verifyPackagedRuntimeIdentity(file, identity)).toThrow(/ENOENT/u)
})

it.each(['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a//b', './a'])('rejects nonportable path %s', (path) => {
  expect(() => runtimePath('/runtime', path)).toThrow(/invalid relative path/u)
})
