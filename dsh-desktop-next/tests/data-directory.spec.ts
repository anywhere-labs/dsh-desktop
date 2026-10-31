import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { dataDirectoryChange, dataDirectoryLocationFile, dataDirectoryLocationRoot, defaultDataDirectory, readDataDirectory, rememberDataDirectory, sameDirectory, validateDataDirectory } from '../src/data-directory.ts'
import { NextProfiles } from '../src/profiles.ts'

const homes: string[] = []
function home() { const path = mkdtempSync(join(tmpdir(), 'next-data-directory-')); homes.push(path); return path }
afterEach(() => homes.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

it('prefers the in-app choice over DSH_DESKTOP_NEXT_HOME, which applies only without one, over the shared default', () => {
  const user = home(), locationRoot = home(), variable = home(), selected = home()
  const shared = join(user, '.dsh')
  expect(defaultDataDirectory(user)).toBe(shared)
  expect(readDataDirectory(locationRoot, undefined, user)).toEqual({ home: shared, source: 'default', fallback: shared })
  expect(readDataDirectory(locationRoot, variable, user)).toEqual({ home: variable, source: 'environment', fallback: variable })
  writeFileSync(dataDirectoryLocationFile(locationRoot), JSON.stringify({ home: selected }))
  expect(readDataDirectory(locationRoot, variable, user)).toEqual({ home: selected, source: 'desktop', fallback: variable })
  expect(readDataDirectory(locationRoot, undefined, user)).toEqual({ home: selected, source: 'desktop', fallback: shared })
})

it('keeps the choice in one fixed place: a choice file inside the variable directory is no longer read', () => {
  const locationRoot = home(), variable = home(), selected = home()
  expect(dataDirectoryLocationRoot(true, () => join(locationRoot, 'appData'), variable)).toBe(join(locationRoot, 'appData', 'DSH NEXT', 'home'))
  expect(dataDirectoryLocationRoot(false, () => { throw new Error('Development keeps its anchor beside the package') }, variable)).toBe(join(variable, '.desktop-next', 'home'))
  writeFileSync(join(variable, 'desktop-next-location.json'), JSON.stringify({ home: selected }))
  expect(readDataDirectory(locationRoot, variable)).toEqual({ home: variable, source: 'environment', fallback: variable })
})

it('reports a malformed choice for recovery and falls back without losing how the fallback was chosen', () => {
  const locationRoot = home(), variable = home()
  writeFileSync(dataDirectoryLocationFile(locationRoot), '{broken')
  expect(readDataDirectory(locationRoot, variable)).toMatchObject({ home: variable, source: 'environment', fallback: variable, error: expect.any(String) })
  writeFileSync(dataDirectoryLocationFile(locationRoot), JSON.stringify({ home: 'relative' }))
  expect(readDataDirectory(locationRoot, variable)).toMatchObject({ home: variable, error: expect.stringContaining('Invalid') })
})

it('flags a launch that leaves the last directory while it still holds Next data or is unreachable', () => {
  const locationRoot = home(), previous = home(), current = home()
  rememberDataDirectory(locationRoot, previous)
  // An empty last directory holds nothing to lose, so there is nothing to ask.
  expect(dataDirectoryChange(locationRoot, current)).toBeUndefined()
  new NextProfiles(previous).ensure('desktop')
  expect(dataDirectoryChange(locationRoot, current)).toEqual({ previous, reachable: true })
  expect(dataDirectoryChange(locationRoot, previous)).toBeUndefined()
  // A recorded directory that is gone now, such as one on a disconnected drive, is still worth asking about.
  rmSync(previous, { recursive: true })
  expect(dataDirectoryChange(locationRoot, current)).toEqual({ previous, reachable: false })
  rememberDataDirectory(locationRoot, current)
  expect(dataDirectoryChange(locationRoot, current)).toBeUndefined()
})

it('answers with the former rule until a launch is recorded, so an upgrade cannot switch directories silently', () => {
  const locationRoot = home(), variable = home(), chosen = home(), former = home()
  // The variable used to move the choice into its own directory.
  writeFileSync(join(variable, 'desktop-next-location.json'), JSON.stringify({ home: former }))
  new NextProfiles(former).ensure('desktop')
  writeFileSync(dataDirectoryLocationFile(locationRoot), JSON.stringify({ home: chosen }))
  const { home: resolved } = readDataDirectory(locationRoot, variable)
  expect(resolved).toBe(chosen)
  expect(dataDirectoryChange(locationRoot, resolved, variable)).toEqual({ previous: former, reachable: true })
  // An unrecorded former directory that cannot be reached is not reported.
  rmSync(former, { recursive: true })
  expect(dataDirectoryChange(locationRoot, resolved, variable)).toBeUndefined()
  // Without the variable, the former rule read the same fixed choice.
  expect(dataDirectoryChange(locationRoot, chosen)).toBeUndefined()
})

it('compares directories through links', () => {
  const directory = home(), other = home()
  expect(sameDirectory(directory, join(directory, '.'))).toBe(true)
  expect(sameDirectory(directory, other)).toBe(false)
  symlinkSync(directory, join(other, 'link'), 'junction')
  expect(sameDirectory(join(other, 'link'), directory)).toBe(true)
})

it('accepts empty or Next directories, rejecting unrelated and nested data directories', () => {
  const original = home(), target = home()
  expect(validateDataDirectory(target, original, original)).toBe(target)
  writeFileSync(join(target, 'unrelated.txt'), 'keep')
  expect(() => validateDataDirectory(target, original, original)).toThrow('empty directory')
  expect(() => validateDataDirectory(join(original, 'nested'), original, original)).toThrow('outside')
  new NextProfiles(target).ensure('desktop')
  expect(validateDataDirectory(target, original, original)).toBe(target)
  expect(validateDataDirectory(original, target, original)).toBe(original)
})
