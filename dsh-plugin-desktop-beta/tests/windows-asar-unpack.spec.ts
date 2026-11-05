import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, type Stats } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { applyWindowsUnpack, readWindowsCodeFiles, verifyWindowsCodeUnpacked, windowsCodePayload, writeWindowsCodeFiles } from '../scripts/windows-asar-unpack.ts'
import { archivedPayload, verifyArchiveAgainstPrepared } from '../scripts/packaged-payload.ts'
import { DESKTOP_RUNTIME_FILE, inventoryPayloadAsync, physicalPayload, sealPayloadAsync, type PayloadEntry } from '../src/runtime-tree.ts'
import { FIXTURE_RELEASE, FIXTURE_SHARED, writeApplication } from './runtime-fixture.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const require = createRequire(import.meta.url)
require('app-builder-lib')
const { getFileMatchers } = require('app-builder-lib/out/fileMatcher.js') as typeof import('app-builder-lib/out/fileMatcher.js')
const { AsarPackager } = require('app-builder-lib/out/asar/asarUtil.js') as {
  AsarPackager: new (packager: object, config: object) => {
    pack(files: { src: string; destination: string; files: string[]; metadata: Map<string, Stats> }[]): Promise<void>
  }
}

function pe(offset = 64): Buffer {
  const body = Buffer.alloc(offset + 4)
  body.writeUInt16LE(0x5a4d, 0)
  body.writeUInt32LE(offset, 0x3c)
  body.writeUInt32LE(0x4550, offset)
  return body
}

function entry(path: string, body: Buffer, chunkSize?: number): PayloadEntry {
  return { path, unpacked: false, executable: false, read: () => body,
    ...(chunkSize === undefined ? {} : { readChunks: async function* () {
      for (let offset = 0; offset < body.length; offset += chunkSize) yield body.subarray(offset, offset + chunkSize)
    } }),
  }
}

function source(entries: PayloadEntry[]) {
  return { list: () => entries, entry: (path: string) => entries.find(entry => entry.path === path) }
}

