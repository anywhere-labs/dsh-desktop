import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
it('keeps Next installer topology, native modules, fuses and Composer source aligned with Beta', () => {
  const next = read('../package.json'); const beta = read('../../dsh-plugin-desktop-beta/package.json')
  expect(next.version).toBe('2.0.14-next')
  expect(next.build.appId).toBe('ai.deepseek.dsh.desktop.next')
  expect(next.build.asar).toBe(false)
  expect(next.build.electronFuses).toEqual(beta.build.electronFuses)
  expect(next.build.mac.x64ArchFiles).toBe(beta.build.mac.x64ArchFiles.replace('**}', '**,@trycua/cua-driver-darwin-*/**,@ubjs/node-darwin-*/**}'))
  expect(next.build.mac.icon).toBe('build/app-icon.icon')
  expect(existsSync(new URL('../build/app-icon.icon/icon.json', import.meta.url))).toBe(true)
  expect(next.build.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true })
  expect(next.build.mac.notarize).toBe(true)
  expect(next.build.files).toContain('lib/**')
  expect(next.build.files.some((path: string) => path.includes('.desktop-next'))).toBe(false)
})
