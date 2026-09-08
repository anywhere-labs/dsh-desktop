/** Real Electron RunAsNode smoke for Profile CJS/ESM resolution and native binaries. */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rgPath } from '@vscode/ripgrep'
import AdmZip from 'adm-zip'
import { exportDiagnosticsZip } from './diagnostic-export.ts'
import { installProfilePackageResolver } from './module-resolution.ts'

const OK_MARKER = 'DSH_PACKAGED_RUNTIME_OK'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`dsh-plugin-desktop: packaged runtime smoke ${message}`)
}

const installAnchor = new URL('../package.json', import.meta.url)
assert(
  /([\\/])app\.asar\1/u.test(installAnchor.pathname),
  `did not start from app.asar: ${installAnchor.pathname}`,
)
assert(
  /([\\/])app\.asar\.unpacked\1/u.test(rgPath),
  `resolved ripgrep outside app.asar.unpacked: ${rgPath}`,
)
assert(existsSync(rgPath), `cannot find ripgrep at ${rgPath}`)
const rgVersion = execFileSync(rgPath, ['--version'], { encoding: 'utf8', windowsHide: true })
assert(/^ripgrep\s/u.test(rgVersion), `received an invalid ripgrep version: ${JSON.stringify(rgVersion.trim())}`)

/** Exercise the production Worker entry through Electron's logical ASAR path. */
async function smokeDiagnosticExportWorker(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packaged-diagnostics-'))
  const logsDir = join(root, 'logs')
  const userDataDir = join(root, 'user-data')
  const crashDumpsDir = join(root, 'Crashpad')
  mkdirSync(logsDir)
  mkdirSync(userDataDir)
  mkdirSync(join(crashDumpsDir, 'pending'), { recursive: true })
  writeFileSync(join(logsDir, 'dsh-2000-01-01.log'), 'packaged worker smoke\n')
  writeFileSync(join(crashDumpsDir, 'pending', 'packaged-smoke.dmp'), 'packaged crash dump smoke\n')
  try {
    const output = await exportDiagnosticsZip(logsDir, userDataDir, {
      appVersion: 'packaged-smoke',
      maxEvidenceBytes: 1024,
      crashDumpsDir,
    })
    assert(existsSync(output), `diagnostic Worker produced no archive at ${output}`)
    const crashEntry = 'crash-dumps/pending/packaged-smoke.dmp'
    assert(
      new AdmZip(output).getEntry(crashEntry) !== null,
      `diagnostic Worker omitted ${crashEntry}`,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const root = mkdtempSync(join(tmpdir(), 'dsh-packaged-profile-resolver-'))
try {
  const profileDir = join(root, 'profiles', 'smoke')
  const profileManifestPath = join(profileDir, 'package.json')
  const profileModulesDir = join(profileDir, 'node_modules')
  const commonJsDir = join(profileModulesDir, 'dsh-packaged-cjs-consumer')
  const esmDir = join(profileModulesDir, 'dsh-packaged-esm-consumer')
  const staleSchemasteryDir = join(root, 'profiles', 'node_modules', '@deepseek-ai', 'schemastery')
  mkdirSync(join(commonJsDir, 'features'), { recursive: true })
  mkdirSync(esmDir, { recursive: true })
  mkdirSync(staleSchemasteryDir, { recursive: true })
  writeFileSync(profileManifestPath, `${JSON.stringify({
    name: 'dsh-packaged-smoke-profile',
    private: true,
    type: 'module',
  })}\n`)

  // Simulate an ESM-only fallback proxy left by an older release. The Desktop
  // resolver must bypass it or CommonJS will receive the wrong export shape.
  writeFileSync(join(staleSchemasteryDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/schemastery',
    version: '999.0.0',
    type: 'commonjs',
    main: './index.cjs',
  })}\n`)
  writeFileSync(join(staleSchemasteryDir, 'index.cjs'), 'module.exports = { stale: true }\n')

  writeFileSync(join(commonJsDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-packaged-cjs-consumer',
    version: '1.0.0',
    type: 'commonjs',
    exports: {
      '.': { import: './wrong-import.mjs', require: './index.cjs' },
      './features/*': './features/*.cjs',
      './package.json': './package.json',
    },
  })}\n`)
  writeFileSync(join(commonJsDir, 'wrong-import.mjs'), 'throw new Error("require selected the import condition")\n')
  writeFileSync(join(commonJsDir, 'features', 'shape.cjs'), 'module.exports = "wildcard-cjs"\n')
  writeFileSync(join(commonJsDir, 'index.cjs'), [
    "const Schema = require('@deepseek-ai/schemastery')",
    "const manifest = require('@deepseek-ai/schemastery/package.json')",
    "const yamlUtil = require('yaml/util')",
    "const frontend = require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')",
    'module.exports = {',
    '  Schema, manifest, yamlUtil, frontend,',
    "  loadEsm: () => import('dsh-packaged-esm-consumer'),",
    '}',
    '',
  ].join('\n'))

  writeFileSync(join(esmDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-packaged-esm-consumer',
    version: '1.0.0',
    type: 'module',
    exports: { '.': { import: './index.mjs', require: './wrong-require.cjs' } },
  })}\n`)
  writeFileSync(join(esmDir, 'wrong-require.cjs'), 'throw new Error("import selected the require condition")\n')
  writeFileSync(join(esmDir, 'index.mjs'), [
    "import Schema from '@deepseek-ai/schemastery'",
    "import { parse } from 'yaml'",
    'export { Schema }',
    "export const value = parse('value: 7').value",
    '',
  ].join('\n'))

  const releaseResolver = installProfilePackageResolver(pathToFileURL(profileManifestPath).href)
  try {
    const profileRequire = createRequire(profileManifestPath)
    const installRequire = createRequire(installAnchor)
    const consumer = profileRequire('dsh-packaged-cjs-consumer') as {
      Schema?: unknown
      manifest?: { name?: unknown }
      yamlUtil?: { createNode?: unknown }
      frontend?: unknown
      loadEsm?: () => Promise<{ Schema?: unknown; value?: unknown }>
    }
    assert(typeof consumer.Schema === 'function', 'did not preserve callable CommonJS exports')
    assert(
      consumer.Schema === installRequire('@deepseek-ai/schemastery'),
      'did not preserve the installation CommonJS module identity',
    )
    assert(consumer.manifest?.name === '@deepseek-ai/schemastery', 'did not resolve package.json exports')
    assert(typeof consumer.yamlUtil?.createNode === 'function', 'did not resolve an exact conditional subpath')
    assert(
      typeof consumer.frontend === 'string'
        && /([\\/])app\.asar\1/u.test(consumer.frontend)
        && consumer.frontend.endsWith(join('dist', 'index.html')),
      `did not resolve a wildcard export inside app.asar: ${String(consumer.frontend)}`,
    )
    assert(
      profileRequire('dsh-packaged-cjs-consumer/features/shape') === 'wildcard-cjs',
      'did not preserve a Profile CommonJS wildcard export',
    )
    assert(
      (profileRequire('dsh-packaged-cjs-consumer/package.json') as { name?: unknown }).name
        === 'dsh-packaged-cjs-consumer',
      'did not preserve a Profile manifest export',
    )
    assert(typeof consumer.loadEsm === 'function', 'CommonJS fixture omitted its ESM branch')
    const esm = await consumer.loadEsm()
    const installationEsm = await import('@deepseek-ai/schemastery')
    assert(esm.Schema === installationEsm.default, 'did not preserve the installation ESM module identity')
    assert(esm.value === 7, 'did not select the ESM/import condition through the Profile graph')
  } finally {
    releaseResolver()
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

await smokeDiagnosticExportWorker()

process.stdout.write(OK_MARKER)
