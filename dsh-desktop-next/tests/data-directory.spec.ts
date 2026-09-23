import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readDataDirectory, validateDataDirectory } from '../src/data-directory.ts'
import { NextProfiles } from '../src/profiles.ts'

const homes: string[] = []
function home() { const path = mkdtempSync(join(tmpdir(), 'next-data-directory-')); homes.push(path); return path }
afterEach(() => homes.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

it('retains a chosen data location across launches and reports malformed location files for recovery', () => {
  const original = home(), selected = home()
  expect(readDataDirectory(original)).toEqual({ home: original })
  writeFileSync(join(original, 'desktop-next-location.json'), JSON.stringify({ home: selected }))
  expect(readDataDirectory(original)).toEqual({ home: selected })
  writeFileSync(join(original, 'desktop-next-location.json'), '{broken')
  expect(readDataDirectory(original)).toMatchObject({ home: original, error: expect.any(String) })
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
