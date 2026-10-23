import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'
import { nextRuntimeFileExclusion, nextRuntimePackageExclusion } from '../scripts/runtime-file-policy.ts'
import { DESKTOP_RUNTIME_FILE, physicalPayload, verifyPayload } from '../src/runtime-tree.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const windows = { platform: 'win32' as const, archs: ['x64'] }
const universal = { platform: 'darwin' as const, archs: ['arm64', 'x64'] }
const linuxX64 = { platform: 'linux' as const, archs: ['x64'] }

it('omits development artifacts while preserving executable modules, assets and license files', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-file-policy-'))
  const source = join(root, 'source')
  const output = join(root, 'output')
  const removed = [
    'example/index.d.ts', 'example/index.d.mts', 'example/index.d.cts',
    'example/index.js.map', 'example/index.mjs.map', 'example/index.cjs.map',
    'example/style.css.map', 'example/index.d.ts.map', 'example/index.d.mts.map',
    'example/index.d.cts.map', 'example/tsconfig.tsbuildinfo',
    'fs-ext/build/Release/obj/fs_ext/native.obj', 'fs-ext/build/Release/fs_ext.pdb',
    'fs-ext/build/Release/fs_ext.lib', 'fs-ext/build/Release/fs_ext.exp',
    'fs-ext/build/Release/fs_ext.iobj', 'fs-ext/build/Release/fs_ext.ipdb',
    'fs-ext/build/binding.sln', 'fs-ext/build/config.gypi',
    'fs-ext/build/fs_ext.vcxproj', 'fs-ext/build/fs_ext.vcxproj.filters',
    'node-pty/prebuilds/win32-arm64/conpty.node',
    'node-pty/prebuilds/linux-x64/pty.node', 'node-pty/prebuilds/darwin-x64/pty.node',
    'node-pty/prebuilds/win32-x64/conpty.pdb',
    'node-pty/third_party/conpty/1.25.260303002/win10-arm64/OpenConsole.exe',
    'node-pty/third_party/conpty/1.25.260303002/win10-arm64/conpty.dll',
    'pnpm/dist/node_modules/@reflink/reflink-win32-arm64-msvc/reflink.win32-arm64-msvc.node',
    'pnpm/dist/node_modules/@reflink/reflink-darwin-arm64/reflink.darwin-arm64.node',
    'pnpm/dist/node_modules/@reflink/reflink-darwin-x64/reflink.darwin-x64.node',
    '@koromix/koffi-win32-x64/win32_x64/koffi.lib',
    '@mixmark-io/domino/test/entities.html',
    '@mixmark-io/domino/.yarn/plugins/@yarnpkg/plugin-version.cjs',
    '@mixmark-io/domino/.yarn/versions/release.yml',
    '@deepseek-ai/libreoffice-kit-wasm/assets/soffice.data',
    '@deepseek-ai/libreoffice-kit-darwin-arm64/bin/libreoffice-kit',
    '.modules.yaml', '.pnpm-workspace-state-v1.json', '.yarn-state.yml', '.bin/tool', '.pnpm/cache',
  ]
  const retained = [
    'example/index.js', 'example/index.cjs', 'example/index.mjs', 'example/worker.js',
    'example/source.ts', 'example/src/entry.ts', 'example/test/runtime-fixture.json',
    'example/locale.json', 'example/data.map', 'example/module.wasm',
    'example/package.json', 'example/LICENSE', 'example/NOTICE', 'example/README.md',
    'example/native.lib', 'example/native.obj', 'example/symbols.pdb',
    'fs-ext/build/Release/fs_ext.node', 'fs-ext/build/Release/runtime.dll',
    'node-pty/prebuilds/win32-x64/conpty.node',
    'node-pty/prebuilds/win32-x64/conpty_console_list.node',
    'node-pty/prebuilds/win32-x64/conpty/conpty.dll',
    'node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
    'node-pty/third_party/conpty/win10-x64/OpenConsole.exe',
    'node-pty/third_party/conpty/1.25.260303002/win10-x64/conpty.dll',
    'example/assets/win10-arm64/help.json',
    '@koromix/koffi-win32-x64/win32_x64/koffi.node',
    '@mixmark-io/domino/lib/HTMLParser.js', '@mixmark-io/domino/lib/EntityParser.js',
    '@mixmark-io/domino/LICENSE', '@mixmark-io/domino/package.json',
    'example/.yarn/runtime.cjs', '@mixmark-io/domino/.yarn-data.json',
    '@img/sharp-win32-x64/lib/libvips-42.dll',
    'pnpm/dist/node_modules/@reflink/reflink-win32-x64-msvc/reflink.win32-x64-msvc.node',
    'pnpm/dist/node_modules/@reflink/reflink/index.js',
    '@deepseek-ai/libreoffice-kit-win32-x64/bin/libreoffice-kit.exe',
    '@deepseek-ai/libreoffice-kit-win32-x64/sources/core-source.json',
    '@deepseek-ai/libreoffice-kit-win32-x64/licenses/MPL-2.0.txt',
  ]
  try {
    const sealedSource = runtimeFixture(source)
    const modules = join(source, 'node_modules')
    for (const path of [...removed, ...retained]) {
      mkdirSync(join(modules, path, '..'), { recursive: true })
      writeFileSync(join(modules, path), `payload:${path}`)
    }
    cpSync(source, output, {
      recursive: true, dereference: true,
      filter: path => !path.startsWith(modules) || nextRuntimeFileExclusion(relative(modules, path), windows) === undefined,
    })
    for (const path of removed) expect(existsSync(join(output, 'node_modules', path)), path).toBe(false)
    for (const path of retained) expect(readFileSync(join(output, 'node_modules', path), 'utf8'), path).toBe(`payload:${path}`)
    const sealed = runtimeFixture(output)
    expect(verifyPayload(physicalPayload(output), join(output, DESKTOP_RUNTIME_FILE), sealed.release.version, { platform: process.platform, archs: [process.arch] })).toEqual(sealed)
    expect(sealed.files.length).toBe(sealedSource.files.length + retained.length)
    expect(readFileSync(join(modules, removed[0]!), 'utf8')).toBe(`payload:${removed[0]}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('applies package-specific rules inside scoped and nested dependency containers', () => {
  expect(nextRuntimeFileExclusion('outer/node_modules/@mixmark-io/domino/test/data.html', windows)).toBeDefined()
  expect(nextRuntimeFileExclusion('outer/node_modules/@mixmark-io/domino/.yarn/plugin.cjs', windows)).toBeDefined()
  expect(nextRuntimeFileExclusion('@mixmark-io/domino/.yarn', windows)).toBeDefined()
  expect(nextRuntimeFileExclusion('outer\\node_modules\\node-pty\\prebuilds\\win32-arm64\\conpty.node', windows)).toBeDefined()
  expect(nextRuntimeFileExclusion('outer/node_modules/unrelated/test/data.html', windows)).toBeUndefined()
  expect(nextRuntimeFileExclusion('outer/fs-ext/build/Release/fs_ext.lib', windows)).toBeUndefined()
})

it('retains native prebuilds and Office engines for every architecture of a universal macOS package', () => {
  expect(nextRuntimeFileExclusion('node-pty/prebuilds/darwin-arm64/pty.node', universal)).toBeUndefined()
  expect(nextRuntimeFileExclusion('node-pty/prebuilds/darwin-x64/spawn-helper', universal)).toBeUndefined()
  expect(nextRuntimeFileExclusion('node-pty/prebuilds/linux-arm64/pty.node', universal)).toBe('node-pty other platform')
  expect(nextRuntimeFileExclusion('node-pty/prebuilds/win32-x64/conpty.node', universal)).toBe('node-pty other platform')
  expect(nextRuntimeFileExclusion('node-pty/third_party/conpty/1.25.260303002/win10-x64/OpenConsole.exe', universal)).toBe('node-pty Windows ConPTY sources')
  expect(nextRuntimeFileExclusion('node-pty/third_party/conpty/1.25.260303002/win10-x64/OpenConsole.exe', windows)).toBeUndefined()
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit-darwin-arm64/program/soffice', universal)).toBeUndefined()
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit-darwin-x64/program/soffice', universal)).toBeUndefined()
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit-win32-x64/bin/libreoffice-kit.exe', universal)).toBe('LibreOffice other platform')
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit-wasm/assets/soffice.data', universal)).toBe('LibreOffice other platform')
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit-wasm/assets/soffice.data', linuxX64)).toBeUndefined()
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit-darwin-arm64/program/soffice', linuxX64)).toBe('LibreOffice other platform')
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit-win32-x64/bin/libreoffice-kit.exe', linuxX64)).toBe('LibreOffice other platform')
  expect(nextRuntimeFileExclusion('node-pty/prebuilds/linux-x64/pty.node', linuxX64)).toBeUndefined()
  expect(nextRuntimeFileExclusion('node-pty/prebuilds/linux-arm64/pty.node', linuxX64)).toBe('node-pty other platform')
  expect(nextRuntimeFileExclusion('@deepseek-ai/libreoffice-kit/lib/cli.js', universal)).toBeUndefined()
  for (const arch of ['arm64', 'x64']) {
    expect(nextRuntimeFileExclusion(`pnpm/dist/node_modules/@reflink/reflink-darwin-${arch}/package.json`, universal)).toBeUndefined()
  }
  expect(nextRuntimeFileExclusion('pnpm/dist/node_modules/@reflink/reflink-linux-arm64-gnu/package.json', linuxX64)).toBeDefined()
  expect(nextRuntimeFileExclusion('pnpm/dist/node_modules/@reflink/reflink-linux-x64-musl/package.json', linuxX64)).toBeUndefined()
})

it('keeps every other platform file and unrecognized asset', () => {
  for (const path of ['@trycua/cua-driver-darwin-x64/cua_driver_node_runtime.node', '@dataiku/uv-darwin-arm64/bin/uv',
    'sherpa-onnx-darwin-x64/libonnxruntime.dylib', 'lucide-react/dist/esm/icons/a.js', 'openai/src/client.ts', 'dshmarket/package.json']) {
    expect(nextRuntimeFileExclusion(path, universal), path).toBeUndefined()
  }
})

it('selects native packages by published OS and CPU constraints, including universal and negative lists', () => {
  expect(nextRuntimePackageExclusion({ os: ['win32'], cpu: ['arm64'] }, windows)).toBe('package CPU does not match target')
  expect(nextRuntimePackageExclusion({ os: ['darwin'], cpu: ['x64'] }, windows)).toBe('package OS does not match target')
  expect(nextRuntimePackageExclusion({ os: ['win32'], cpu: ['x64'] }, windows)).toBeUndefined()
  for (const arch of ['arm64', 'x64']) {
    expect(nextRuntimePackageExclusion({ os: ['darwin'], cpu: [arch] }, universal)).toBeUndefined()
  }
  expect(nextRuntimePackageExclusion({ os: ['linux'], cpu: ['arm64'] }, linuxX64)).toBeDefined()
  expect(nextRuntimePackageExclusion({ os: ['linux'], cpu: ['arm64'] }, { platform: 'linux', archs: ['arm64'] })).toBeUndefined()
  expect(nextRuntimePackageExclusion({}, windows)).toBeUndefined()
  expect(nextRuntimePackageExclusion({ os: [], cpu: ['any'] }, windows)).toBeUndefined()
  expect(nextRuntimePackageExclusion({ os: ['!darwin'], cpu: ['!arm64'] }, windows)).toBeUndefined()
  expect(nextRuntimePackageExclusion({ cpu: ['!x64'] }, windows)).toBeDefined()
  expect(nextRuntimePackageExclusion({ os: ['any', '!win32'] }, windows)).toBeDefined()
})