it('loads the packaging helper directly in Node without a TypeScript transpiler', () => {
  const url = new URL('../scripts/windows-asar-unpack.ts', import.meta.url).href
  const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`], { encoding: 'utf8', windowsHide: true })
  expect(loaded.status, loaded.stderr).toBe(0)
})

it.each([1, 7, 63, 64, 65536, undefined])('recognizes PE signatures across chunks without changing hashed bytes (chunk=%s)', async chunkSize => {
  const entries = [entry('extensionless', pe(131074), chunkSize), entry('foreign.node', Buffer.from([0x7f, 0x45, 0x4c, 0x46]), chunkSize), entry('empty', Buffer.alloc(0), chunkSize)]
  const files = new Set<string>()
  const wrapped = windowsCodePayload(source(entries), files)
  expect(await inventoryPayloadAsync(wrapped)).toEqual(await inventoryPayloadAsync(source(entries)))
  expect([...files]).toEqual(['extensionless'])
})

it.each([
  ['bad.exe', Buffer.from('text')], ['bad.DLL', Buffer.alloc(0)], ['bad.pyd', Buffer.from('text')],
  ['bad.node', Buffer.from('MZ')], ['bad.binary', Buffer.from('MZinvalid')],
  ['bad-offset', (() => { const body = pe(); body.writeUInt32LE(2, 0x3c); return body })()],
  ['truncated', pe(100).subarray(0, 102)],
] as const)('rejects malformed Windows code while sealing (%s)', async (path, body) => {
  await expect(inventoryPayloadAsync(windowsCodePayload(source([entry(path, body, 3)]), new Set())))
    .rejects.toThrow('invalid PE file')
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'next-pe-unpack-'))
  roots.push(root)
  const appDir = join(root, 'app')
  const payload = join(appDir, '.desktop-build/payload')
  writeApplication(payload)
  const names = ['extensionless', 'custom.binary', 'native.node', 'module.pyd', 'a[0]{x,y}+(z)@!#.binary', '${arch}.binary']
  const directory = join(payload, 'node_modules/@fixture/native')
  mkdirSync(directory, { recursive: true })
  for (const name of names) writeFileSync(join(directory, name), pe())
  writeFileSync(join(directory, 'ordinary.json'), '{}')
  const physical = physicalPayload(payload)
  const files = new Set<string>()
  await sealPayloadAsync(windowsCodePayload(physical, files), join(payload, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE, FIXTURE_SHARED, { platform: 'win32', archs: ['x64'] })
  writeWindowsCodeFiles(payload, files)
  return { root, appDir, payload, files: [...files].sort() }
}

it('unpacks discovered PE files through the real builder with Next root and node_modules FileSets', async () => {
  const input = await fixture()
  const config = { asarUnpack: ['**/existing-rule'] }
  expect(applyWindowsUnpack(config, input.appDir, input.payload)).toEqual(input.files)
  const patterns = [...config.asarUnpack]
  applyWindowsUnpack(config, input.appDir, input.payload)
  expect(config.asarUnpack).toEqual(patterns)
  expect(config.asarUnpack).toContain('**/existing-rule')
  const resources = join(input.root, 'output/resources')
  mkdirSync(resources, { recursive: true })
  const destination = join(resources, 'app')
  const matcher = getFileMatchers(config, 'asarUnpack', destination, {
    defaultSrc: input.appDir, globalOutDir: dirname(resources), customBuildOptions: {},
    macroExpander: value => value.replaceAll('${arch}', 'x64'),
  })![0]!
  const paths = [...physicalPayload(input.payload, []).list()].map(entry => entry.path)
  const fileSet = (names: string[], src: string, to: string) => {
    const files = names.map(name => join(input.payload, ...name.split('/')))
    return { src, destination: to, files, metadata: new Map(files.map(file => [file, lstatSync(file)])) }
  }
  await new AsarPackager({ info: { getWorkspaceRoot: async () => input.root } }, {
    defaultDestination: destination, resourcePath: resources, options: {}, unpackPattern: matcher.createFilter(),
  }).pack([
    fileSet(paths.filter(path => !path.startsWith('node_modules/')), input.payload, destination),
    fileSet(paths.filter(path => path.startsWith('node_modules/')), join(input.payload, 'node_modules'), join(destination, 'node_modules')),
  ])
  const archive = archivedPayload(resources)
  try {
    verifyWindowsCodeUnpacked(archive, input.payload)
    expect(archive.entry('node_modules/@fixture/native/ordinary.json')?.unpacked).toBe(false)
    verifyArchiveAgainstPrepared(archive, join(input.payload, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE.version, { platform: 'win32', archs: ['x64'] })
    const path = input.files[0]!
    expect(() => verifyWindowsCodeUnpacked({ ...archive, entry: name => name === path ? { ...archive.entry(name)!, unpacked: false } : archive.entry(name) }, input.payload))
      .toThrow('PE must be unpacked')
    writeFileSync(join(resources, 'app.asar.unpacked', ...path.split('/')), 'tampered')
    expect(() => verifyArchiveAgainstPrepared(archive, join(input.payload, DESKTOP_RUNTIME_FILE), FIXTURE_RELEASE.version, { platform: 'win32', archs: ['x64'] }))
      .toThrow()
  } finally { archive.close() }
})

it('rejects stale discovery, traversal and unsealed paths', async () => {
  const { payload } = await fixture()
  const planFile = join(dirname(payload), 'windows-asar-unpack.json')
  const initial = readFileSync(planFile, 'utf8')
  for (const file of ['../escape', 'missing.exe']) {
    writeFileSync(planFile, JSON.stringify({ ...JSON.parse(initial), files: [file] }))
    expect(() => readWindowsCodeFiles(payload)).toThrow()
  }
  writeFileSync(planFile, initial)
  writeFileSync(join(payload, DESKTOP_RUNTIME_FILE), readFileSync(join(payload, DESKTOP_RUNTIME_FILE), 'utf8') + '\n')
  expect(() => readWindowsCodeFiles(payload)).toThrow('stale PE unpack plan')
})
