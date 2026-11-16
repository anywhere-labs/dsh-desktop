/**
 * Assert one installed `@deepseek-ai/dsh-http-proxy` installs its bundled undici 8 dispatcher even
 * when the resolved outbound policy is DIRECT (#1626).
 *
 * Run as a child process: installing a dispatcher writes `configurable: false` globals, so one
 * process cannot test more than one copy.
 *
 * Usage: node scripts/http-proxy-direct-dispatcher-probe.mjs <installed package directory>
 */
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = process.argv[2]
assert.ok(directory, 'the installed @deepseek-ai/dsh-http-proxy directory is required')

const { installProxyFromEnvironment } = await import(pathToFileURL(resolve(directory, 'lib/index.js')).href)
// Mirrors the install code under test: a runtime whose own undici already carries the upstream fix
// keeps the no-op path, while the pinned Node 24 runtime must install the bundled dispatcher.
const bundledUndiciMajor = Number.parseInt(process.versions.undici ?? '', 10)
const emptyEnvironment = { get: () => undefined }

const release = await installProxyFromEnvironment(emptyEnvironment, () => {})
try {
  const legacyDispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')]
  if (bundledUndiciMajor >= 8) {
    assert.equal(legacyDispatcher, undefined, 'a runtime with built-in undici 8 must keep the no-op path')
  } else {
    // Node's built-in undici 7 client asserts `!this.paused` when a peer closes a socket while a
    // response body is paused (nodejs/undici#5360); the assertion is thrown from a socket callback,
    // so DSH's fail-loud ends the Desktop Host with exit code 1. The bundled undici 8 dispatcher
    // carries upstream's fix, and only replacing the process dispatcher reaches Node's `fetch()`.
    assert.equal(typeof legacyDispatcher?.dispatch, 'function', 'a DIRECT policy left the built-in undici dispatcher in place')
  }
} finally {
  await release()
}
