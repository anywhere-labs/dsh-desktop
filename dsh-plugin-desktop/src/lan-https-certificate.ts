/** Private local CA and short-lived certificates for Desktop LAN HTTPS. */

import {
  X509Certificate,
  createHash,
  createPrivateKey,
  type KeyObject,
} from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { generate } from 'selfsigned'

const STATE_DIRECTORY_NAME = 'lan-https'
const STATE_FILENAME = 'ca.json'
const STATE_VERSION = 1
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const MAX_STATE_BYTES = 128 * 1024
const MAX_ADDRESSES = 64
const CA_COMMON_NAME = 'DeepSeek Harness Desktop Local CA'
const CA_VALIDITY_DAYS = 3650
const LEAF_VALIDITY_DAYS = 30
const RSA_KEY_SIZE = 2048
const SERVER_AUTH_OID = '1.3.6.1.5.5.7.3.1'
const CHECK_POSIX_MODE = process.platform !== 'win32'
const SHA256_WITH_RSA_OID = Buffer.from('06092a864886f70d01010b', 'hex')
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

/** Stable categories callers can map onto ingress and UI states. */
export type DesktopLanHttpsCertificateErrorCode =
  | 'certificate-unavailable'
  | 'certificate-state'
  | 'no-address'
  | 'invalid-address'

/** Stable, non-secret failure surfaced by the LAN HTTPS certificate boundary. */
export class DesktopLanHttpsCertificateError extends Error {
  readonly code: DesktopLanHttpsCertificateErrorCode

  constructor(
    code: DesktopLanHttpsCertificateErrorCode,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DesktopLanHttpsCertificateError'
    this.code = code
  }
}

/** OS-backed protection supplied by the Electron boundary. */
export interface DesktopLanHttpsPrivateKeyProtector {
  readonly available: boolean | (() => boolean | Promise<boolean>)
  readonly seal: (plaintext: Uint8Array) => Uint8Array | Promise<Uint8Array>
  readonly open: (sealed: Uint8Array) => Uint8Array | Promise<Uint8Array>
}

/** HTTPS material for one listener generation. `cert` is leaf-first chain PEM. */
export interface DesktopLanHttpsCertificate {
  readonly key: string
  readonly cert: string
  readonly caCertificate: string
  readonly caFingerprint: string
  readonly addresses: readonly string[]
}

interface PersistedCaStateV1 {
  readonly version: 1
  readonly certificate: string
  readonly sealedPrivateKey: string
}

interface LocalCa {
  readonly certificate: string
  readonly privateKey: string
  readonly x509: X509Certificate
}

function certificateError(
  code: DesktopLanHttpsCertificateErrorCode,
  message: string,
  cause?: unknown,
): DesktopLanHttpsCertificateError {
  return new DesktopLanHttpsCertificateError(
    code,
    `dsh-plugin-desktop: ${message}`,
    cause === undefined ? {} : { cause },
  )
}

/** Exact state path below one Electron userData directory. */
export function desktopLanHttpsCertificateStatePath(userDataDir: string): string {
  if (typeof userDataDir !== 'string' || userDataDir.length === 0
    || /[\0\r\n]/u.test(userDataDir) || !isAbsolute(userDataDir)) {
    throw certificateError(
      'certificate-state',
      'LAN HTTPS userData must be an absolute path without control characters.',
    )
  }
  return join(resolve(userDataDir), STATE_DIRECTORY_NAME, STATE_FILENAME)
}

/**
 * Load or create the installation-local CA, then issue a fresh RSA leaf for
 * the exact canonical IPv4 addresses supplied by the ingress boundary.
 */
export async function createLanHttpsCertificate(
  userDataDir: string,
  addresses: readonly string[],
  protector?: DesktopLanHttpsPrivateKeyProtector,
): Promise<DesktopLanHttpsCertificate> {
  const statePath = desktopLanHttpsCertificateStatePath(userDataDir)
  const validatedAddresses = validateAddresses(addresses)
  const usableProtector = await requireAvailableProtector(protector)
  await prepareStateDirectory(resolve(userDataDir), join(resolve(userDataDir), STATE_DIRECTORY_NAME))

  let ca: LocalCa
  try {
    ca = await withFileLock(statePath, async () => {
      const stateText = await readPrivateStateFile(statePath)
      if (stateText !== undefined) {
        return openPersistedCa(parsePersistedState(stateText), usableProtector)
      }
      const created = await generateCa()
      await persistCa(statePath, created, usableProtector)
      return created
    }, { waitMs: 10_000 })
  } catch (cause) {
    if (cause instanceof DesktopLanHttpsCertificateError) throw cause
    throw certificateError('certificate-state', 'LAN HTTPS CA state could not be accessed safely.', cause)
  }

  const leaf = await generateLeaf(ca, validatedAddresses)
  return Object.freeze({
    key: leaf.privateKey,
    cert: `${leaf.certificate}${ca.certificate}`,
    caCertificate: ca.certificate,
    caFingerprint: createHash('sha256').update(ca.x509.raw).digest('hex'),
    addresses: validatedAddresses,
  })
}

