/** Exercise the installed dsh-http-proxy outbound-policy install in every Desktop runtime (#1626). */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'

const PROBE = resolve(import.meta.dirname, 'http-proxy-direct-dispatcher-probe.mjs')

/** Resolve the copy of the vendored proxy package the Desktop runtime actually installs. */
function proxyPackageDirectory(workspace) {
  let manifest
  try {
    manifest = createRequire(resolve(workspace, 'package.json')).resolve('@deepseek-ai/dsh-http-proxy/package.json')
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'@deepseek-ai/dsh-http-proxy/package.json'")) return undefined
    throw error
  }
  return dirname(manifest)
}

// Stable is frozen and ships no more releases; only Beta and Next carry the dispatcher patch.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const directory = proxyPackageDirectory(workspace)
  test(`${workspace}: a DIRECT outbound-proxy policy installs the bundled undici dispatcher`, {
    skip: directory === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, () => {
    // One child per workspace: dispatcher installation writes globals that cannot be reset.
    const result = spawnSync(process.execPath, [PROBE, directory], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr.trim() || result.stdout.trim())
  })
}
