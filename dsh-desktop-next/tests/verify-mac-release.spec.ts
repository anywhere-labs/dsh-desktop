import { expect, it } from 'vitest'
import { expectedMacDmgs } from '../scripts/verify-mac-release.ts'

const dmgs = ['/dist/DSH-NEXT-2.0.22-next-arm64.dmg', '/dist/DSH-NEXT-2.0.22-next-x64.dmg',
  '/dist/DSH-NEXT-2.0.22-next-universal.dmg']

it('verifies each DMG as the package its name declares, in the order they were found', () => {
  expect(expectedMacDmgs(dmgs, ['arm64', 'x64', 'universal'])).toEqual([['arm64', dmgs[0]], ['x64', dmgs[1]], ['universal', dmgs[2]]])
  expect(expectedMacDmgs([dmgs[2]!], ['universal'])).toEqual([['universal', dmgs[2]]])
})

it('requires exactly one DMG for each package the build was asked for', () => {
  expect(() => expectedMacDmgs(dmgs.slice(0, 2), ['arm64', 'x64', 'universal'])).toThrow('Expected one macOS DMG each for arm64, x64, universal; found arm64, x64')
  expect(() => expectedMacDmgs(dmgs, ['arm64'])).toThrow('found arm64, universal, x64')
  expect(() => expectedMacDmgs([], ['arm64'])).toThrow('found none')
  expect(() => expectedMacDmgs(['/dist/DSH-NEXT-2.0.22-next.dmg'], ['universal'])).toThrow('must end in -arm64, -x64 or -universal: DSH-NEXT-2.0.22-next.dmg')
})