function validateAddresses(addresses: readonly string[]): readonly string[] {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw certificateError('no-address', 'LAN HTTPS needs at least one IPv4 address.')
  }
  if (addresses.length > MAX_ADDRESSES) {
    throw certificateError('invalid-address', `LAN HTTPS accepts at most ${String(MAX_ADDRESSES)} addresses.`)
  }
  const copy = Array.from(addresses)
  for (const address of copy) {
    if (!isCanonicalIpv4(address)) {
      throw certificateError('invalid-address', `LAN HTTPS address is not canonical IPv4: ${String(address)}`)
    }
  }
  return Object.freeze(copy)
}

function isCanonicalIpv4(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return false
    const octet = Number(part)
    return octet >= 0 && octet <= 255
  })
}

async function requireAvailableProtector(
  protector: DesktopLanHttpsPrivateKeyProtector | undefined,
): Promise<DesktopLanHttpsPrivateKeyProtector> {
  if (protector === undefined || typeof protector.seal !== 'function' || typeof protector.open !== 'function') {
    throw certificateError('certificate-unavailable', 'LAN HTTPS private-key protection is unavailable.')
  }
  try {
    const availability = typeof protector.available === 'function'
      ? await protector.available()
      : protector.available
    if (availability !== true) {
      throw certificateError('certificate-unavailable', 'LAN HTTPS private-key protection is unavailable.')
    }
  } catch (cause) {
    if (cause instanceof DesktopLanHttpsCertificateError) throw cause
    throw certificateError('certificate-unavailable', 'LAN HTTPS private-key protection is unavailable.', cause)
  }
  return protector
}

async function prepareStateDirectory(userDataDir: string, stateDirectory: string): Promise<void> {
  try {
    const userDataInfo = await lstat(userDataDir)
    if (!userDataInfo.isDirectory() || userDataInfo.isSymbolicLink()) {
      throw certificateError('certificate-state', 'LAN HTTPS userData must be an ordinary directory.')
    }
    try {
      await mkdir(stateDirectory, { mode: PRIVATE_DIRECTORY_MODE })
      await chmod(stateDirectory, PRIVATE_DIRECTORY_MODE)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    }
    const stateInfo = await lstat(stateDirectory)
    if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink()) {
      throw certificateError('certificate-state', 'LAN HTTPS state directory must be an ordinary directory.')
    }
    if (CHECK_POSIX_MODE && (stateInfo.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
      throw certificateError('certificate-state', 'LAN HTTPS state directory permissions must be 700.')
    }
  } catch (cause) {
    if (cause instanceof DesktopLanHttpsCertificateError) throw cause
    throw certificateError('certificate-state', 'LAN HTTPS state directory is unavailable.', cause)
  }
}

async function readPrivateStateFile(statePath: string): Promise<string | undefined> {
  let pathInfo: Awaited<ReturnType<typeof lstat>>
  try {
    pathInfo = await lstat(statePath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw certificateError('certificate-state', 'LAN HTTPS CA state could not be inspected.', cause)
  }
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state must be an ordinary file.')
  }
  assertPrivateFile(pathInfo.mode, pathInfo.size)

  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(statePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (cause) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state could not be opened safely.', cause)
  }
  try {
    const openedInfo = await handle.stat()
    if (!openedInfo.isFile() || openedInfo.dev !== pathInfo.dev || openedInfo.ino !== pathInfo.ino) {
      throw certificateError('certificate-state', 'LAN HTTPS CA state changed while it was being opened.')
    }
    assertPrivateFile(openedInfo.mode, openedInfo.size)
    const bytes = Buffer.alloc(MAX_STATE_BYTES + 1)
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, null)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > MAX_STATE_BYTES) {
      throw certificateError('certificate-state', `LAN HTTPS CA state exceeds ${String(MAX_STATE_BYTES)} bytes.`)
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))
    } catch (cause) {
      throw certificateError('certificate-state', 'LAN HTTPS CA state must contain valid UTF-8.', cause)
    }
  } finally {
    await handle.close()
  }
}

