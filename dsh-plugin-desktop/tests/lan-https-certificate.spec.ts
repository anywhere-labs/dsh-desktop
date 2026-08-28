import { X509Certificate, createHash, createPrivateKey } from 'node:crypto'
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopLanHttpsCertificateError,
  createLanHttpsCertificate,
  desktopLanHttpsCertificateStatePath,
  type DesktopLanHttpsPrivateKeyProtector,
} from '../src/lan-https-certificate.ts'

const temporaryDirectories: string[] = []
const SHA256_WITH_RSA_OID = Buffer.from('06092a864886f70d01010b', 'hex')
const SERVER_AUTH_OID = '1.3.6.1.5.5.7.3.1'

async function temporaryUserData(label = 'dsh-lan-https-'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), label))
  temporaryDirectories.push(directory)
  return directory
}

function reversibleProtector(): DesktopLanHttpsPrivateKeyProtector & {
  readonly seal: ReturnType<typeof vi.fn>
  readonly open: ReturnType<typeof vi.fn>
} {
  return {
    available: true,
    seal: vi.fn((value: Uint8Array) => Buffer.from(value).reverse()),
    open: vi.fn((value: Uint8Array) => Buffer.from(value).reverse()),
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    directory => rm(directory, { recursive: true, force: true }),
  ))
})

