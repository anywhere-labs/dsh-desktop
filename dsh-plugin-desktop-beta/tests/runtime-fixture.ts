/** Temporary materialized payloads for Next descriptor and file policy tests. */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_RUNTIME_FILE, physicalPayload, sealPayload, type DesktopRuntimeDescriptor, type NextRelease, type NextRuntimeTarget } from '../src/runtime-tree.ts'

/**
 * Write a package fixture with explicit runtime exports.
 * @param modules - Owning node_modules directory.
 * @param name - Package name.
 * @param fields - Manifest fields.
 * @param source - ESM entry contents.
 * @returns Installed package directory.
 */
export function writePackage(modules: string, name: string, fields: Record<string, unknown> = {}, source = 'export const identity = {}\n'): string {
  const path = join(modules, name)
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: './index.js', ...fields }))
  writeFileSync(join(path, 'index.js'), source)
  return path
}

/** Release facts every fixture payload declares. */
export const FIXTURE_RELEASE: NextRelease = { schemaVersion: 1, version: '2.0.0-beta.1', dshVersion: '1.0.0', electronVersion: '44.0.0', pnpmVersion: '11.28.5' }

/** Target every fixture payload declares. */
export const FIXTURE_TARGET: NextRuntimeTarget = { platform: process.platform, archs: [process.arch] }

/** Shared packages every fixture payload carries. */
export const FIXTURE_SHARED = ['@deepseek-ai/dsh', '@deepseek-ai/cordis', '@deepseek-ai/dsh-base', 'pnpm']

/**
 * Write a minimal Next application: the manifest, shell code and shared packages.
 * @param root - New application directory.
 * @param release - Release facts; the dsh package takes `dshVersion`.
 */
export function writeApplication(root: string, release = FIXTURE_RELEASE): void {
  const modules = join(root, 'node_modules')
  for (const name of FIXTURE_SHARED) {
    writePackage(modules, name, { version: name === '@deepseek-ai/dsh' ? release.dshVersion : name === 'pnpm' ? release.pnpmVersion : '1.0.0' })
  }
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'lib', 'main.js'), 'export {}\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-plugin-desktop-beta', version: release.version, type: 'module',
    dependencies: Object.fromEntries(FIXTURE_SHARED.map(name => [name, '*'])) }) + '\n')
}

/**
 * Add what a complete Next payload needs beyond {@link writeApplication}: the shell files the
 * Host and shell open by name, the official frontend, the pnpm entry and the icon assets.
 * @param root - Application directory written by {@link writeApplication}.
 */
export function completeApplication(root: string): void {
  for (const path of ['lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs', 'lib/native-ui/index.html',
    'cordis.patch.yml', 'host.cordis.patch.yml', 'scripts/node-bin/node', 'scripts/node-bin/node.cmd',
    'assets/tray-iconTemplate.png', 'assets/tray-icon-blue.png', 'build/app-icon.ico', 'build/app-icon.png', 'build/app-icon-mac.png']) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), `payload:${path}\n`)
  }
  if (process.platform !== 'win32') chmodSync(join(root, 'scripts', 'node-bin', 'node'), 0o755)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  manifest.dependencies['@deepseek-ai/dsh-web-frontend'] = '*'
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest) + '\n')
  const modules = join(root, 'node_modules')
  const frontend = writePackage(modules, '@deepseek-ai/dsh-web-frontend')
  mkdirSync(join(frontend, 'dist'))
  writeFileSync(join(frontend, 'dist', 'index.html'), '<html></html>')
  mkdirSync(join(modules, 'pnpm', 'bin'), { recursive: true })
  writeFileSync(join(modules, 'pnpm', 'bin', 'pnpm.mjs'), 'export {}\n')
}

/**
 * Seal a minimal unpacked Next application with its descriptor inside the directory.
 * @param root - New application directory.
 * @param release - Release facts; the dsh package takes `dshVersion`.
 * @param target - Platform and architectures recorded in the descriptor.
 * @returns Sealed descriptor.
 */
export function runtimeFixture(root: string, release = FIXTURE_RELEASE, target = FIXTURE_TARGET): DesktopRuntimeDescriptor {
  writeApplication(root, release)
  return sealPayload(physicalPayload(root), join(root, DESKTOP_RUNTIME_FILE), release, FIXTURE_SHARED, target)
}
