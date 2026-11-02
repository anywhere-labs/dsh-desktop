import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readMachOArchitectures } from '../src/mach-o.ts'
import { assertMacBundleArch, DESKTOP_ARCH_HEADER, macUpdateArch, UpdateArchError, withUpdateArch } from '../src/update-arch.ts'

const ARM64 = Buffer.from('cffaedfe0c000001000000000200000000000000', 'hex')
const X64 = Buffer.from('cffaedfe07000001000000000200000000000000', 'hex')
const UNIVERSAL = Buffer.concat([Buffer.from('cafebabe00000002', 'hex'),
  Buffer.from('0100000700000003000010000000100000000000', 'hex'), Buffer.from('0100000c00000000000020000000100000000000', 'hex')])

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

/** An application bundle with a main executable of the given slices and interpreter payloads for the given CPUs. */
async function bundle(executable: Buffer, runtimes: readonly string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'next-update-arch-')); roots.push(root)
  const app = join(root, 'DSH Desktop Beta.app')
  await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(app, 'Contents', 'MacOS', 'DSH Desktop Beta'), executable)
  for (const arch of runtimes) await mkdir(join(app, 'Contents', 'Resources', 'runtime', arch, 'primary-runtime'), { recursive: true })
  return app
}

it('asks for the hardware CPU, so a build Rosetta translates updates to the Apple silicon build', () => {
  expect(macUpdateArch('arm64', false)).toBe('arm64')
  expect(macUpdateArch('x64', false)).toBe('x64')
  expect(macUpdateArch('x64', true)).toBe('arm64')
  expect(macUpdateArch('ia32', false)).toBeUndefined()
})

it('adds the CPU header beside the headers a request already carries without changing them', () => {
  const init: RequestInit = { method: 'GET', headers: { 'X-DSH-Desktop-Channel': 'beta' }, cache: 'no-store' }
  const named = withUpdateArch(init, 'arm64')
  const headers = new Headers(named.headers)
  expect(headers.get(DESKTOP_ARCH_HEADER)).toBe('arm64')
  expect(headers.get('X-DSH-Desktop-Channel')).toBe('beta')
  expect(named).toMatchObject({ method: 'GET', cache: 'no-store' })
  expect(init.headers).toEqual({ 'X-DSH-Desktop-Channel': 'beta' })
})

it('reads the slices of a main executable without the developer tools', async () => {
  const app = await bundle(UNIVERSAL, ['arm64', 'x64'])
  expect(await readMachOArchitectures(join(app, 'Contents', 'MacOS', 'DSH Desktop Beta'))).toEqual(['x64', 'arm64'])
})

it('accepts an application for this CPU, or the universal one, and refuses one built for the other CPU', async () => {
  await expect(assertMacBundleArch(await bundle(ARM64, ['arm64']), 'DSH Desktop Beta', 'arm64')).resolves.toBeUndefined()
  await expect(assertMacBundleArch(await bundle(X64, ['x64']), 'DSH Desktop Beta', 'x64')).resolves.toBeUndefined()
  const universal = await bundle(UNIVERSAL, ['arm64', 'x64'])
  for (const arch of ['arm64', 'x64'] as const) await expect(assertMacBundleArch(universal, 'DSH Desktop Beta', arch)).resolves.toBeUndefined()
  await expect(assertMacBundleArch(await bundle(X64, ['x64']), 'DSH Desktop Beta', 'arm64')).rejects.toThrow(UpdateArchError)
  await expect(assertMacBundleArch(await bundle(ARM64, ['arm64']), 'DSH Desktop Beta', 'x64')).rejects.toThrow('runs on arm64, not on')
  await expect(assertMacBundleArch(await bundle(Buffer.from('#!/bin/sh\n'), ['arm64']), 'DSH Desktop Beta', 'arm64')).rejects.toThrow('no known CPU')
})

it('refuses an application whose executable matches but whose interpreter payload is for the other CPU', async () => {
  await expect(assertMacBundleArch(await bundle(UNIVERSAL, ['x64']), 'DSH Desktop Beta', 'arm64')).rejects.toThrow('carries no arm64 runtime')
})

it('refuses an executable name that leaves Contents/MacOS', async () => {
  const app = await bundle(ARM64, ['arm64'])
  for (const name of ['', '.', '..', '../Resources/app', 'a\0b']) {
    await expect(assertMacBundleArch(app, name, 'arm64')).rejects.toThrow('invalid main executable')
  }
})
