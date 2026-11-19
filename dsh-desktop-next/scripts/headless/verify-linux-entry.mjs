/** Run against a Linux installation directory; never starts a graphical Electron process. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

assert.equal(process.platform, 'linux')
const executable = join(resolve(process.argv[2]), 'dsh-desktop-next')
const home = mkdtempSync(join(tmpdir(), 'dsh-headless-entry-'))
const env = { ...process.env, HOME: home, DSH_TELEMETRY_DISABLED: '1' }
for (const name of ['DISPLAY', 'WAYLAND_DISPLAY', 'ELECTRON_RUN_AS_NODE', 'DSH_HOME', 'NODE_OPTIONS']) delete env[name]
let child
let exited
let output = ''
try {
  const help = spawnSync(executable, ['--headless', '--help'], { env, encoding: 'utf8', timeout: 30_000 })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Usage: dsh-desktop-next/)
  const invalid = spawnSync(executable, ['--headless', '--data-dir', home, '--port', '65536'], { env, encoding: 'utf8', timeout: 30_000 })
  assert.equal(invalid.status, 1)
  assert.equal(existsSync(join(home, 'profiles')), false)
  child = spawn(executable, ['--headless', '--data-dir', join(home, 'data')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  exited = once(child, 'exit')
  const collect = chunk => { output = (output + chunk).slice(-100_000) }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  let url
  for (const start = Date.now(); Date.now() - start < 60_000;) {
    url = /DSH NEXT headless ready: (http[^\s]+)/u.exec(output)?.[1]
    if (url) break
    assert.equal(child.exitCode, null, output)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(url, `Host never became ready: ${output}`)
  const origin = new URL(url).origin
  const anonymous = await fetch(origin, { signal: AbortSignal.timeout(5000) })
  assert.equal(anonymous.status, 401); await anonymous.body?.cancel()
  const login = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  assert.equal(login.status, 303)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie); await login.body?.cancel()
  const page = await fetch(origin, { headers: { cookie }, signal: AbortSignal.timeout(5000) })
  assert.equal(page.status, 200); assert.match(await page.text(), /<html/iu)
  const second = spawnSync(executable, ['--headless', '--data-dir', join(home, 'data')], { env, encoding: 'utf8', timeout: 15_000 })
  assert.equal(second.status, 1); assert.match(second.stderr, /already locked/)
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
  const [code, signal] = await exited.finally(() => clearTimeout(timer))
  assert.equal(code, 0, `Shutdown failed (${signal}): ${output}`)
  assert.equal(existsSync(join(home, 'data', '.headless-running')), false)
  console.log('Linux headless entry: help, invalid arguments, authenticated Web, duplicate start and SIGTERM passed (no display).')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
  rmSync(home, { recursive: true, force: true })
}
