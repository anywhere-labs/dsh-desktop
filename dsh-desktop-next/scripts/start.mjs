/** Explicit GUI entry; build/check never calls this script. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(join(root, 'package.json'))
for (const file of ['lib/main.js', 'lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs']) {
  if (!existsSync(join(root, file))) throw new Error('Run corepack yarn dev:next from the repository root to build Next first.')
}
const market = dirname(require.resolve('dsh-community-market/package.json'))
if (!existsSync(join(market, 'lib/client.js'))) throw new Error('Build the Community Market first: corepack yarn workspace dsh-community-market build')
const electron = require('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [root], { cwd: root, env, stdio: 'inherit' })
child.once('error', error => { console.error(error); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
