/** Exercise the official bundles Desktop lists although their release hides them: LiveShare, Ralph, session search and the on-demand Computer Use. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

// 0.2.2 ships these bundles with `dsh.bundle.listedByDefault: false`, which keeps them off both plugin manager lists
// until a profile enables them. Desktop lists them like its other optional bundles.
const LISTED_BUNDLES = [
  '@deepseek-ai/dsh-experimental-liveshare',
  '@deepseek-ai/dsh-experimental-ralph-bundle',
  '@deepseek-ai/dsh-experimental-session-search',
]
const LIVESHARE = '@deepseek-ai/dsh-experimental-liveshare'
// 0.2.2-alpha.3 installs Computer Use on demand from its official catalog, whose entry hides it as well. Desktop lists
// that entry, so the plugin manager offers the bundle as not installed and installs it when switched on. It still hides
// the bundle on platforms the entry's `platforms` excludes.
const ON_DEMAND_LISTED = ['@deepseek-ai/dsh-cua-bundle']
const notInstalled = 'runtime dependencies are not installed; run corepack yarn install'

function installed(require, specifier) {
  try {
    return require.resolve(specifier)
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${specifier}'`)) return undefined
    throw error
  }
}

const typescript = installed(createRequire(resolve('dsh-plugin-desktop-beta/package.json')), 'typescript')
const ts = typescript === undefined ? undefined : createRequire(import.meta.url)(typescript)

/**
 * Read the installed `TunnelWorker.start()`, which launches LiveShare's owner gateway worker.
 * @param entry - the installed LiveShare host module.
 * @returns the method's source text.
 */
function gatewayStart(entry) {
  const file = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const methods = []
  const visit = node => {
    const worker = ts.isClassDeclaration(node) && node.name?.text === 'TunnelWorker' ? node
      : ts.isVariableDeclaration(node) && node.name.getText(file) === 'TunnelWorker' && node.initializer !== undefined
        && ts.isClassExpression(node.initializer) ? node.initializer : undefined
    if (worker !== undefined) methods.push(...worker.members.filter(member => ts.isMethodDeclaration(member) && member.name.getText(file) === 'start'))
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(methods.length, 1, 'Expected one official TunnelWorker.start()')
  return methods[0].getText(file)
}

/**
 * Run the installed `start()` against stand-ins for its process, file and spawn calls.
 * @param method - the method's source text.
 * @param electron - the Host's `process.versions.electron`, or undefined under plain Node.
 * @returns the environment the gateway worker is started with.
 */
function gatewayEnvironment(method, electron) {
  const launches = []
  const worker = runInNewContext(`({ ${method} })`, {
    process: { env: { NODE_ENV: 'production' }, versions: electron === undefined ? {} : { electron } },
    tmpdir: () => 'tmp',
    join: (...parts) => parts.join('/'),
    mkdtempSync: prefix => `${prefix}0`,
    createWriteStream: () => ({}),
    workerTransportEnv: () => ({}),
    clearTimeout: () => {},
    spawn: (_executable, _args, options) => {
      launches.push(options)
      return { stdout: { pipe() {} }, stderr: { pipe() {} }, on() {} }
    },
  })
  worker.options = { command: { executable: 'dsh-desktop', args: ['owner-gateway/cli.js'] } }
  worker.start()
  assert.equal(launches.length, 1)
  return launches[0].env
}

// Stable is frozen on 0.2.1-rc.3, which hides none of these bundles and has no LiveShare.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const manifest = JSON.parse(readFileSync(resolve(workspace, 'package.json'), 'utf8'))
  const require = createRequire(resolve(workspace, 'package.json'))
  const catalog = installed(require, '@deepseek-ai/dsh-official-bundles')
  // A release without the official on-demand catalog (0.2.1) offers nothing on demand.
  if (Object.hasOwn(manifest.dependencies, '@deepseek-ai/dsh-official-bundles')) test(`${workspace}: the plugin manager offers the on-demand bundles it would hide`, { skip: catalog === undefined && notInstalled }, async () => {
    const { OFFICIAL_ON_DEMAND_CATALOG: entries } = await import(pathToFileURL(catalog).href)
    for (const name of ON_DEMAND_LISTED) {
      // A catalog that does not offer the bundle has nothing to list.
      const entry = entries.find(item => item.packageName === name)
      if (entry === undefined) continue
      assert.equal(Object.hasOwn(manifest.dependencies, name), false, `${name} installs on demand; ${workspace} must not ship it`)
      assert.notEqual(entry.listedByDefault, false, name)
      assert.deepEqual(entry.platforms, ['darwin'])
    }
  })
  for (const name of LISTED_BUNDLES.filter(name => Object.hasOwn(manifest.dependencies, name))) {
    const bundleManifest = installed(require, `${name}/package.json`)
    test(`${workspace}: the plugin manager lists ${name}`, { skip: bundleManifest === undefined && notInstalled }, () => {
      const bundle = JSON.parse(readFileSync(bundleManifest, 'utf8'))
      assert.equal(bundle.version, manifest.dependencies[name])
      assert.notEqual(bundle.dsh?.bundle?.listedByDefault, false)
    })
    if (name !== LIVESHARE) continue
    test(`${workspace}: LiveShare starts its gateway worker in Electron's Node mode`, {
      skip: (bundleManifest === undefined && notInstalled) || (ts === undefined && 'typescript is not installed; run corepack yarn install'),
    }, () => {
      const method = gatewayStart(join(dirname(bundleManifest), 'lib', 'index.js'))
      const desktop = gatewayEnvironment(method, '44.7.0')
      assert.equal(desktop.ELECTRON_RUN_AS_NODE, '1')
      assert.equal(desktop.LIVESHARE_TUNNEL_MODE, 'gateway')
      assert.equal(Object.hasOwn(gatewayEnvironment(method, undefined), 'ELECTRON_RUN_AS_NODE'), false)
    })
  }
}
