import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPTIONAL_BUNDLES } from '../src/upstream-family.ts'
import { expect, it } from 'vitest'
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
it('declares every official optional bundle as a discoverable, version-aligned installation dependency', () => {
  const next = read('../package.json')
  const require = createRequire(new URL('../package.json', import.meta.url))
  for (const name of OPTIONAL_BUNDLES) {
    expect(next.dependencies[name], name).toBe(next.dependencies['@deepseek-ai/dsh-app-boot'])
    const installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
    expect(installed.version, name).toBe(next.dependencies[name])
    expect(installed.dsh?.bundle?.patch, name).toBeTruthy()
  }
})

it('archives the application like upstream Desktop while keeping fuses and native inventory aligned with Stable', () => {
  const next = read('../package.json'); const stable = read('../../dsh-plugin-desktop/package.json')
  expect(next.version).toBe('2.0.21-beta.1')
  expect(next.desktopName).toBe(`${next.build.linux.executableName}.desktop`)
  expect(next.repository).toEqual({ type: 'git', url: stable.repository.url, directory: 'dsh-plugin-desktop-beta' })
  expect(next.build.appId).toBe('ai.deepseek.dsh.desktop.beta')
  expect(next.build.asar).toBe(true)
  for (const platform of ['mac', 'win', 'linux']) expect(next.build[platform].asar, platform).toBeUndefined()
  // Both CPU builds archive identical bytes, so the universal build keeps one archive. Merging would
  // rebuild it with one unpack glob per unpacked file and overflow minimatch, as 9ecf5ce32b found.
  expect(next.build.mac.mergeASARs).toBe(false)
  // Electron's own fs and dlopen read the archive; child processes, shells and nativeImage need these physically.
  expect(next.build.asarUnpack).toEqual(expect.arrayContaining(['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper',
    '**/@deepseek-ai/node-addon-system-*/bin/landlock-run', '**/@vscode/ripgrep-*/bin/rg', '**/@dataiku/uv-*/bin/uv', '**/meshcall-router-*/bin/*',
    '**/node_modules/@deepseek-ai/libreoffice-kit-*/**/*', '**/node_modules/pnpm/**/*',
    '**/node_modules/@agents-anywhere/dsh-bridge-next/lib/bundled-connector/**/*', '**/node_modules/@deepseek-ai/dsh-agent-preset/**/*',
    '**/node_modules/@deepseek-ai/dsh-skill-badge/**/*', '**/node_modules/@deepseek-ai/dsh-experimental-cua-macos/**/*']))
  // The prepared tree is archived verbatim, as upstream archives its prepared dsh tree: one file set for the
  // shell files and one for the dependency tree, because electron-builder leaves out a file set's root node_modules.
  expect(next.build.files).toEqual([{ from: '.desktop-build/payload', filter: ['**/*'] },
    { from: '.desktop-build/payload/node_modules', to: 'node_modules', filter: ['**/*'] }])
  for (const platform of ['mac', 'win', 'linux']) expect(next.build[platform].files, platform).toBeUndefined()
  // electron-builder collects node_modules itself unless beforeBuild declines, and npmRebuild: false would skip that hook.
  expect(next.build.beforeBuild).toBe('./scripts/before-build.ts')
  expect(next.build.npmRebuild).toBeUndefined()
  // beforePack only adds the Office closure of the prepared payload to the unpack patterns.
  expect(next.build.beforePack).toBe('./scripts/prepare-pack.ts')
  // Unpack patterns are matched below the application directory, so payload-root patterns name the prepared directory.
  expect(next.build.asarUnpack).toEqual(expect.arrayContaining(['.desktop-build/payload/scripts/node-bin/**/*', '.desktop-build/payload/assets/**/*', '.desktop-build/payload/build/**/*']))
  expect(next.build.asarUnpack.every((pattern: string) => pattern.startsWith('**/') || pattern.startsWith('.desktop-build/payload/'))).toBe(true)
  expect(next.build.afterPack).toBe('./scripts/verify-packaged.ts')
  expect(next.build.afterAllArtifactBuild).toBe('./scripts/verify-fuses.ts')
  expect(next.build.electronFuses).toEqual(stable.build.electronFuses)
  // Stable's rule already keeps the interpreter payloads and the wheels' .dylibs directories, identical across the two
  // CPU builds. Next adds its own per-CPU native packages, pnpm's reflink addons from its bundled dist/node_modules,
  // the official Computer Use helpers and the terminal helpers of `@earendil-works/pi-tui`, which Beta's OAR subagents
  // depend on; both CPU builds carry these for both CPUs.
  expect(next.build.mac.x64ArchFiles).toBe(stable.build.mac.x64ArchFiles
    .replace('sherpa-onnx-darwin-*/**}', 'sherpa-onnx-darwin-*/**,@trycua/cua-driver-darwin-*/**,@ubjs/node-darwin-*/**,@reflink/reflink-darwin-*/**,@deepseek-ai/dsh-experimental-cua-macos/native/bin/**,@earendil-works/pi-tui/native/darwin/prebuilds/**}'))
  // Both CPU payloads ride beside the archive as extra resources; electron-builder must not re-sign the pre-signed payloads.
  // macOS also carries the manifest copy the updaters shipped in 2.0.14-beta.1 through 2.0.17-beta.1 read beside the archive.
  expect(next.build.mac.extraResources).toEqual([{ from: '.desktop-build/runtime', to: 'runtime' }, { from: '.desktop-build/payload/package.json', to: 'app/package.json' }])
  expect(next.build.win.extraResources).toEqual([{ from: '.desktop-build/runtime', to: 'runtime' }])
  expect(next.build.linux.extraResources).toEqual([{ from: '.desktop-build/runtime', to: 'runtime' }])
  expect(next.build.extraResources).toBeUndefined()
  expect(next.build.mac.signIgnore).toContain('/Contents/Resources/runtime/(?:arm64|x64)/primary-runtime(?:/|$)')
  expect(next.scripts['prepare:runtime']).toBe('node scripts/prepare-runtime.ts')
  // Like upstream Desktop's dev launcher, every development launch prepares the payload before the shell starts.
  expect(next.scripts.dev).toBe('yarn build && yarn prepare:runtime && node scripts/start.mjs')
  expect(next.scripts.start).toBe('yarn prepare:runtime && node scripts/start.mjs')
  for (const name of ['@deepseek-ai/dsh-skill-office', '@deepseek-ai/dsh-tool-workspace-dependencies']) expect(next.dependencies[name], name).toBe(next.dependencies['@deepseek-ai/dsh'])
  expect(next.build.mac.icon).toBe('build/app-icon.icon')
  expect(existsSync(new URL('../build/app-icon.icon/icon.json', import.meta.url))).toBe(true)
  expect(next.build.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true })
  expect(next.build.mac.notarize).toBe(true)
})

it('gives the Linux packages a hicolor icon for every theme size up to 512 pixels', async () => {
  const next = read('../package.json')
  expect(next.build.linux.icon).toBe('build/icons')
  // Resolve the icon as electron-builder's Linux targets do; the Debian package and the AppImage install each result
  // under hicolor/<size>x<size>/apps. A single PNG resolves to its own 1024x1024, which the hicolor theme does not declare.
  const require = createRequire(new URL('../package.json', import.meta.url))
  const { convertIcon } = require('app-builder-lib/out/util/iconConverter.js')
  const project = fileURLToPath(new URL('..', import.meta.url))
  const outDir = mkdtempSync(join(tmpdir(), 'dsh-linux-icons-'))
  try {
    const { icons, isFallback } = await convertIcon({ sources: [next.build.linux.icon], fallbackSources: [], roots: [join(project, 'build'), project], format: 'set', outDir })
    expect(isFallback).toBe(false)
    expect(icons.map((icon: { size: number }) => icon.size)).toEqual([16, 22, 24, 32, 48, 64, 128, 256, 512])
    for (const { file, size } of icons) {
      const png = readFileSync(file)
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([size, size])
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
