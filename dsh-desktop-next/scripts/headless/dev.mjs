/** Explicit Linux development entry; reject unsupported hosts before preparing dependencies. */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHeadlessOptions } from '../../src/headless/options.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const desktop = join(root, 'dsh-desktop-next')
const supplied = process.argv.slice(2)
if (supplied.includes('--help')) {
  console.log(`Usage: corepack yarn dev:linux:headless [--data-dir PATH] [--profile NAME] [--port PORT]

Build and start DSH NEXT without a display on Linux.
Defaults: ~/.dsh-next-headless-dev, profile desktop, loopback port 18080.
The first run prepares the bundled Market, AA, application and runtime.
Use corepack yarn test:linux:headless to run entry unit tests on any supported development host.`)
} else {
  if (process.platform !== 'linux') {
    console.error('dev:linux:headless requires Linux. On macOS/Windows use a Linux container or server; run test:linux:headless for entry unit tests.')
    process.exitCode = 1
  } else {
    const args = ['--headless', ...supplied]
    if (!supplied.includes('--data-dir')) args.push('--data-dir', join(homedir(), '.dsh-next-headless-dev'))
    if (!supplied.includes('--port')) args.push('--port', '18080')
    // Invalid arguments fail before builds or persistent runtime preparation.
    parseHeadlessOptions(args)
    const steps = [
      ['market:prepare'], ['aa:prepare-release'],
      ['workspace', 'dsh-community-market', 'build'],
      ['workspace', 'dsh-desktop-next', 'build'],
      ['workspace', 'dsh-desktop-next', 'prepare:runtime'],
    ]
    for (const step of steps) {
      const result = spawnSync('corepack', ['yarn', ...step], { cwd: root, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) process.exit(result.status ?? 1)
    }
    const electron = createRequire(join(desktop, 'package.json'))('electron')
    const child = spawn(electron, [join(desktop, 'lib/headless.js'), ...args], {
      cwd: desktop, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
    })
    const interrupt = () => { child.kill('SIGINT') }
    const terminate = () => { child.kill('SIGTERM') }
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
    child.once('error', error => { console.error(error); process.exitCode = 1 })
    child.once('close', code => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate)
      process.exitCode = code ?? 1
    })
  }
}
