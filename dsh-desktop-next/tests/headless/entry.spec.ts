import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseHeadlessOptions } from '../../src/headless/options.ts'
import { installLinuxLauncher, LINUX_BINARY, LINUX_EXECUTABLE, LINUX_LAUNCHER } from '../../scripts/headless/linux-launcher.ts'
// @ts-expect-error The repository variant checker is an untyped JavaScript build tool.
import { toBetaContent } from '../../../scripts/verify-desktop-variants.mjs'
const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
it('requires dedicated absolute data, validates all options and keeps help side-effect free', () => {
  expect(parseHeadlessOptions(['--headless', '--help'])).toBe('help')
  expect(parseHeadlessOptions(['--headless', '--data-dir', '/tmp/server data', '--profile', 'work', '--port', '12345']))
    .toEqual({ home: '/tmp/server data', profile: 'work', port: 12345 })
  for (const args of [[], ['--headless'], ['--headless', '--data-dir', 'relative'],
    ['--headless', '--data-dir', '/tmp/test', '--port', '-1'], ['--headless', '--data-dir', '/tmp/test', '--profile', '../x'],
    ['--headless', '--help', '--unknown'], ['--headless', '--headless', '--help'],
    ['--headless', '--data-dir', '/tmp/test', '--port', '65536']]) expect(() => parseHeadlessOptions(args)).toThrow()
})
it('Linux launcher preserves GUI and Node invocations and dispatches headless before Electron', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'headless space-'))); homes.push(home)
  const launcher = join(home, LINUX_EXECUTABLE)
  writeFileSync(launcher, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]), { mode: 0o755 })
  installLinuxLauncher(home); installLinuxLauncher(home)
  expect(readFileSync(launcher, 'utf8')).toBe(LINUX_LAUNCHER)
  // A process boundary fixture records argv and the env the real ELF would receive.
  writeFileSync(join(home, LINUX_BINARY), `#!/bin/sh\nprintf '%s\\n' "\${ELECTRON_RUN_AS_NODE:-gui}" "$@"\n`, { mode: 0o755 })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.DISPLAY; delete env.WAYLAND_DISPLAY
  const run = (args: string[], environment = env) => spawnSync(launcher, args, { env: environment, encoding: 'utf8' })
  expect(run(['--some-gui-flag', 'a b']).stdout.trim().split('\n')).toEqual(['gui', '--some-gui-flag', 'a b'])
  expect(run(['--headless', '--data-dir', '/tmp/a b']).stdout.trim().split('\n'))
    .toEqual(['1', join(home, 'resources/app.asar/lib/headless.js'), '--headless', '--data-dir', '/tmp/a b'])
  expect(run(['worker.js', '--headless'], { ...env, ELECTRON_RUN_AS_NODE: '1' }).stdout.trim().split('\n'))
    .toEqual(['1', 'worker.js', '--headless'])
  const link = join(home, 'symlink'); symlinkSync(launcher, link)
  expect(spawnSync(link, ['--headless', '--help'], { env, encoding: 'utf8' }).status).toBe(0)
})
it('product-specific headless blocks do not leak into Beta', () => {
  expect(toBetaContent('scripts/example.ts', '// next-server:start\nserver()\n// next-server:end\nshared()\n')).toBe('shared()\n')
})