function assertPrivateFile(mode: number, size: number): void {
  if (size > MAX_STATE_BYTES) {
    throw certificateError('certificate-state', `LAN HTTPS CA state exceeds ${String(MAX_STATE_BYTES)} bytes.`)
  }
  if (CHECK_POSIX_MODE && (mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state permissions must be 600.')
  }
}

function parsePersistedState(text: string): PersistedCaStateV1 {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (cause) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state must contain valid JSON.', cause)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state root must be an object.')
  }
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  if (keys.length !== 3 || keys[0] !== 'certificate'
    || keys[1] !== 'sealedPrivateKey' || keys[2] !== 'version') {
    throw certificateError('certificate-state', 'LAN HTTPS CA state contains unexpected fields.')
  }
  if (object.version !== STATE_VERSION) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state has an unsupported version.')
  }
  if (typeof object.certificate !== 'string') {
    throw certificateError('certificate-state', 'LAN HTTPS CA certificate must be PEM text.')
  }
  if (typeof object.sealedPrivateKey !== 'string' || !isCanonicalBase64(object.sealedPrivateKey)) {
    throw certificateError('certificate-state', 'LAN HTTPS sealed CA private key must be canonical base64.')
  }
  return Object.freeze({
    version: STATE_VERSION,
    certificate: object.certificate,
    sealedPrivateKey: object.sealedPrivateKey,
  })
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length > MAX_STATE_BYTES || value.length % 4 !== 0
    || !BASE64_PATTERN.test(value)) return false
  return Buffer.from(value, 'base64').toString('base64') === value
}

async function openPersistedCa(
  state: PersistedCaStateV1,
  protector: DesktopLanHttpsPrivateKeyProtector,
): Promise<LocalCa> {
  const sealed = Buffer.from(state.sealedPrivateKey, 'base64')
  let opened: Buffer
  try {
    const output = await protector.open(sealed)
    if (!(output instanceof Uint8Array) || output.byteLength === 0 || output.byteLength > MAX_STATE_BYTES) {
      throw new TypeError('protector returned invalid plaintext')
    }
    opened = Buffer.from(output)
  } catch (cause) {
    throw certificateError('certificate-unavailable', 'LAN HTTPS CA private key could not be opened.', cause)
  } finally {
    sealed.fill(0)
  }

  try {
    let privateKey: string
    try {
      privateKey = new TextDecoder('utf-8', { fatal: true }).decode(opened)
    } catch (cause) {
      throw certificateError('certificate-state', 'LAN HTTPS CA private key plaintext is not valid UTF-8.', cause)
    }
    return validateCa(state.certificate, privateKey, true)
  } finally {
    opened.fill(0)
  }
}

async function generateCa(): Promise<LocalCa> {
  const notBeforeDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const notAfterDate = new Date(notBeforeDate.getTime() + CA_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
  try {
    const generated = await generate([{ name: 'commonName', value: CA_COMMON_NAME }], {
      algorithm: 'sha256',
      keyType: 'rsa',
      keySize: RSA_KEY_SIZE,
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      ],
    })
    return validateCa(generated.cert, generated.private)
  } catch (cause) {
    if (cause instanceof DesktopLanHttpsCertificateError) throw cause
    throw certificateError('certificate-unavailable', 'LAN HTTPS local CA could not be generated.', cause)
  }
}

function validateCa(certificate: string, privateKey: string, requireCanonical = false): LocalCa {
  try {
    const x509 = new X509Certificate(certificate)
    const canonicalCertificate = x509.toString()
    const keyObject = createPrivateKey(privateKey)
    const canonicalPrivateKey = exportPrivateKey(keyObject)
    if (requireCanonical && (certificate !== canonicalCertificate || privateKey !== canonicalPrivateKey)) {
      throw new TypeError('CA material is not canonical PEM')
    }
    if (!x509.ca || x509.subject !== `CN=${CA_COMMON_NAME}` || x509.issuer !== x509.subject
      || keyObject.asymmetricKeyType !== 'rsa' || !x509.checkPrivateKey(keyObject)
      || !x509.verify(x509.publicKey) || !usesSha256WithRsa(x509)) {
      throw new TypeError('CA certificate invariants are not satisfied')
    }
    const now = Date.now()
    if (x509.validFromDate.getTime() > now || x509.validToDate.getTime() <= now) {
      throw new TypeError('CA certificate is outside its validity period')
    }
    return Object.freeze({ certificate: canonicalCertificate, privateKey: canonicalPrivateKey, x509 })
  } catch (cause) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state does not contain a valid matching CA keypair.', cause)
  }
}

