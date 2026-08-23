/** Verify and materialize the canonical Aera Office Pro icon for macOS. */

import { copyFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Pixel width and height of the generated macOS icon canvas. */
export const MAC_APP_ICON_CANVAS_SIZE = 1024
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourcePath = join(packageRoot, 'build', 'aera-code-icon.png')
const outputPath = join(packageRoot, 'build', 'aera-code-icon-mac.png')

/**
 * Derive the macOS application icon without changing the cross-platform source.
 * @param {string} source - absolute path to the square source PNG.
 * @param {string} output - absolute path for the generated macOS PNG.
 * @returns {Promise<void>} Resolves after the complete PNG has been written.
 */
export async function generateMacAppIcon(source = sourcePath, output = outputPath) {
  if (resolve(source) === resolve(output)) {
    throw new Error('generate-mac-aera-code-icon: output must not overwrite the source icon')
  }

  const metadata = await sharp(source).metadata()
  if (metadata.format !== 'png'
    || metadata.width !== MAC_APP_ICON_CANVAS_SIZE
    || metadata.height !== MAC_APP_ICON_CANVAS_SIZE
    || metadata.channels !== 4
    || metadata.hasAlpha !== true) {
    throw new Error(
      `generate-mac-aera-code-icon: source must be a ${MAC_APP_ICON_CANVAS_SIZE}x${MAC_APP_ICON_CANVAS_SIZE} RGBA PNG`,
    )
  }
  await copyFile(source, output)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await generateMacAppIcon()
}
