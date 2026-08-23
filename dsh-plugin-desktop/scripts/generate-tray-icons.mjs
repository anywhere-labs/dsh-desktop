/** Generate native tray bitmaps from the canonical Aera aperture artwork. */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'aera-aperture.png')

const AERA_ACCENT = '#0f7fff'

const variants = [
  ['aera-aperture-trayTemplate.png', '#000000', 16],
  ['aera-aperture-trayTemplate@2x.png', '#000000', 32],
  ['aera-aperture-tray-blue.png', AERA_ACCENT, 16],
  ['aera-aperture-tray-blue@1.25x.png', AERA_ACCENT, 20],
  ['aera-aperture-tray-blue@1.5x.png', AERA_ACCENT, 24],
  ['aera-aperture-tray-blue@2x.png', AERA_ACCENT, 32],
]

await Promise.all(variants.map(async ([filename, color, size]) => {
  await sharp(sourcePath, { failOn: 'warning' })
    .resize({ width: size, height: size, fit: 'contain' })
    .tint(color)
    .png({ compressionLevel: 9 })
    .toFile(join(buildRoot, filename))
}))
