/** node --test for scripts/verify-bridge-surface.mjs（纯函数注入式用例）。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  consumedBridgeNames,
  exposedLiteralNames,
  listSourceFiles,
  verifyBridgeSurface,
} from './verify-bridge-surface.mjs'

const manifest = () => JSON.parse(JSON.stringify({
  exposure: { preload: ['__DSH_HOST_PATHS__', '__DSH_DIRECTORY_PICKER__'], scoped: ['dshDesktopBrowser'] },
  legacyFallbacks: [
    { name: 'dshDesktopFilePath', pairedPrimary: '__DSH_HOST_PATHS__' },
  ],
  scanRoots: ['pkg'],
  scanExcludedParts: ['node_modules'],
  scanExtensions: ['.js'],
}))

test('consumedBridgeNames captures literal, optional-chained, and TS as-any shapes', () => {
  const text = [
    "window.__DSH_HOST_PATHS__?.pathFor?.(f)",
    "(window as any).__DSH_DIRECTORY_PICKER__?.pick?.()",
    "window.dshDesktopFilePath?.forFile?.(f)",
    "window.dshDesktopActions.invoke(a)",
  ].join('\n')
  assert.deepEqual(
    [...consumedBridgeNames(text)].sort(),
    ['__DSH_DIRECTORY_PICKER__', '__DSH_HOST_PATHS__', 'dshDesktopActions', 'dshDesktopFilePath'],
  )
})

test('exposedLiteralNames reads string literals and ignores contract constants', () => {
  const text = [
    "contextBridge.exposeInMainWorld(DESKTOP_HOST_PATHS_BRIDGE, {})",
    "contextBridge.exposeInMainWorld('dshDesktopSaveFilePicker', {})",
  ].join('\n')
  assert.deepEqual([...exposedLiteralNames(text)], ['dshDesktopSaveFilePicker'])
})

test('verifyBridgeSurface passes a reconciled surface', () => {
  const violations = verifyBridgeSurface({
    manifest: manifest(),
    preloadSources: { 'p/src/preload.ts': "exposeInMainWorld('dshDesktopSetup', {})" },
    files: [
      { path: 'pkg/a.ts', text: "window.__DSH_HOST_PATHS__?.pathFor || window.dshDesktopFilePath?.forFile" },
      { path: 'pkg/b.ts', text: "window.dshDesktopBrowser.open()" },
    ],
  })
  assert.deepEqual(violations, [])
})

test('verifyBridgeSurface fails an undeclared consumer bridge', () => {
  const violations = verifyBridgeSurface({
    manifest: manifest(),
    preloadSources: {},
    files: [{ path: 'pkg/a.ts', text: 'window.__DSH_SECRET_BRIDGE__.open()' }],
  })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /undeclared bridge 'window\.__DSH_SECRET_BRIDGE__'/)
})

test('verifyBridgeSurface fails a dead legacy name without its paired primary', () => {
  const violations = verifyBridgeSurface({
    manifest: manifest(),
    preloadSources: {},
    files: [{ path: 'pkg/a.ts', text: 'window.dshDesktopFilePath?.forFile?.(f)' }],
  })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /legacy bridge 'window\.dshDesktopFilePath' without its current primary/)
})

test('verifyBridgeSurface fails a scoped bridge exposed from the main preload', () => {
  const violations = verifyBridgeSurface({
    manifest: manifest(),
    preloadSources: { 'p/src/preload.ts': "exposeInMainWorld('dshDesktopBrowser', {})" },
    files: [],
  })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /undeclared bridge 'dshDesktopBrowser'/)
})

test('listSourceFiles walks declared roots and skips excluded directory parts', () => {
  const table = {
    'root/pkg': [
      { name: 'a.js', isDirectory: () => false },
      { name: 'sub', isDirectory: () => true },
      { name: 'node_modules', isDirectory: () => true },
    ],
    'root/pkg/sub': [{ name: 'b.ts', isDirectory: () => false }],
    'root/pkg/node_modules': [{ name: 'c.js', isDirectory: () => false }],
    'root/other': [{ name: 'd.js', isDirectory: () => false }],
  }
  const readdir = (directory) => {
    const entries = table[directory.replaceAll('\\', '/')]
    if (entries === undefined) throw new Error(`ENOENT: ${directory}`)
    return entries
  }
  const files = listSourceFiles('root', {
    scanRoots: ['pkg'],
    scanExcludedParts: ['node_modules'],
    scanExtensions: ['.js', '.ts'],
  }, readdir)
  assert.deepEqual(files.map(path => path.replaceAll('\\', '/')), ['root/pkg/a.js', 'root/pkg/sub/b.ts'])
})
