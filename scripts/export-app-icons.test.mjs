import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkIconResources, iconSourceDigest, LINUX_ICON_SIZES } from './export-app-icons.mjs'

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
