/** Headless version checks against the public DSH Desktop release service. */

import {
  assertDesktopInstallationId,
  DESKTOP_INSTALLATION_ID_HEADER,
  type DesktopInstallationId,
} from './desktop-installation-id.ts'

/** Public endpoint returning the latest stable DSH Desktop version. */
export const DESKTOP_VERSION_ENDPOINT = 'https://www.dshdesktop.cn/api/desktop/version'

/** Header carrying the installed Desktop version to the fixed version endpoint. */
export const DESKTOP_CURRENT_VERSION_HEADER = 'X-DSH-Desktop-Version'

/** Maximum response body bytes accepted from the version service. */
export const MAX_VERSION_RESPONSE_BYTES = 4 * 1024

/** Strictly parsed SemVer components. Numeric components remain strings to avoid overflow. */
export interface ParsedSemVer {
  /** Canonical version without the optional leading `v`. */
  readonly version: string
  /** Major numeric identifier. */
  readonly major: string
  /** Minor numeric identifier. */
  readonly minor: string
  /** Patch numeric identifier. */
  readonly patch: string
  /** Ordered prerelease identifiers, or an empty list for a stable version. */
  readonly prerelease: readonly string[]
  /** Build identifiers, ignored for version precedence. */
  readonly build: readonly string[]
}

/** Fetch-compatible request function used by the headless checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one stable version check. */
export interface UpdateCheckOptions {
  /** Installed application version, expressed as canonical stable SemVer. */
  readonly currentVersion: string
  /** Caller-owned cancellation signal; the checker does not create its own timeout. */
  readonly signal?: AbortSignal
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: UpdateRequest
  /** Installation UUID attached only to the fixed version-check endpoint. */
  readonly installationId?: DesktopInstallationId
}

/** Successful comparison returned by the stable version service. */
export type UpdateCheckResult = {
  /** Whether the service reports a version newer than the installed application. */
  readonly status: 'up-to-date' | 'update-available'
  /** Canonical installed stable version. */
  readonly currentVersion: string
  /** Canonical latest stable version returned by the service. */
  readonly latestVersion: string
  /**
   * Optional per-platform hex SHA-256 digests of the published installers.
   * Whenever the service publishes them, the download path enforces them as
   * a hard integrity gate before execution; they are optional only because
   * the version endpoint does not publish digests yet.
   */
  readonly installerSha256?: Readonly<Partial<Record<'win32' | 'darwin', string>>>
}

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/**
 * Parse strict SemVer with an optional lowercase `v` prefix.
 * @param input - complete version or release tag.
 * @returns parsed identifiers, or null when the input is not valid SemVer.
 */
export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null

  return {
    version,
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

/**
 * Compare two strict SemVer strings without numeric overflow.
 * @param left - first strict SemVer value.
 * @param right - second strict SemVer value.
 * @returns negative, zero, or positive precedence, or null when either value is invalid.
 */
export function compareSemVerVersions(left: string, right: string): number | null {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  if (leftVersion === null || rightVersion === null) return null
  return compareParsedSemVer(leftVersion, rightVersion)
}

/**
 * Check the fixed DSH Desktop version endpoint for a newer stable release.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when any request or validation step fails.
 */
export async function checkForStableUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalStableVersion(options.currentVersion)
  if (current === null) return null

  let headers: HeadersInit
  try {
    headers = desktopVersionRequestHeaders(options.installationId, current.version)
  } catch {
    return null
  }

  const init: RequestInit = {
    method: 'GET',
    headers,
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? defaultRequest

  let response: Response
  try {
    response = await request(DESKTOP_VERSION_ENDPOINT, init)
  } catch {
    return null
  }
  if (response.status !== 200) return null

  let body: string
  try {
    body = await readLimitedBody(response)
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const latest = parseVersionResponse(parsed)
  if (latest === null) return null
  const digests = parseInstallerDigestResponse(parsed)
  return {
    status: compareParsedSemVer(latest, current) > 0 ? 'update-available' : 'up-to-date',
    currentVersion: current.version,
    latestVersion: latest.version,
    ...(digests === undefined ? {} : { installerSha256: digests }),
  }
}

/** Build the complete header set for the fixed version-check request only. */
export function desktopVersionRequestHeaders(
  installationId?: string,
  currentVersion?: string,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (currentVersion !== undefined) {
    const parsed = parseCanonicalStableVersion(currentVersion)
    if (parsed === null) throw new Error('Desktop current version must be a canonical stable SemVer.')
    headers[DESKTOP_CURRENT_VERSION_HEADER] = parsed.version
  }
  if (installationId !== undefined) {
    headers[DESKTOP_INSTALLATION_ID_HEADER] = assertDesktopInstallationId(installationId)
  }
  return headers
}

async function defaultRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) {
    throw new Error('version response is too large')
  }

  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_VERSION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('version response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseVersionResponse(value: unknown): ParsedSemVer | null {
  if (!isRecord(value) || typeof value.version !== 'string') return null
  return parseCanonicalStableVersion(value.version)
}

/**
 * Extract optional per-platform installer digests from the parsed version
 * response: `{ "version": "2.0.2", "sha256": { "windows": "<hex>", "mac": "<hex>" } }`.
 * Hex digits are case-normalized; absent or malformed fields simply leave the
 * digest gate unset for that platform.
 */
function parseInstallerDigestResponse(value: unknown): UpdateCheckResult['installerSha256'] | undefined {
  if (!isRecord(value) || !isRecord(value.sha256)) return undefined
  const digests: Partial<Record<'win32' | 'darwin', string>> = {}
  const normalize = (digest: unknown): string | undefined => {
    if (typeof digest !== 'string') return undefined
    const normalized = digest.trim().toLowerCase()
    return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : undefined
  }
  const windows = normalize(value.sha256.windows)
  const mac = normalize(value.sha256.mac)
  if (windows !== undefined) digests.win32 = windows
  if (mac !== undefined) digests.darwin = mac
  return Object.keys(digests).length > 0 ? digests : undefined
}

function parseCanonicalStableVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === input
    ? parsed
    : null
}

function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
