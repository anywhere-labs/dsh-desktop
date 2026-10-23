import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { OPTIONAL_BUNDLES } from '@deepseek-ai/dsh-app-boot'
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
  expect(next.version).toBe('2.0.20-next')
  expect(next.desktopName).toBe(`${next.build.linux.executableName}.desktop`)
  expect(next.repository).toEqual({ type: 'git', url: stable.repository.url, directory: 'dsh-desktop-next' })
  expect(next.build.appId).toBe('ai.deepseek.dsh.desktop.next')
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
    '**/node_modules/@deepseek-ai/dsh-skill-badge/**/*']))
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
  // CPU builds. Next adds its own per-CPU native packages and pnpm's reflink addons from its bundled dist/node_modules.
  expect(next.build.mac.x64ArchFiles).toBe(stable.build.mac.x64ArchFiles
    .replace('sherpa-onnx-darwin-*/**}', 'sherpa-onnx-darwin-*/**,@trycua/cua-driver-darwin-*/**,@ubjs/node-darwin-*/**,@reflink/reflink-darwin-*/**}'))
  // Both CPU payloads ride beside the archive as extra resources; electron-builder must not re-sign the pre-signed payloads.
  // macOS also carries the manifest copy the updaters shipped in 2.0.14-next through 2.0.17-next read beside the archive.
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
