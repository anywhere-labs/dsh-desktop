/** Load the native computer-use driver from one packaged Next archive through the Host's resolver and list its tools; no window, no input, no permission prompt. */
import { readFileSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) throw new Error('packaged-driver-smoke: expected the packaged application root')
const { installCuaDriverResolution, CUA_DRIVER_PLATFORM_PACKAGES } = await import(pathToFileURL(join(root, 'lib', 'host-resolution.js')).href)
if (installCuaDriverResolution(root) === undefined) throw new Error(`packaged-driver-smoke: ${root} is not an archive`)
// The driver's exports map names only its entries, so its manifest is located without it.
const manifest = findPackageJSON('@trycua/cua-driver', pathToFileURL(join(root, 'package.json')))
if (manifest === undefined) throw new Error('packaged-driver-smoke: the archive carries no @trycua/cua-driver')
const { exports } = JSON.parse(readFileSync(manifest, 'utf8'))
const entry = join(dirname(manifest), exports['.'].import)
// The driver resolves its platform package from its Node runtime module and hands the library beside the manifest to
// the system loader, so that package must come back physical.
const platform = `${CUA_DRIVER_PLATFORM_PACKAGES}${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : ''}`
const resolved = createRequire(entry).resolve(`${platform}/package.json`)
if (!resolved.includes('app.asar.unpacked')) throw new Error(`packaged-driver-smoke: ${platform} resolved inside the archive: ${resolved}`)
const { CuaDriver } = await import(pathToFileURL(entry).href)
const driver = CuaDriver.create(undefined)
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 60_000)
try {
  const catalog = JSON.parse(await driver.listToolsJson({ signal: controller.signal }))
  if (!Array.isArray(catalog.tools) || catalog.tools.length === 0) throw new Error('packaged-driver-smoke: the driver listed no tools')
  console.log(`Packaged computer-use driver loaded from ${dirname(resolved)}: ${String(catalog.tools.length)} tools`)
} finally {
  clearTimeout(timer)
  await driver.shutdown()
  driver.uniffiDestroy()
}
