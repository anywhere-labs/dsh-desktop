/** Load the official Computer Use provider from one packaged Next archive through the Host's resolver and check the helper it starts; no window, no input, no permission prompt. */
import { accessSync, constants, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) throw new Error('packaged-official-cua-smoke: expected the packaged application root')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
if (process.platform !== 'darwin' || manifest.dependencies?.['@deepseek-ai/dsh-cua-bundle'] === undefined) {
  console.log('Packaged official Computer Use smoke skipped: this package ships no macOS provider')
  process.exit(0)
}
const { installOfficialCuaResolution, OFFICIAL_CUA_PROVIDER_PACKAGE } = await import(pathToFileURL(join(root, 'lib', 'host-resolution.js')).href)
if (installOfficialCuaResolution(root) === undefined) throw new Error(`packaged-official-cua-smoke: ${root} is not an archive`)
// The loader imports the provider by name from the application root; it must run from the unpacked copy.
const entry = createRequire(join(root, 'package.json')).resolve(OFFICIAL_CUA_PROVIDER_PACKAGE)
if (!entry.includes('app.asar.unpacked')) throw new Error(`packaged-official-cua-smoke: ${OFFICIAL_CUA_PROVIDER_PACKAGE} resolved inside the archive: ${entry}`)
// Its shared CUA runtime import must stay the archive's copy.
const shared = createRequire(entry).resolve('@deepseek-ai/dsh-cua')
if (shared.includes('app.asar.unpacked')) throw new Error(`packaged-official-cua-smoke: @deepseek-ai/dsh-cua resolved outside the archive: ${shared}`)
const provider = await import(pathToFileURL(entry).href)
if (typeof provider.apply !== 'function') throw new Error('packaged-official-cua-smoke: the provider exports no apply')
// The provider starts native/bin/darwin-<arch>/dsh-cua-native below its package directory as a child process.
const helper = join(dirname(dirname(entry)), 'native', 'bin', `darwin-${process.arch}`, 'dsh-cua-native')
accessSync(helper, constants.X_OK)
console.log(`Packaged official Computer Use provider loaded from ${dirname(entry)} with its helper ${helper}`)