function exportPrivateKey(key: KeyObject): string {
  const exported = key.export({ type: 'pkcs8', format: 'pem' })
  return typeof exported === 'string' ? exported : exported.toString('utf8')
}

async function persistCa(
  statePath: string,
  ca: LocalCa,
  protector: DesktopLanHttpsPrivateKeyProtector,
): Promise<void> {
  const plaintext = Buffer.from(ca.privateKey, 'utf8')
  let sealed: Buffer
  try {
    const output = await protector.seal(plaintext)
    if (!(output instanceof Uint8Array) || output.byteLength === 0 || output.byteLength > MAX_STATE_BYTES) {
      throw new TypeError('protector returned invalid sealed bytes')
    }
    sealed = Buffer.from(output)
    if (sealed.equals(plaintext) || sealed.includes(Buffer.from('PRIVATE KEY', 'utf8'))) {
      throw new TypeError('protector did not conceal the private key')
    }
  } catch (cause) {
    throw certificateError('certificate-unavailable', 'LAN HTTPS CA private key could not be sealed.', cause)
  } finally {
    plaintext.fill(0)
  }

  try {
    const state: PersistedCaStateV1 = Object.freeze({
      version: STATE_VERSION,
      certificate: ca.certificate,
      sealedPrivateKey: sealed.toString('base64'),
    })
    await writeFileAtomic(statePath, `${JSON.stringify(state, undefined, 2)}\n`, {
      mode: PRIVATE_FILE_MODE,
      dirMode: PRIVATE_DIRECTORY_MODE,
    })
    if (CHECK_POSIX_MODE) await chmod(statePath, PRIVATE_FILE_MODE)
  } catch (cause) {
    throw certificateError('certificate-state', 'LAN HTTPS CA state could not be persisted safely.', cause)
  } finally {
    sealed.fill(0)
  }
}

async function generateLeaf(
  ca: LocalCa,
  addresses: readonly string[],
): Promise<{ readonly privateKey: string, readonly certificate: string }> {
  const primaryAddress = addresses[0]
  if (primaryAddress === undefined) {
    throw certificateError('no-address', 'LAN HTTPS needs at least one IPv4 address.')
  }
  const notBeforeDate = new Date(Date.now() - 5 * 60 * 1000)
  const notAfterDate = new Date(notBeforeDate.getTime() + LEAF_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
  try {
    const generated = await generate([{ name: 'commonName', value: primaryAddress }], {
      algorithm: 'sha256',
      keyType: 'rsa',
      keySize: RSA_KEY_SIZE,
      notBeforeDate,
      notAfterDate,
      ca: { key: ca.privateKey, cert: ca.certificate },
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true, critical: true },
        {
          name: 'subjectAltName',
          critical: true,
          altNames: addresses.map(address => ({ type: 7 as const, ip: address })),
        },
      ],
    })
    const x509 = new X509Certificate(generated.cert)
    const keyObject = createPrivateKey(generated.private)
    const privateKey = exportPrivateKey(keyObject)
    const certificate = x509.toString()
    if (x509.ca || keyObject.asymmetricKeyType !== 'rsa' || !x509.checkPrivateKey(keyObject)
      || !x509.verify(ca.x509.publicKey) || !usesSha256WithRsa(x509)
      || !x509.keyUsage?.includes(SERVER_AUTH_OID)
      || addresses.some(address => x509.checkIP(address) !== address)) {
      throw new TypeError('issued leaf certificate invariants are not satisfied')
    }
    return Object.freeze({ privateKey, certificate })
  } catch (cause) {
    throw certificateError('certificate-unavailable', 'LAN HTTPS server certificate could not be generated.', cause)
  }
}

function usesSha256WithRsa(certificate: X509Certificate): boolean {
  return certificate.raw.indexOf(SHA256_WITH_RSA_OID) >= 0
}

export const desktopLanHttpsCertificateConstants = Object.freeze({
  stateDirectoryName: STATE_DIRECTORY_NAME,
  stateFilename: STATE_FILENAME,
  stateVersion: STATE_VERSION,
  directoryMode: PRIVATE_DIRECTORY_MODE,
  fileMode: PRIVATE_FILE_MODE,
  maxStateBytes: MAX_STATE_BYTES,
  maxAddresses: MAX_ADDRESSES,
  caValidityDays: CA_VALIDITY_DAYS,
  leafValidityDays: LEAF_VALIDITY_DAYS,
  rsaKeySize: RSA_KEY_SIZE,
})
