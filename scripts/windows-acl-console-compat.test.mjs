/** Check that the installed Windows ACL runner in Beta and Next gives the restricted child a console. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'

const RUNNER = '@deepseek-ai/dsh-sandbox-windows-acl/runner'

function runnerPath(workspace) {
  try {
    return createRequire(resolve(workspace, 'package.json')).resolve(RUNNER)
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${RUNNER}'`)) return undefined
    throw error
  }
}

// Stable's desktop trampoline sets up the console before it imports the runner.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const entry = runnerPath(workspace)
  test(`${workspace}: the ACL runner has a console before it starts the restricted child`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, () => {
    const source = readFileSync(entry, 'utf8')
    const setup = source.indexOf('await ensureConsoleHost();')
    // Carry the runner.js hunk of patches/dsh-sandbox-windows-acl@<version>.patch to every new runtime (#1538).
    assert.notEqual(setup, -1, 'runner.js lacks the Desktop console setup')
    assert.ok(setup < source.indexOf('const api = await win32();'), 'the console must exist before the restricted token is created')
    assert.match(source, /"AllocConsoleWithOptions"/)
  })
}
