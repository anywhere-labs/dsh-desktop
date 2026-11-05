/** Run sharp from one packaged Next archive through the Host's resolver and process an image as an attachment would; Linux must run the WebAssembly build. No window, no input. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) throw new Error('packaged-sharp-smoke: expected the packaged application root')
const { installSharpWasmResolution, SHARP_WASM_PACKAGE } = await import(pathToFileURL(join(root, 'lib', 'host-resolution.js')).href)
const warnings = []
process.on('warning', (warning) => { warnings.push(warning.code ?? warning.name) })
installSharpWasmResolution(root)
// The attachment and Market plugins resolve sharp by name from the application tree.
const require = createRequire(join(root, 'package.json'))
const sharp = require('sharp')
const wasm = Object.keys(require.cache).some(path => path.replaceAll('\\', '/').includes(`/node_modules/${SHARP_WASM_PACKAGE}/`))
const backend = wasm ? 'WebAssembly' : 'native'
// Electron's Linux executable links the system GLib, which the native Linux backends collide with.
if (wasm !== (process.platform === 'linux')) throw new Error(`packaged-sharp-smoke: sharp ${sharp.versions.sharp} runs its ${backend} backend on ${process.platform}`)
const png = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 0.5 } } }).png().toBuffer()
const { data, info } = await sharp(png, { failOn: 'error', limitInputPixels: false }).rotate().toColourspace('srgb')
  .resize({ width: 32, height: 32, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85, effort: 0 }).toBuffer({ resolveWithObject: true })
const decoded = await sharp(data, { failOn: 'error' }).metadata()
if (decoded.format !== 'webp' || decoded.width !== info.width || decoded.height !== info.height || decoded.hasAlpha !== true) {
  throw new Error(`packaged-sharp-smoke: the WebP round trip came back as ${String(decoded.format)} ${String(decoded.width)}x${String(decoded.height)}`)
}
// sharp warns when it loads a native backend under Electron on Linux.
if (warnings.includes('SharpElectronLinux')) throw new Error('packaged-sharp-smoke: sharp loaded a native Linux backend under Electron')
console.log(`Packaged sharp ${sharp.versions.sharp} ran its ${backend} backend: libvips ${sharp.versions.vips}, ${String(info.width)}x${String(info.height)} WebP round trip`)
