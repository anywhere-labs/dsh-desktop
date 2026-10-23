import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { assertMacRuntimeSignature, runtimeEntitlements, signMacRuntime, TIMESTAMP_ATTEMPTS, UPSTREAM_DESKTOP_SCRIPTS, withMacSigningIdentity, type MacRuntimeSigningIdentity } from '../scripts/sign-runtime.ts'

const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'next-signing-'))
  roots.push(path)
  return path
}
const identity: MacRuntimeSigningIdentity = { identity: 'Developer ID Application: Example (TEAMID1234)' }
const machO = Buffer.from('cffaedfe0c00000100000000', 'hex')
function tools() {
  return { sign: vi.fn<(file: string, identifier: string, identity: MacRuntimeSigningIdentity, entitlements: string | undefined) => Promise<void>>(async () => {}), verify: vi.fn() }
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

it('signs Mach-O files in their final locations and verifies each signature', async () => {
  const path = root()
  writeFileSync(join(path, 'addon.node'), machO)
  writeFileSync(join(path, 'source.py'), 'print()\n')
  const t = tools()
  await expect(signMacRuntime(path, 'com.example.app', identity, 'arm64', t)).resolves.toBe(1)
  expect(t.sign).toHaveBeenCalledWith(join(path, 'addon.node'), expect.stringMatching(/^com\.example\.app\.runtime\.[a-f0-9]{64}$/u), identity, undefined)
  expect(t.verify).toHaveBeenCalledWith(join(path, 'addon.node'), identity)
  expect(t.sign).toHaveBeenCalledTimes(1)
})

// File symlinks in these macOS fixtures require privileges unavailable to ordinary Windows processes.
it.skipIf(process.platform === 'win32')('signs a shared Python interpreter once and retains both executable aliases', async () => {
  const path = root()
  const bin = join(path, 'dependencies/python/bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(path, 'runtime.json'), JSON.stringify({ desktopVersion: '1', platform: 'darwin', arch: 'arm64', python: '3.12.14', pythonPackages: {} }))
  writeFileSync(join(bin, 'python3.12'), machO)
  for (const name of ['python', 'python3']) symlinkSync('python3.12', join(bin, name))
  const t = tools()
  await expect(signMacRuntime(path, 'com.example.app', identity, 'arm64', t)).resolves.toBe(1)
  expect(t.sign).toHaveBeenCalledExactlyOnceWith(join(bin, 'python3.12'), expect.any(String), identity, undefined)
  for (const name of ['python', 'python3']) expect(readlinkSync(join(bin, name))).toBe('python3.12')
})

// The signer must inspect real file symlinks, including dangling and cyclic ones.
it.skipIf(process.platform === 'win32').each(['unknown', 'absolute', 'escaping', 'dangling', 'chained', 'directory'])('rejects a %s runtime link before signing any file', async (kind) => {
  const path = root()
  const bin = join(path, 'dependencies/python/bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(path, 'runtime.json'), JSON.stringify({ desktopVersion: '1', platform: 'darwin', arch: 'arm64', python: '3.12.14', pythonPackages: {} }))
  const canonical = join(bin, 'python3.12')
  if (kind === 'directory') mkdirSync(canonical)
  else if (kind !== 'dangling') writeFileSync(canonical, machO)
  if (kind === 'chained') {
    rmSync(canonical)
    symlinkSync('python3', canonical)
  }
  const target = kind === 'absolute' ? canonical : kind === 'escaping' ? '../outside' : 'python3.12'
  symlinkSync(target, join(bin, kind === 'unknown' ? 'unlisted' : 'python3'))
  const t = tools()
  const result = signMacRuntime(path, 'com.example.app', identity, 'arm64', t)
  if (kind === 'dangling') await expect(result).rejects.toMatchObject({ code: 'ENOENT', path: canonical })
  else await expect(result).rejects.toThrow(kind === 'unknown' ? 'must not contain links' : 'invalid Python alias')
  expect(t.sign).not.toHaveBeenCalled()
})

it('awaits other signers before rejecting and permitting output cleanup', async () => {
  const path = root()
  for (const name of ['a.node', 'b.node']) writeFileSync(join(path, name), machO)
  let release!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  let started!: () => void
  const ready = new Promise<void>((resolve) => { started = resolve })
  const t = tools()
  t.sign.mockImplementation(async (file) => {
    if (file.endsWith('a.node')) throw new Error('sign failure')
    started()
    await barrier
  })
  let completed = false
  const result = signMacRuntime(path, 'com.example.app', identity, 'arm64', t).catch((error: unknown) => { completed = true; return error })
  try {
    await ready
    expect(completed).toBe(false)
  } finally { release() }
  expect(await result).toBeInstanceOf(AggregateError)
  expect(t.verify).toHaveBeenCalledWith(join(path, 'b.node'), identity)
})

it('asks the timestamp service again when a signature comes back without its timestamp', async () => {
  const path = root()
  for (const name of ['a.node', 'b.node']) writeFileSync(join(path, name), machO)
  const t = { ...tools(), pause: vi.fn(async () => {}) }
  let dropped = false
  t.sign.mockImplementation(async (file) => {
    if (file.endsWith('a.node') && !dropped) {
      dropped = true
      throw new Error(`Next runtime signing: codesign exited with 1 for ${file}: A timestamp was expected but was not found.`)
    }
  })
  await expect(signMacRuntime(path, 'com.example.app', identity, 'arm64', t)).resolves.toBe(2)
  expect(t.sign).toHaveBeenCalledTimes(3)
  expect(t.pause).toHaveBeenCalledWith(1)
  expect(t.verify).toHaveBeenCalledWith(join(path, 'a.node'), identity)
  expect(t.verify).toHaveBeenCalledWith(join(path, 'b.node'), identity)
})

it('gives a timestamp three attempts and other codesign failures one', async () => {
  const path = root()
  writeFileSync(join(path, 'a.node'), machO)
  const timestamps = { ...tools(), pause: vi.fn(async () => {}) }
  timestamps.sign.mockRejectedValue(new Error('The timestamp service is not available.'))
  await expect(signMacRuntime(path, 'com.example.app', identity, 'arm64', timestamps)).rejects.toThrow('native signing failed')
  expect(timestamps.sign).toHaveBeenCalledTimes(TIMESTAMP_ATTEMPTS)
  expect(timestamps.pause).toHaveBeenCalledTimes(TIMESTAMP_ATTEMPTS - 1)
  expect(timestamps.verify).not.toHaveBeenCalled()
  const other = { ...tools(), pause: vi.fn(async () => {}) }
  other.sign.mockRejectedValue(new Error('sign failure'))
  await expect(signMacRuntime(path, 'com.example.app', identity, 'arm64', other)).rejects.toThrow('native signing failed')
  expect(other.sign).toHaveBeenCalledTimes(1)
  expect(other.pause).not.toHaveBeenCalled()
})

it.each(['arm64', 'x64'] as const)('gives only the standalone Node %s entitlements and signs Python without any', async (arch) => {
  const path = root()
  const node = join(path, 'dependencies/node/bin/node')
  const python = join(path, 'dependencies/python/bin/python3.12')
  const extension = join(path, 'dependencies/python/lib/python3.12/lib-dynload/_ssl.cpython-312-darwin.so')
  for (const file of [node, python, extension]) {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, machO)
  }
  const t = tools()
  await expect(signMacRuntime(path, 'com.example.app', identity, arch, t)).resolves.toBe(3)
  const nodePlist = join(UPSTREAM_DESKTOP_SCRIPTS, arch === 'x64' ? 'node-x64-entitlements.plist' : 'jit-entitlements.plist')
  expect(runtimeEntitlements('dependencies/node/bin/node', arch)).toBe(nodePlist)
  expect(t.sign).toHaveBeenCalledWith(node, expect.any(String), identity, nodePlist)
  const xml = readFileSync(nodePlist, 'utf8')
  expect(xml).toMatch(/<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/u)
  expect(/<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>\s*<true\s*\/>/u.test(xml)).toBe(arch === 'x64')
  for (const file of [python, extension]) expect(t.sign).toHaveBeenCalledWith(file, expect.any(String), identity, undefined)
})

it('rejects a payload containing links instead of signing through them', async () => {
  const path = root()
  writeFileSync(join(path, 'real.node'), machO)
  symlinkSync(join(path, 'real.node'), join(path, 'alias.node'))
  await expect(signMacRuntime(path, 'com.example.app', identity, 'arm64', tools())).rejects.toThrow('must not contain links')
})

it('requires the release authority, team, timestamp and hardened runtime in signature details', () => {
  const details = ['Executable=/payload/python3', 'Identifier=com.example.app.runtime.abc', 'flags=0x10000(runtime)', 'Timestamp=Oct 13, 2026 at 12:00:00',
    'Authority=Developer ID Application: Example (TEAMID1234)', 'Authority=Developer ID Certification Authority', 'TeamIdentifier=TEAMID1234'].join('\n')
  expect(() => { assertMacRuntimeSignature(details, identity) }).not.toThrow()
  expect(() => { assertMacRuntimeSignature(details.replace('TeamIdentifier=TEAMID1234', 'TeamIdentifier=OTHER56789'), identity) }).toThrow('TeamIdentifier=TEAMID1234')
  expect(() => { assertMacRuntimeSignature(details.replace('Authority=Developer ID Application: Example (TEAMID1234)', 'Authority=Apple Development: Someone'), identity) }).toThrow('Authority=')
  expect(() => { assertMacRuntimeSignature(details.replace('flags=0x10000(runtime)', 'flags=0x0(none)'), identity) }).toThrow('hardened runtime')
  expect(() => { assertMacRuntimeSignature(details.replace(/Timestamp=[^\n]*\n/u, ''), identity) }).toThrow('timestamp')
})

it('uses a login keychain identity as is and owns a temporary keychain for a PKCS#12 certificate', async () => {
  const run = vi.fn<(command: string, args: readonly string[]) => string>((command, args) =>
    command === '/usr/bin/security' && args[0] === 'list-keychains' && args.length === 3 ? '    "/Users/me/Library/Keychains/login.keychain-db"\n' : '')
  await expect(withMacSigningIdentity({}, identity.identity, async signer => signer, run)).resolves.toEqual({ identity: identity.identity })
  expect(run).not.toHaveBeenCalled()
  await expect(withMacSigningIdentity({ CSC_LINK: '/certificates/release.p12', CSC_KEY_PASSWORD: 'secret' }, identity.identity, async signer => signer, run))
    .rejects.toThrow('PKCS#12 data URL')
  const environment = { CSC_LINK: `data:application/x-pkcs12;base64,${Buffer.from('0\u0082').toString('base64')}`, CSC_KEY_PASSWORD: 'secret' }
  const signer = await withMacSigningIdentity(environment, identity.identity, async signer => signer, run)
  expect(signer.identity).toBe(identity.identity)
  expect(signer.keychain).toMatch(/signing\.keychain-db$/u)
  expect(run.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
    ['/usr/bin/security', 'create-keychain'], ['/usr/bin/security', 'unlock-keychain'], ['/usr/bin/security', 'set-keychain-settings'],
    ['/usr/bin/security', 'import'], ['/usr/bin/security', 'set-key-partition-list'], ['/usr/bin/security', 'list-keychains'],
    ['/usr/bin/security', 'list-keychains'], ['/bin/cp', '/usr/bin/true'], ['/usr/bin/codesign', '--force'], ['/usr/bin/codesign', '--verify'],
    ['/usr/bin/security', 'list-keychains'], ['/usr/bin/security', 'delete-keychain'],
  ])
  const search = run.mock.calls.filter(([, args]) => args[0] === 'list-keychains' && args[3] === '-s').map(([, args]) => [...args])
  expect(search).toEqual([
    ['list-keychains', '-d', 'user', '-s', signer.keychain, '/Users/me/Library/Keychains/login.keychain-db'],
    ['list-keychains', '-d', 'user', '-s', '/Users/me/Library/Keychains/login.keychain-db'],
  ])
  expect(run).toHaveBeenCalledWith('/usr/bin/codesign', ['--force', '--sign', identity.identity, '--keychain', signer.keychain, '--timestamp', '--options', 'runtime', expect.stringMatching(/probe$/u)])
})
