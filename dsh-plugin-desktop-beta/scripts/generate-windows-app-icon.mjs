/** Generate a Windows ICO with exact-DPI frames for the application and NSIS. */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Native pixel sizes used by Windows chrome, taskbars, Explorer, and high-DPI variants. */
export const WINDOWS_APP_ICON_SIZES = Object.freeze([
  16,
  20,
  24,
  28,
  30,
  32,
  36,
  40,
  48,
  60,
  64,
  72,
  80,
  96,
  128,
  256,
])

const SOURCE_CANVAS_SIZE = 1024
const SMALL_FRAME_MAX_SIZE = 48
const BRAND_BLUE = '#4D6BFE'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourcePath = join(packageRoot, 'build', 'app-icon.png')
const markPath = join(packageRoot, 'build', 'tray-icon.svg')
const outputPath = join(packageRoot, 'build', 'app-icon.ico')

/**
 * Reuse the repository's vector whale for frames where the full shaded artwork
 * loses recognizable detail. The flat inverted treatment mirrors the stable
 * icon's dark-on-light small-size silhouette.
 * @returns {Promise<Buffer>} Self-contained SVG for small Windows frames.
 */
async function loadSmallFrameArtwork() {
  const source = await readFile(markPath, 'utf8')
  if (!source.includes(`fill="${BRAND_BLUE}"`) || /<style\b/iu.test(source)) {
    throw new Error(`generate-windows-app-icon: tray-icon.svg must use the fixed brand color ${BRAND_BLUE}`)
  }
  const mark = source
    .replace(/^<svg[^>]*>\s*/u, '')
    .replace(/<\/svg>\s*$/u, '')
    .replaceAll(BRAND_BLUE, '#FFFFFF')
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">'
    + '<rect width="50" height="50" rx="11" fill="#000000"/>'
    + `<g transform="translate(5 5) scale(0.8)">${mark}</g>`
    + '</svg>',
  )
}

/**
 * Render one icon frame from the full-resolution Beta artwork.
 * Small frames use the simplified vector treatment and receive a restrained
 * unsharp pass after Lanczos downsampling.
 * @param {string} source - absolute path to the canonical 1024px PNG.
 * @param {Buffer} smallArtwork - simplified vector artwork for native small sizes.
 * @param {number} size - square output size in native pixels.
 * @returns {Promise<{ png: Buffer, rgba: Buffer }>} Encoded and raw 8-bit RGBA data.
 */
async function renderFrame(source, smallArtwork, size) {
  const input = size <= SMALL_FRAME_MAX_SIZE ? smallArtwork : source
  let pipeline = sharp(input, { failOn: 'warning' })
    .resize({ width: size, height: size, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toColourspace('srgb')
    .ensureAlpha()

  if (size <= 96) pipeline = pipeline.sharpen({ sigma: size <= 32 ? 0.5 : 0.35 })

  const png = await pipeline
    .clone()
    .png({
      compressionLevel: 9,
      progressive: false,
      adaptiveFiltering: false,
      palette: false,
    })
    .toBuffer()
  const { data: rgba, info } = await pipeline
    .clone()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true })

  if (info.width !== size || info.height !== size || info.channels !== 4) {
    throw new Error(`generate-windows-app-icon: failed to render ${size}x${size} RGBA frame`)
  }
  return { png, rgba }
}

/**
 * Encode an uncompressed 32-bit Windows DIB frame with an AND transparency mask.
 * Keeping sub-256px frames as DIBs avoids depending on small-PNG icon support in
 * older Win32 and installer image-loading paths.
 * @param {Buffer} rgba - top-down, unpremultiplied RGBA pixels.
 * @param {number} size - square frame size.
 * @returns {Buffer} ICO image payload.
 */
