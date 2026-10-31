/** Run the official Computer Use provider from its unpacked copy, so the helper path it derives is a physical file. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { OFFICIAL_CUA_PROVIDER_PACKAGE, installOfficialCuaResolution } from '../../src/upstream-family/official-cua.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const PACKAGE = `node_modules/${OFFICIAL_CUA_PROVIDER_PACKAGE}`
const HELPER = ['native', 'bin', 'darwin-arm64', 'dsh-cua-native']

/** The provider's layout: an ES module entry that locates its helper below its own package directory, and the helper. */
function writeProvider(directory: string): void {
  mkdirSync(join(directory, 'lib'), { recursive: true })
  mkdirSync(join(directory, ...HELPER.slice(0, -1)), { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: OFFICIAL_CUA_PROVIDER_PACKAGE, type: 'module', main: 'lib/index.js' }))
  writeFileSync(join(directory, 'lib', 'index.js'), [
    'import { join, resolve } from "node:path"',
    'import { fileURLToPath } from "node:url"',
    `export const helper = join(resolve(fileURLToPath(new URL("..", import.meta.url))), ${HELPER.map(part => JSON.stringify(part)).join(', ')})`,
  ].join('\n') + '\n')
  writeFileSync(join(directory, ...HELPER), '#!/bin/sh\n', { mode: 0o755 })
}

it('runs the provider from its unpacked copy, so the helper it starts is a physical file', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-official-cua-')))
  roots.push(root)
  const runtime = join(root, 'app.asar')
  for (const base of [runtime, join(root, 'app.asar.unpacked')]) writeProvider(join(base, PACKAGE))
  writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: 'dsh-plugin-desktop-beta' }))
  // vitest's own loader does not run hooks for ES modules, so a fresh Node loads the provider.
  const script = [
    `import { installOfficialCuaResolution } from ${JSON.stringify(new URL('../../src/upstream-family/official-cua.ts', import.meta.url).href)}`,
    `installOfficialCuaResolution(${JSON.stringify(runtime)})`,
    `console.log((await import(${JSON.stringify(pathToFileURL(join(runtime, PACKAGE, 'lib', 'index.js')).href)})).helper)`,
  ].join('\n')
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  expect(result.stdout.trim()).toBe(join(realpathSync(join(root, 'app.asar.unpacked', PACKAGE)), ...HELPER))
})

it('leaves a prepared runtime without an archive unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-official-cua-prepared-'))
  roots.push(root)
  expect(installOfficialCuaResolution(join(root, 'dsh'))).toBeUndefined()
})
