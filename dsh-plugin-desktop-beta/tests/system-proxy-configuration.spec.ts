import { expect, it, vi } from 'vitest'
import { parseScutilProxy, readSystemProxyConfiguration } from '../src/system-proxy-configuration.ts'

/** `scutil --proxy` output: one dictionary whose own keys are indented by two spaces. */
const dictionary = (...lines: string[]): string => `<dictionary> {\n${lines.map(line => `  ${line}\n`).join('')}}\n`
const DIRECT = dictionary('ExceptionsList : <array> {', '  0 : localhost', '  1 : 127.0.0.0/8', '  2 : ::1', '}',
  'HTTPEnable : 0', 'HTTPSEnable : 0', 'SOCKSEnable : 0')

it('reads a dictionary whose proxy switches are all off as no proxy', () => {
  expect(parseScutilProxy(DIRECT)).toBe('none')
  expect(parseScutilProxy(dictionary())).toBe('none')
})

it('reads any switch that can route HTTP or HTTPS as a configuration', () => {
  for (const key of ['HTTPEnable', 'HTTPSEnable', 'SOCKSEnable', 'ProxyAutoConfigEnable', 'ProxyAutoDiscoveryEnable']) {
    expect(parseScutilProxy(dictionary('HTTPEnable : 0', `${key} : 1`))).toBe('configured')
  }
  expect(parseScutilProxy(dictionary('HTTPEnable : 1', 'HTTPPort : 7897', 'HTTPProxy : 127.0.0.1'))).toBe('configured')
})

it('ignores switches of per-interface scoped dictionaries, as Chromium does', () => {
  expect(parseScutilProxy(dictionary('HTTPEnable : 0', '__SCOPED__ : <dictionary> {', '  en0 : <dictionary> {',
    '    HTTPEnable : 1', '  }', '}'))).toBe('none')
})

it('answers unknown for output it cannot read', () => {
  expect(parseScutilProxy('')).toBe('unknown')
  expect(parseScutilProxy('No proxies\n')).toBe('unknown')
})

it('asks scutil on macOS only and never rejects', async () => {
  const run = vi.fn(async () => DIRECT)
  await expect(readSystemProxyConfiguration('darwin', run)).resolves.toBe('none')
  expect(run).toHaveBeenCalledExactlyOnceWith('/usr/sbin/scutil', ['--proxy'])

  run.mockClear()
  for (const platform of ['win32', 'linux'] as const) await expect(readSystemProxyConfiguration(platform, run)).resolves.toBe('unknown')
  expect(run).not.toHaveBeenCalled()

  await expect(readSystemProxyConfiguration('darwin', async () => { throw new Error('timed out') })).resolves.toBe('unknown')
})