function encodeDibFrame(rgba, size) {
  const xorBytes = size * size * 4
  const maskRowBytes = Math.ceil(size / 32) * 4
  const maskBytes = maskRowBytes * size
  const dib = Buffer.alloc(40 + xorBytes + maskBytes)

  dib.writeUInt32LE(40, 0)
  dib.writeInt32LE(size, 4)
  dib.writeInt32LE(size * 2, 8)
  dib.writeUInt16LE(1, 12)
  dib.writeUInt16LE(32, 14)
  dib.writeUInt32LE(0, 16)
  dib.writeUInt32LE(xorBytes, 20)

  const pixelsOffset = 40
  const maskOffset = pixelsOffset + xorBytes
  for (let y = 0; y < size; y += 1) {
    const sourceRow = y * size * 4
    const destinationRow = pixelsOffset + (size - y - 1) * size * 4
    const destinationMaskRow = maskOffset + (size - y - 1) * maskRowBytes
    for (let x = 0; x < size; x += 1) {
      const source = sourceRow + x * 4
      const destination = destinationRow + x * 4
      dib[destination] = rgba[source + 2]
      dib[destination + 1] = rgba[source + 1]
      dib[destination + 2] = rgba[source]
      dib[destination + 3] = rgba[source + 3]
      if (rgba[source + 3] === 0) {
        dib[destinationMaskRow + Math.floor(x / 8)] |= 0x80 >> (x % 8)
      }
    }
  }
  return dib
}

/**
 * Wrap ordered image payloads in one Windows ICO directory.
 * @param {Array<{ size: number, data: Buffer }>} frames - encoded icon frames.
 * @returns {Buffer} Complete ICO file.
 */
function encodeIco(frames) {
  const headerSize = 6 + frames.length * 16
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  let dataOffset = headerSize
  for (const [index, frame] of frames.entries()) {
    const entry = 6 + index * 16
    header[entry] = frame.size === 256 ? 0 : frame.size
    header[entry + 1] = frame.size === 256 ? 0 : frame.size
    header[entry + 2] = 0
    header[entry + 3] = 0
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(frame.data.length, entry + 8)
    header.writeUInt32LE(dataOffset, entry + 12)
    dataOffset += frame.data.length
  }
  return Buffer.concat([header, ...frames.map(frame => frame.data)])
}

/**
 * Generate the Beta Windows icon without changing the cross-platform source.
 * @param {string} source - absolute path to the canonical source PNG.
 * @param {string} output - absolute path for the generated ICO.
 * @returns {Promise<void>} Resolves after the complete ICO has been written.
 */
export async function generateWindowsAppIcon(source = sourcePath, output = outputPath) {
  if (resolve(source) === resolve(output)) {
    throw new Error('generate-windows-app-icon: output must not overwrite the source icon')
  }

  const metadata = await sharp(source).metadata()
  if (
    metadata.format !== 'png'
    || metadata.width !== SOURCE_CANVAS_SIZE
    || metadata.height !== SOURCE_CANVAS_SIZE
    || metadata.space !== 'rgb16'
    || metadata.depth !== 'ushort'
    || metadata.bitsPerSample !== 16
    || metadata.channels !== 4
    || metadata.hasAlpha !== true
    || metadata.icc === undefined
  ) {
    throw new Error(
      `generate-windows-app-icon: source must be a ${SOURCE_CANVAS_SIZE}x${SOURCE_CANVAS_SIZE} RGBA16 PNG with an ICC profile`,
    )
  }

  const smallArtwork = await loadSmallFrameArtwork()
  const rendered = await Promise.all(WINDOWS_APP_ICON_SIZES.map(async size => {
    const frame = await renderFrame(source, smallArtwork, size)
    return {
      size,
      data: size === 256 ? frame.png : encodeDibFrame(frame.rgba, size),
    }
  }))
  if (!rendered.at(-1)?.data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('generate-windows-app-icon: the 256px frame must use PNG encoding')
  }

  await writeFile(output, encodeIco(rendered))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await generateWindowsAppIcon()
}
