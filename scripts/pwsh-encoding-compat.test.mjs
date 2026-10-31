/** Exercise the installed pwsh tool executor's Python encoding in Beta and Next. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

function runtimePath(workspace) {
  try {
    return createRequire(resolve(workspace, 'package.json')).resolve('@deepseek-ai/dsh-pwsh-local')
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'@deepseek-ai/dsh-pwsh-local'")) return undefined
    throw error
  }
}

const config = { maxSpillBytes: { get: () => 1024 }, maxOutputBytes: { get: () => 1024 }, graceMs: { get: () => 0 } }

// Stable is frozen on the unpatched upstream executor.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const entry = runtimePath(workspace)
  test(`${workspace}: pwsh tool children write Python stdio as UTF-8`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async () => {
    const { ENCODING_PREAMBLE, PwshLocalExecutor } = await import(pathToFileURL(entry).href)
    // PowerShell decodes native output with [Console]::OutputEncoding, which every command pins to
    // UTF-8 first; the patch is only right while that holds.
    const argv = PwshLocalExecutor.prototype.argv.call({ pwshPath: 'pwsh.exe' }, { command: 'python report.py' })
    assert.equal(argv.at(-1), `${ENCODING_PREAMBLE}python report.py`)
    assert.match(ENCODING_PREAMBLE, /\[Console\]::OutputEncoding = \[System\.Text\.UTF8Encoding\]/)
    const spawn = env => PwshLocalExecutor.prototype.spawnSpec.call({ config },
      { workdir: 'C:\\工作区', env, dshEnv: {} }, 1024, undefined, argv)
    assert.equal(spawn(undefined).env.PYTHONIOENCODING, 'utf-8')
    // An explicit caller environment still wins over the executor's defaults.
    assert.equal(spawn({ PYTHONIOENCODING: 'gbk' }).env.PYTHONIOENCODING, 'gbk')
  })
}
