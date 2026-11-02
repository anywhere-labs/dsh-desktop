/** Export native Icon Composer artwork; checking committed resources needs no Xcode. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
export const ICON_PACKAGES = Object.freeze({
  stable: 'dsh-plugin-desktop',
  beta: 'dsh-plugin-desktop-beta',
  next: 'dsh-desktop-next',
})
/** hicolor theme sizes up to the theme's 512px maximum; Linux packages install each PNG under hicolor/<size>x<size>/apps. */
export const LINUX_ICON_SIZES = Object.freeze([16, 22, 24, 32, 48, 64, 128, 256, 512])
// Stable is frozen and keeps the Linux set it committed before these exports covered Linux.
const LINUX_ICON_CHANNELS = new Set(['beta', 'next'])
// electron-builder's Linux targets install every file in the set directory named like this.
const LINUX_SIZED_ICON = /^\d+(?:x\d+)?\.png$/i
const outputs = ['app-icon.png', 'app-icon-mac.png', 'app-icon.ico', 'app-icon.icns']
const linuxOutputs = LINUX_ICON_SIZES.map(size => `icons/${size}x${size}.png`)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** Include every vector layer, not just icon.json, when detecting stale exports. */
export function iconSourceDigest(directory) {
  const digest = createHash('sha256')
  function visit(relative) {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name.startsWith('.')) continue
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) digest.update(path).update('\0').update(readFileSync(join(directory, path))).update('\0')
    }
  }
  visit('')
  return digest.digest('hex')
}

/**
 * Fail on source edits or missing/modified platform exports on any build host.
 * @param {string} buildDirectory - a channel's build directory.
 * @param {{ linux?: boolean }} [options] - `linux` also requires the Linux set and rejects any other size in its directory.
 */
export function checkIconResources(buildDirectory, { linux = false } = {}) {
  const record = JSON.parse(readFileSync(join(buildDirectory, 'app-icon.resources.json'), 'utf8'))
  const stale = () => { throw new Error(`${buildDirectory}: icon resources are stale; run corepack yarn icons:export on macOS and commit the results`) }
  if (record.source !== 'app-icon.icon' || record.sourceSha256 !== iconSourceDigest(join(buildDirectory, 'app-icon.icon'))) stale()
  for (const name of linux ? [...outputs, ...linuxOutputs] : outputs) {
    if (!existsSync(join(buildDirectory, name)) || record.outputs?.[name] !== hash(readFileSync(join(buildDirectory, name)))) stale()
  }
  if (linux && readdirSync(join(buildDirectory, 'icons')).some(name => LINUX_SIZED_ICON.test(name) && !linuxOutputs.includes(`icons/${name}`))) stale()
}

function developerDirectory() {
  const configured = process.env.DEVELOPER_DIR
  if (configured) {
    if (!existsSync(join(configured, 'usr/bin/actool'))) throw new Error('DEVELOPER_DIR must point to Xcode 26 or later, including actool')
    return configured
  }
  const selected = execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim()
  const candidates = [selected, '/Applications/Xcode.app/Contents/Developer', '/Applications/Xcode-beta.app/Contents/Developer']
  const available = candidates.find(path => existsSync(join(path, 'usr/bin/actool')))
  if (!available) throw new Error('Icon export requires Xcode and Icon Composer on macOS')
  return available
}

/**
 * Render the Linux set from the complete Composer export with the resampling of the Windows ICO frames.
 * @param {string} source - absolute path to the canonical 1024px PNG.
 * @param {string} directory - set directory; its previous contents are replaced.
 */
