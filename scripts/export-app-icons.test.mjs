import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLASSIC_ICON_DIRECTORY, checkIconResources, DARK_ICONS, iconSets, iconSourceDigest, LINUX_ICON_SIZES, PREVIEW_ICON, TRAY_ICONS } from './export-app-icons.mjs'

test('resource checks reject edited vector layers, edited exports and missing exports without Xcode', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  const source = join(directory, 'app-icon.icon')
  mkdirSync(join(source, 'Assets'), { recursive: true })
  writeFileSync(join(source, 'icon.json'), '{"fill":"system-dark"}')
  writeFileSync(join(source, 'Assets/Logo.svg'), '<svg/>')
  const names = ['app-icon.png', 'app-icon-mac.png', 'app-icon.icns', 'app-icon.ico']
  for (const name of names) writeFileSync(join(directory, name), name)
  writeFileSync(join(directory, 'app-icon.resources.json'), JSON.stringify({
    source: 'app-icon.icon', sourceSha256: iconSourceDigest(source),
    outputs: Object.fromEntries(names.map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')])),
  }))
  try {
    assert.doesNotThrow(() => checkIconResources(directory))
    writeFileSync(join(source, 'Assets/Logo.svg'), '<svg><path/></svg>')
    assert.throws(() => checkIconResources(directory), /resources are stale/)
    writeFileSync(join(source, 'Assets/Logo.svg'), '<svg/>')
    writeFileSync(join(directory, 'app-icon.ico'), 'old icon')
    assert.throws(() => checkIconResources(directory), /resources are stale/)
    writeFileSync(join(directory, 'app-icon.ico'), 'app-icon.ico')
    rmSync(join(directory, 'app-icon.icns'))
    assert.throws(() => checkIconResources(directory), /resources are stale/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Linux resource checks require every hicolor size and reject other sizes that electron-builder would install', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  const source = join(directory, 'app-icon.icon')
  mkdirSync(source)
  writeFileSync(join(source, 'icon.json'), '{"fill":"system-dark"}')
  mkdirSync(join(directory, 'icons'))
  const names = ['app-icon.png', 'app-icon-mac.png', 'app-icon.icns', 'app-icon.ico', ...LINUX_ICON_SIZES.map(size => `icons/${size}x${size}.png`)]
  for (const name of names) writeFileSync(join(directory, name), name)
  writeFileSync(join(directory, 'app-icon.resources.json'), JSON.stringify({
    source: 'app-icon.icon', sourceSha256: iconSourceDigest(source),
    outputs: Object.fromEntries(names.map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')])),
  }))
  try {
    assert.doesNotThrow(() => checkIconResources(directory, { linux: true }))
    writeFileSync(join(directory, 'icons/.DS_Store'), 'Finder metadata')
    assert.doesNotThrow(() => checkIconResources(directory, { linux: true }))
    writeFileSync(join(directory, 'icons/1024x1024.png'), 'a size the hicolor theme does not declare')
    assert.throws(() => checkIconResources(directory, { linux: true }), /resources are stale/)
    rmSync(join(directory, 'icons/1024x1024.png'))
    rmSync(join(directory, 'icons/22x22.png'))
    assert.throws(() => checkIconResources(directory, { linux: true }), /resources are stale/)
    // Stable keeps its committed set outside the record.
    assert.doesNotThrow(() => checkIconResources(directory))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('tray resource checks require every tray image in the synced assets directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  const build = join(directory, 'build')
  const source = join(build, 'app-icon.icon')
  mkdirSync(source, { recursive: true })
  mkdirSync(join(directory, 'assets'))
  writeFileSync(join(source, 'icon.json'), '{"fill":"system-dark"}')
  const names = ['app-icon.png', 'app-icon-mac.png', 'app-icon.icns', 'app-icon.ico', ...TRAY_ICONS.map(([name]) => `../assets/${name}`)]
  for (const name of names) writeFileSync(join(build, name), name)
  writeFileSync(join(build, 'app-icon.resources.json'), JSON.stringify({
    source: 'app-icon.icon', sourceSha256: iconSourceDigest(source),
    outputs: Object.fromEntries(names.map(name => [name, createHash('sha256').update(readFileSync(join(build, name))).digest('hex')])),
  }))
  try {
    assert.doesNotThrow(() => checkIconResources(build, { tray: true }))
    writeFileSync(join(directory, 'assets/tray-iconTemplate@2x.png'), 'previous artwork')
    assert.throws(() => checkIconResources(build, { tray: true }), /resources are stale/)
    writeFileSync(join(directory, 'assets/tray-iconTemplate@2x.png'), '../assets/tray-iconTemplate@2x.png')
    rmSync(join(directory, 'assets/tray-icon-blue@1.5x.png'))
    assert.throws(() => checkIconResources(build, { tray: true }), /resources are stale/)
    // Stable keeps its tray images outside the record.
    assert.doesNotThrow(() => checkIconResources(build))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Beta and Next export a classic set beside the default one, which alone has a Dark rendition; Stable keeps only its own', () => {
  const build = join(tmpdir(), 'build')
  assert.deepEqual(iconSets('stable', build).map(({ name, directory, linux, tray, preview, dark }) => ({ name, directory, linux, tray, preview, dark })),
    [{ name: 'default', directory: build, linux: false, tray: false, preview: false, dark: false }])
  for (const channel of ['beta', 'next']) {
    const [standard, classic, ...rest] = iconSets(channel, build)
    assert.deepEqual(rest, [])
    assert.deepEqual({ ...standard }, { name: 'default', directory: build, linux: true, tray: true, preview: true, dark: true })
    assert.equal(classic.directory, join(build, CLASSIC_ICON_DIRECTORY))
    assert.equal(classic.linux, undefined)
    assert.equal(classic.dark, undefined)
    assert.equal(classic.trayCopy, 'dsh-plugin-desktop/build')
    assert.equal(classic.preview, true)
  }
})

test('dark resource checks require the Dark rendition and its preview', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  const source = join(directory, 'app-icon.icon')
  mkdirSync(source)
  writeFileSync(join(source, 'icon.json'), '{"fill":"system-dark"}')
  const names = ['app-icon.png', 'app-icon-mac.png', 'app-icon.icns', 'app-icon.ico', PREVIEW_ICON[0], DARK_ICONS.png, DARK_ICONS.ico, DARK_ICONS.preview]
  for (const name of names) writeFileSync(join(directory, name), name)
  writeFileSync(join(directory, 'app-icon.resources.json'), JSON.stringify({
    source: 'app-icon.icon', sourceSha256: iconSourceDigest(source),
    outputs: Object.fromEntries(names.map(name => [name, createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')])),
  }))
  try {
    assert.doesNotThrow(() => checkIconResources(directory, { preview: true, dark: true }))
    writeFileSync(join(directory, DARK_ICONS.ico), 'the light frames')
    assert.throws(() => checkIconResources(directory, { preview: true, dark: true }), /resources are stale/)
    // Without the flag, as for Stable, the Dark rendition is not required.
    rmSync(join(directory, DARK_ICONS.ico))
    assert.doesNotThrow(() => checkIconResources(directory, { preview: true }))
    rmSync(join(directory, DARK_ICONS.preview))
    assert.throws(() => checkIconResources(directory, { preview: true, dark: true }), /resources are stale/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('classic resource checks require the preview and the tray images in the classic assets directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-icons-'))
  const [, classic] = iconSets('next', join(directory, 'build'))
  const source = join(classic.directory, 'app-icon.icon')
  mkdirSync(source, { recursive: true })
  mkdirSync(join(directory, 'assets/classic'), { recursive: true })
  writeFileSync(join(source, 'icon.json'), '{"fill":"system-dark"}')
  const names = ['app-icon.png', 'app-icon-mac.png', 'app-icon.icns', 'app-icon.ico', PREVIEW_ICON[0],
    ...TRAY_ICONS.map(([name]) => `../../assets/classic/${name}`)]
  for (const name of names) writeFileSync(join(classic.directory, name), name)
  writeFileSync(join(classic.directory, 'app-icon.resources.json'), JSON.stringify({
    source: 'app-icon.icon', sourceSha256: iconSourceDigest(source),
    outputs: Object.fromEntries(names.map(name => [name, createHash('sha256').update(readFileSync(join(classic.directory, name))).digest('hex')])),
  }))
  try {
    assert.doesNotThrow(() => checkIconResources(classic.directory, classic))
    // The default set's tray directory is not the classic one.
    assert.throws(() => checkIconResources(classic.directory, { tray: true }), /resources are stale/)
    writeFileSync(join(directory, 'assets/classic/tray-icon-blue@2x.png'), 'the whale tail')
    assert.throws(() => checkIconResources(classic.directory, classic), /resources are stale/)
    writeFileSync(join(directory, 'assets/classic/tray-icon-blue@2x.png'), '../../assets/classic/tray-icon-blue@2x.png')
    rmSync(join(classic.directory, PREVIEW_ICON[0]))
    assert.throws(() => checkIconResources(classic.directory, classic), /resources are stale/)
    assert.doesNotThrow(() => checkIconResources(classic.directory, { ...classic, preview: false }))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
