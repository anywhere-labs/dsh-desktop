import { expect, it } from 'vitest'
import { DESKTOP_ARCH_HEADER, macUpdateArch, withUpdateArch } from '../src/update-arch.ts'

it('asks for the hardware CPU, so a build Rosetta translates updates to the Apple silicon build', () => {
  expect(macUpdateArch('arm64', false)).toBe('arm64')
  expect(macUpdateArch('x64', false)).toBe('x64')
  expect(macUpdateArch('x64', true)).toBe('arm64')
  expect(macUpdateArch('ia32', false)).toBeUndefined()
})

it('adds the CPU header beside the headers a request already carries without changing them', () => {
  const init: RequestInit = { method: 'GET', headers: { 'X-DSH-Desktop-Channel': 'next' }, cache: 'no-store' }
  const named = withUpdateArch(init, 'arm64')
  const headers = new Headers(named.headers)
  expect(headers.get(DESKTOP_ARCH_HEADER)).toBe('arm64')
  expect(headers.get('X-DSH-Desktop-Channel')).toBe('next')
  expect(named).toMatchObject({ method: 'GET', cache: 'no-store' })
  expect(init.headers).toEqual({ 'X-DSH-Desktop-Channel': 'next' })
})
