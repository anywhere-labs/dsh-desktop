/** Sign the bundled interpreter payloads before electron-builder signs the enclosing application; ported from upstream Desktop. */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { primaryRuntimePythonAliases, readPrimaryRuntime } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { isMachO } from './primary-runtime.ts'

/** The pinned upstream checkout owns the entitlement files the payload executables receive. */
export const UPSTREAM_DESKTOP_SCRIPTS = resolve(import.meta.dirname, '..', '..', 'deepseek-harness', 'apps', 'desktop', 'scripts')

/** A Developer ID Application identity as `security find-identity` prints it, and the keychain holding its key when that is not on the login search list. */
export interface MacRuntimeSigningIdentity {
  readonly identity: string
  readonly keychain?: string
}

/** Signs one file in place. */
export type SignRuntimeCode = (file: string, identifier: string, identity: MacRuntimeSigningIdentity, entitlements: string | undefined) => Promise<void>
/** Verifies one signed file. */
export type VerifyRuntimeCode = (file: string, identity: MacRuntimeSigningIdentity) => void

/**
 * Entitlements one payload file needs. The standalone Node runs V8 and needs JIT; its x64 build also
 * maps executable memory without signatures, including under Rosetta. Python and its extension
 * modules run without entitlements, as upstream Desktop signs them. The Office helper beside the
 * archive is signed by electron-builder with the inherited application entitlements.
 * @param path - Payload-relative POSIX path.
 * @param arch - Payload CPU.
 * @returns Entitlement plist, or undefined for a hardened-runtime signature without entitlements.
 */
export function runtimeEntitlements(path: string, arch: 'arm64' | 'x64'): string | undefined {
  if (path !== 'dependencies/node/bin/node') return undefined
  return join(UPSTREAM_DESKTOP_SCRIPTS, arch === 'x64' ? 'node-x64-entitlements.plist' : 'jit-entitlements.plist')
}

async function listFiles(root: string): Promise<string[]> {
  let hasManifest = false
  try { hasManifest = lstatSync(join(root, 'runtime.json')).isFile() } catch { /* fixtures without runtime.json */ }
  const aliases = hasManifest ? await primaryRuntimePythonAliases(root, await readPrimaryRuntime(root)) : new Map<string, string>()
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`
      if (entry.isSymbolicLink()) {
        if (aliases.has(path)) continue
        throw new Error(`Next runtime signing: the payload must not contain links: ${path}`)
      }
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  visit('')
  return files
}

/** Attempts for one signature whose secure timestamp request fails; every signature asks Apple's timestamp service. */
export const TIMESTAMP_ATTEMPTS = 3

/**
 * Whether codesign reported a secure timestamp it could not obtain rather than a signature it could not make.
 * @param error - Failure of one signature.
 * @returns True for the timestamp service's failures; a payload path naming a timestamp only retries a failure.
 */
export function isTimestampFailure(error: unknown): boolean {
  return error instanceof Error && /timestamp/iu.test(error.message)
}

/** Wait before asking the timestamp service again. */
const timestampBackoff = (attempt: number): Promise<void> => new Promise(resolve => setTimeout(resolve, 2_000 * attempt))

/**
 * Sign and verify every Mach-O file of one payload in place, awaiting all signers on failure.
 * @param root - Self-contained payload without symlinks other than validated Python aliases.
 * @param appId - Release application identifier.
 * @param identity - Required signing identity.
 * @param arch - Payload CPU, independent of the signing host.
 * @param tools - Injectable signer and verifier, and the wait between timestamp attempts.
 * @returns Number of signed native files.
 */
export async function signMacRuntime(
  root: string, appId: string, identity: MacRuntimeSigningIdentity, arch: 'arm64' | 'x64',
  tools: { readonly sign: SignRuntimeCode; readonly verify: VerifyRuntimeCode; readonly pause?: (attempt: number) => Promise<void> }
    = { sign: signMacOSRuntimeCode, verify: verifyMacOSRuntimeCode },
): Promise<number> {
  const files = (await listFiles(root)).filter(path => isMachO(join(root, path)))
  const pause = tools.pause ?? timestampBackoff
  let next = 0
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    for (;;) {
      const path = files[next++]
      if (path === undefined) return
      const file = join(root, path)
      const identifier = `${appId}.runtime.${createHash('sha256').update(path).digest('hex')}`
      const entitlements = runtimeEntitlements(path, arch)
      // The secure timestamp comes from Apple's service on every signature; a request it drops is made again.
      for (let attempt = 1; ; attempt++) {
        try {
          await tools.sign(file, identifier, identity, entitlements)
          break
        } catch (error) {
          if (attempt >= TIMESTAMP_ATTEMPTS || !isTimestampFailure(error)) throw error
          await pause(attempt)
        }
      }
      tools.verify(file, identity)
    }
  })
  const results = await Promise.allSettled(workers)
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
  if (errors.length > 0) throw new AggregateError(errors, 'Next runtime: native signing failed')
  return files.length
}

/** Run codesign and return both streams: `--display` reports on stderr. */
function runCodesign(args: readonly string[]): string {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) throw new Error(`Next runtime signing: could not execute codesign: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`Next runtime signing: codesign ${args[0] ?? ''} ${result.signal ?? `exited with ${String(result.status)}`}: ${`${result.stdout}${result.stderr}`.trim()}`)
  }
  return `${result.stdout}${result.stderr}`
}

