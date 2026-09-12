import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(process.env.DSH_DEEPTHINK_ROOT || new URL('../deepthink', import.meta.url).pathname)
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(npm, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(`npm ${args.join(' ')} exited with code ${String(code)}`)))
  })
}

if (!existsSync(resolve(root, 'package.json'))) throw new Error(`DeepThink checkout not found: ${root}`)
await run(['install', '--no-audit', '--no-fund'])
await run(['run', 'build'])
await run(['run', 'build:web'], { VITE_BASE_PATH: '/deepthink/' })