async function generateLinuxIconSet(source, directory) {
  const sharp = createRequire(join(root, 'dsh-plugin-desktop/package.json'))('sharp')
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory)
  for (const size of LINUX_ICON_SIZES) {
    let pipeline = sharp(source, { failOn: 'warning' })
      .resize({ width: size, height: size, fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .toColourspace('srgb')
      .ensureAlpha()
    if (size <= 96) pipeline = pipeline.sharpen({ sigma: size <= 32 ? 0.5 : 0.35 })
    await pipeline.png({ compressionLevel: 9, progressive: false, adaptiveFiltering: false, palette: false })
      .toFile(join(directory, `${size}x${size}.png`))
  }
}

/** Serialize the resource record; Beta and Next also record their Linux set. */
function resourceRecord(buildDirectory, sourceSha256, channel) {
  const linux = LINUX_ICON_CHANNELS.has(channel)
  return `${JSON.stringify({
    source: 'app-icon.icon', sourceSha256,
    mac: { input: 'app-icon.icon', legacy: 'app-icon.icns', catalogName: 'Icon' },
    png: { platform: 'macOS', rendition: 'Default', designGeneration: 27, size: 1024 },
    ...(linux ? { linux: { input: 'app-icon.png', sizes: LINUX_ICON_SIZES } } : {}),
    outputs: Object.fromEntries((linux ? [...outputs, ...linuxOutputs] : outputs).map(name => [name, hash(readFileSync(join(buildDirectory, name)))])),
  }, null, 2)}\n`
}

async function main() {
  const args = process.argv.slice(2)
  const requested = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : 'all'
  if (requested !== 'all' && !Object.hasOwn(ICON_PACKAGES, requested)) throw new Error('Use --channel stable, beta, next, or all')
  const selected = Object.entries(ICON_PACKAGES).filter(([channel]) => requested === 'all' || requested === channel)
  if (args.includes('--check')) {
    for (const [channel, name] of selected) {
      checkIconResources(join(root, name, 'build'), { linux: LINUX_ICON_CHANNELS.has(channel) })
      console.log(`icons: ${channel} source and all platform resources match`)
    }
    return
  }
  if (process.platform !== 'darwin') throw new Error('Run icons:export on macOS; other build hosts use the committed exports and icons:check')
  if (args.includes('--linux')) {
    // Derives only the Linux set from the committed Composer export, so no Xcode is needed.
    const linuxSelected = selected.filter(([channel]) => LINUX_ICON_CHANNELS.has(channel))
    if (linuxSelected.length === 0) throw new Error('--linux exports the Beta and Next sets; Stable keeps its committed one')
    for (const [channel, name] of linuxSelected) {
      const build = join(root, name, 'build')
      checkIconResources(build)
      await generateLinuxIconSet(join(build, 'app-icon.png'), join(build, 'icons'))
      writeFileSync(join(build, 'app-icon.resources.json'), resourceRecord(build, iconSourceDigest(join(build, 'app-icon.icon')), channel))
      checkIconResources(build, { linux: true })
      console.log(`icons: ${channel} exported the Linux set from the committed PNG`)
    }
    return
  }
  const developer = developerDirectory()
  const composer = join(dirname(developer), 'Applications/Icon Composer.app/Contents/Executables/ictool')
  if (!existsSync(composer)) throw new Error('Selected Xcode does not include Icon Composer')
  // Scoped to this command and its children; do not change xcode-select globally.
  process.env.DEVELOPER_DIR = developer
  process.env.PATH = `${join(developer, 'usr/bin')}${delimiter}${process.env.PATH ?? ''}`
  const require = createRequire(join(root, 'dsh-plugin-desktop/package.json'))
  const { generateAssetCatalogForIcon } = require('app-builder-lib/out/util/macosIconComposer.js')
  const { generateMacAppIcon } = await import('../dsh-plugin-desktop/scripts/generate-mac-app-icon.mjs')
  const { generateWindowsAppIcon } = await import('../dsh-plugin-desktop/scripts/generate-windows-app-icon.mjs')

  for (const [channel, name] of selected) {
    const build = join(root, name, 'build')
    const source = join(build, 'app-icon.icon')
    const sourceSha256 = iconSourceDigest(source)
    execFileSync(composer, [source, '--export-image', '--output-file', join(build, 'app-icon.png'),
      '--platform', 'macOS', '--rendition', 'Default', '--width', '1024', '--height', '1024', '--scale', '1',
      '--design-generation', '27'], { stdio: 'pipe' })
    // Compile the actual layered source through the same implementation as mac.icon.
    // The application gets Assets.car at packaging time; this ICNS is for legacy systems and DMGs.
    const { assetCatalog, icnsFile } = await generateAssetCatalogForIcon(source)
    if (!assetCatalog.length || icnsFile.subarray(0, 4).toString() !== 'icns') throw new Error(`Invalid native icon compilation for ${channel}`)
    writeFileSync(join(build, 'app-icon.icns'), icnsFile)
    await generateMacAppIcon(join(build, 'app-icon.png'), join(build, 'app-icon-mac.png'))
    await generateWindowsAppIcon(join(build, 'app-icon.png'), join(build, 'app-icon.ico'))
    const linux = LINUX_ICON_CHANNELS.has(channel)
    if (linux) await generateLinuxIconSet(join(build, 'app-icon.png'), join(build, 'icons'))
    if (sourceSha256 !== iconSourceDigest(source)) throw new Error('Icon source changed while exporting; save the document and run icons:export again')
    writeFileSync(join(build, 'app-icon.resources.json'), resourceRecord(build, sourceSha256, channel))
    checkIconResources(build, { linux })
    console.log(`icons: ${channel} exported PNG, ICO${linux ? ', the Linux set' : ''} and native ICNS; layered Assets.car compilation passed (${assetCatalog.length} bytes)`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