/**
 * Sign one Mach-O file with a hardened-runtime, timestamped signature.
 * @param file - Writable standalone Mach-O file.
 * @param identifier - Stable code-signing identifier derived from the release app ID and the payload path.
 * @param identity - Release identity and optional keychain.
 * @param entitlements - Optional entitlement plist for this executable.
 * @returns Resolves after codesign exits successfully.
 */
export function signMacOSRuntimeCode(file: string, identifier: string, identity: MacRuntimeSigningIdentity, entitlements: string | undefined): Promise<void> {
  const args = ['--force', '--sign', identity.identity, ...(identity.keychain === undefined ? [] : ['--keychain', identity.keychain]),
    '--identifier', identifier, '--timestamp', '--options', 'runtime', ...(entitlements === undefined ? [] : ['--entitlements', entitlements]), file]
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/usr/bin/codesign', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk })
    child.stderr.on('data', (chunk: string) => { output += chunk })
    child.once('error', error => { reject(new Error(`Next runtime signing: could not execute codesign: ${error.message}`)) })
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Next runtime signing: codesign ${signal ?? `exited with ${String(code)}`} for ${file}${output.trim() === '' ? '' : `: ${output.trim()}`}`))
    })
  })
}

/**
 * Require the signature properties Apple validates for executable runtime content.
 * @param details - Output from `codesign --display --verbose=4`.
 * @param identity - Release identity.
 */
export function assertMacRuntimeSignature(details: string, identity: MacRuntimeSigningIdentity): void {
  const lines = details.split(/\r?\n/u).map(line => line.trim())
  const team = /\(([A-Z0-9]{10})\)\s*$/u.exec(identity.identity)?.[1]
  const expected = [`Authority=${identity.identity}`, ...(team === undefined ? [] : [`TeamIdentifier=${team}`])]
  const missing = expected.filter(field => !lines.includes(field))
  if (missing.length > 0) throw new Error(`Next runtime signing: signature does not match the release identity; missing ${missing.join(', ')}`)
  if (!lines.some(line => /^Timestamp=.+/u.test(line))) throw new Error('Next runtime signing: runtime signature has no secure timestamp')
  if (!lines.some(line => /\bflags=0x[0-9a-f]+\(runtime\)(?:\s|$)/iu.test(line))) throw new Error('Next runtime signing: runtime signature does not enable hardened runtime')
}

/**
 * Verify one signed payload file.
 * @param file - Mach-O file to inspect.
 * @param identity - Release identity.
 */
export function verifyMacOSRuntimeCode(file: string, identity: MacRuntimeSigningIdentity): void {
  runCodesign(['--verify', '--strict', '--verbose=2', file])
  assertMacRuntimeSignature(runCodesign(['--display', '--verbose=4', file]), identity)
}

/**
 * Read the entitlements a signed file carries.
 * @param file - Signed file.
 * @returns Entitlement keys and values; empty for a signature without entitlements.
 */
export function readSignedEntitlements(file: string): Record<string, unknown> {
  const result = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error !== undefined) throw new Error(`Next runtime signing: could not execute codesign: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Next runtime signing: codesign -d ${result.signal ?? `exited with ${String(result.status)}`}: ${result.stderr.trim()}`)
  if (result.stdout.trim() === '') return {}
  return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: result.stdout, encoding: 'utf8' })) as Record<string, unknown>
}

const P12_DATA_PREFIX = 'data:application/x-pkcs12;base64,'

/** Executes one credential-bearing Apple command and returns its standard output. */
export type RunAppleCommand = (command: string, args: readonly string[]) => string

const execute: RunAppleCommand = (command, args) => {
  try {
    return execFileSync(command, args, { stdio: 'pipe', timeout: 120_000, encoding: 'utf8' })
  } catch {
    // execFile errors contain the command line, including private-key passwords.
    throw new Error(`Next runtime signing: ${command} ${args[0] ?? ''} failed; check certificate, password, and signing access`)
  }
}

function readUserKeychains(run: RunAppleCommand): string[] {
  return run('/usr/bin/security', ['list-keychains', '-d', 'user']).split('\n').map(line => line.trim().replace(/^"|"$/gu, '')).filter(path => path !== '')
}

/**
 * Run signing work with the release identity resolvable by codesign. An identity in the login keychain
 * is used as is. A PKCS#12 certificate supplied through `CSC_LINK` and `CSC_KEY_PASSWORD`, which
 * electron-builder imports into its own temporary keychain later, is imported into a keychain owned by
 * this call, prepended to the user search list for its duration, and deleted afterwards.
 * @param environment - Release environment as the macOS preflight adapted it.
 * @param identity - Developer ID Application identity confirmed by the preflight.
 * @param action - Signing work receiving the identity and keychain to pass to codesign.
 * @param run - Apple command executor.
 * @returns The action's result.
 */
export async function withMacSigningIdentity<T>(
  environment: NodeJS.ProcessEnv, identity: string, action: (signer: MacRuntimeSigningIdentity) => Promise<T>, run: RunAppleCommand = execute,
): Promise<T> {
  const certificate = environment.CSC_LINK
  if (certificate === undefined || certificate === '') return action({ identity })
  const password = environment.CSC_KEY_PASSWORD
  if (!certificate.startsWith(P12_DATA_PREFIX) || password === undefined) {
    throw new Error('Next runtime signing: CSC_LINK must carry the PKCS#12 data URL the preflight produced, with CSC_KEY_PASSWORD')
  }
  const directory = mkdtempSync(join(tmpdir(), 'dsh-next-signing-'))
  const keychain = join(directory, 'signing.keychain-db')
  const keychainPassword = randomBytes(32).toString('base64')
  const security = (args: readonly string[]): string => run('/usr/bin/security', args)
  let created = false
  let previousKeychains: string[] | undefined
  try {
    const p12 = join(directory, 'certificate.p12')
    writeFileSync(p12, Buffer.from(certificate.slice(P12_DATA_PREFIX.length), 'base64'))
    chmodSync(p12, 0o600)
    security(['create-keychain', '-p', keychainPassword, keychain])
    created = true
    security(['unlock-keychain', '-p', keychainPassword, keychain])
    security(['set-keychain-settings', keychain])
    security(['import', p12, '-k', keychain, '-P', password, '-T', '/usr/bin/codesign', '-T', '/usr/bin/productbuild'])
    security(['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychain])
    // codesign ignores --keychain unless that file is also on the search list.
    previousKeychains = readUserKeychains(run)
    security(['list-keychains', '-d', 'user', '-s', keychain, ...previousKeychains])
    const probe = join(directory, 'probe')
    run('/bin/cp', ['/usr/bin/true', probe])
    run('/usr/bin/codesign', ['--force', '--sign', identity, '--keychain', keychain, '--timestamp', '--options', 'runtime', probe])
    run('/usr/bin/codesign', ['--verify', '--strict', probe])
    return await action({ identity, keychain })
  } finally {
    try {
      if (previousKeychains !== undefined) security(['list-keychains', '-d', 'user', '-s', ...previousKeychains])
      if (created) security(['delete-keychain', keychain])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  }
}
