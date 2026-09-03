/** Generate native tray bitmaps from the repository-owned brand SVG. */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'tray-icon.svg')
const source = await readFile(sourcePath, 'utf8')

const BRAND_BLUE = '#4D6BFE'
if (!source.includes(`fill="${BRAND_BLUE}"`) || /<style\b/iu.test(source)) {
  throw new Error(`generate-tray-icons: tray-icon.svg must use the fixed brand color ${BRAND_BLUE}`)
}

// Windows taskbar glyphs are named for the taskbar variant they target and stay
// DPI-complete (1x/1.25x/1.5x/2x) to match the brand-blue asset set.
const variants = [
  ['tray-iconTemplate.png', '#000000', 16],
  ['tray-iconTemplate@2x.png', '#000000', 32],
  ['tray-icon-blue.png', BRAND_BLUE, 16],
  ['tray-icon-blue@1.25x.png', BRAND_BLUE, 20],
  ['tray-icon-blue@1.5x.png', BRAND_BLUE, 24],
  ['tray-icon-blue@2x.png', BRAND_BLUE, 32],
  ['tray-icon-win-dark-taskbar.png', '#FFFFFF', 16],
  ['tray-icon-win-dark-taskbar@1.25x.png', '#FFFFFF', 20],
  ['tray-icon-win-dark-taskbar@1.5x.png', '#FFFFFF', 24],
  ['tray-icon-win-dark-taskbar@2x.png', '#FFFFFF', 32],
  ['tray-icon-win-light-taskbar.png', '#000000', 16],
  ['tray-icon-win-light-taskbar@1.25x.png', '#000000', 20],
  ['tray-icon-win-light-taskbar@1.5x.png', '#000000', 24],
  ['tray-icon-win-light-taskbar@2x.png', '#000000', 32],
]

await Promise.all(variants.map(async ([filename, color, size]) => {
  const rendered = source.replaceAll(BRAND_BLUE, color)
  await sharp(Buffer.from(rendered))
    .resize({ width: size, height: size, fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(join(buildRoot, filename))
}))