describe('Desktop LAN HTTPS certificates', () => {
  it('persists one protected private CA with private filesystem permissions', async () => {
    const userData = await temporaryUserData()
    const protector = reversibleProtector()
    const inputAddresses = ['127.0.0.1', '192.168.1.24']

    const first = await createLanHttpsCertificate(userData, inputAddresses, protector)
    inputAddresses[1] = '10.0.0.1'
    const second = await createLanHttpsCertificate(userData, ['127.0.0.1'], protector)
    const statePath = desktopLanHttpsCertificateStatePath(userData)
    const stateText = await readFile(statePath, 'utf8')
    const state = JSON.parse(stateText) as Record<string, unknown>

    expect(first.caCertificate).toBe(second.caCertificate)
    expect(first.caFingerprint).toBe(second.caFingerprint)
    expect(first.key).not.toBe(second.key)
    expect(first.cert).not.toBe(second.cert)
    expect(first.addresses).toEqual(['127.0.0.1', '192.168.1.24'])
    expect(Object.isFrozen(first.addresses)).toBe(true)
    expect(first.addresses).not.toBe(inputAddresses)
    expect(protector.seal).toHaveBeenCalledTimes(1)
    expect(protector.open).toHaveBeenCalledTimes(1)
    expect(Object.keys(state).sort()).toEqual(['certificate', 'sealedPrivateKey', 'version'])
    expect(state.version).toBe(1)
    expect(state.certificate).toBe(first.caCertificate)
    expect(stateText).not.toContain('PRIVATE KEY')
    expect(await readdir(dirname(statePath))).toEqual(['ca.json'])
    if (process.platform !== 'win32') {
      expect((await lstat(dirname(statePath))).mode & 0o777).toBe(0o700)
      expect((await lstat(statePath)).mode & 0o777).toBe(0o600)
    }
  })

  it('issues a short-lived SHA-256 RSA server certificate with exact IP SANs and CA chain', async () => {
    const userData = await temporaryUserData()
    const result = await createLanHttpsCertificate(
      userData,
      ['127.0.0.1', '192.168.50.7', '10.8.0.2'],
      reversibleProtector(),
    )
    const leaf = new X509Certificate(result.cert)
    const ca = new X509Certificate(result.caCertificate)
    const leafKey = createPrivateKey(result.key)

    expect(result.cert.match(/-----BEGIN CERTIFICATE-----/gu)).toHaveLength(2)
    expect(ca.ca).toBe(true)
    expect(ca.verify(ca.publicKey)).toBe(true)
    expect(leaf.ca).toBe(false)
    expect(leaf.verify(ca.publicKey)).toBe(true)
    expect(leaf.checkPrivateKey(leafKey)).toBe(true)
    expect(leafKey.asymmetricKeyType).toBe('rsa')
    expect(leaf.keyUsage).toContain(SERVER_AUTH_OID)
    expect(leaf.raw.indexOf(SHA256_WITH_RSA_OID)).toBeGreaterThanOrEqual(0)
    expect(ca.raw.indexOf(SHA256_WITH_RSA_OID)).toBeGreaterThanOrEqual(0)
    expect(leaf.checkIP('127.0.0.1')).toBe('127.0.0.1')
    expect(leaf.checkIP('192.168.50.7')).toBe('192.168.50.7')
    expect(leaf.checkIP('10.8.0.2')).toBe('10.8.0.2')
    expect(leaf.checkIP('10.8.0.3')).toBeUndefined()
    expect(leaf.validToDate.getTime() - leaf.validFromDate.getTime())
      .toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000)
    expect(result.caFingerprint).toBe(createHash('sha256').update(ca.raw).digest('hex'))
  })

  it('returns stable input and protector availability failures without writing state', async () => {
    const userData = await temporaryUserData()
    const unavailable: DesktopLanHttpsPrivateKeyProtector = {
      available: false,
      seal: value => value,
      open: value => value,
    }

    await expect(createLanHttpsCertificate(userData, ['127.0.0.1']))
      .rejects.toMatchObject({ name: 'DesktopLanHttpsCertificateError', code: 'certificate-unavailable' })
    await expect(createLanHttpsCertificate(userData, ['127.0.0.1'], unavailable))
      .rejects.toMatchObject({ code: 'certificate-unavailable' })
    await expect(createLanHttpsCertificate(userData, [], unavailable))
      .rejects.toMatchObject({ code: 'no-address' })
    await expect(createLanHttpsCertificate(userData, ['127.00.0.1'], unavailable))
      .rejects.toMatchObject({ code: 'invalid-address' })
    await expect(createLanHttpsCertificate('relative/user-data', ['127.0.0.1'], unavailable))
      .rejects.toMatchObject({ code: 'certificate-state' })
    await expect(lstat(join(userData, 'lan-https'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects malformed, publicly readable, and linked CA state', async () => {
    const userData = await temporaryUserData()
    const protector = reversibleProtector()
    await createLanHttpsCertificate(userData, ['127.0.0.1'], protector)
    const statePath = desktopLanHttpsCertificateStatePath(userData)

    if (process.platform !== 'win32') {
      await chmod(statePath, 0o644)
      await expect(createLanHttpsCertificate(userData, ['127.0.0.1'], protector))
        .rejects.toMatchObject({ code: 'certificate-state' })
      await chmod(statePath, 0o600)
    }

    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>
    parsed.unexpected = true
    await writeFile(statePath, `${JSON.stringify(parsed)}\n`, { mode: 0o600 })
    await expect(createLanHttpsCertificate(userData, ['127.0.0.1'], protector))
      .rejects.toMatchObject({ code: 'certificate-state' })

    const linkedUserData = await temporaryUserData('dsh-lan-https-linked-')
    const outside = await temporaryUserData('dsh-lan-https-outside-')
    await symlink(outside, join(linkedUserData, 'lan-https'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(createLanHttpsCertificate(linkedUserData, ['127.0.0.1'], reversibleProtector()))
      .rejects.toMatchObject({ code: 'certificate-state' })
    expect(await readdir(outside)).toEqual([])
  })

  it('classifies protector operation failures without exposing their message as the code', async () => {
    const userData = await temporaryUserData()
    const protector: DesktopLanHttpsPrivateKeyProtector = {
      available: async () => true,
      seal: () => { throw new Error('keychain is locked') },
      open: value => value,
    }

    try {
      await createLanHttpsCertificate(userData, ['127.0.0.1'], protector)
      throw new Error('expected certificate generation to fail')
    } catch (cause) {
      expect(cause).toBeInstanceOf(DesktopLanHttpsCertificateError)
      expect(cause).toMatchObject({ code: 'certificate-unavailable' })
    }
  })
})
