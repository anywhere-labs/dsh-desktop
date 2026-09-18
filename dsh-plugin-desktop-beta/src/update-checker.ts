/** Headless version checks against the public DSH Desktop release service. */

import {
  assertDesktopInstallationId,
  DESKTOP_INSTALLATION_ID_HEADER,
  type DesktopInstallationId,
} from './desktop-installation-id.ts'

/** Public endpoint returning the latest DSH Desktop version for a requested channel. */
export const DESKTOP_VERSION_ENDPOINT = 'https://www.dshdesktop.cn/api/desktop/version'

/** Header carrying the installed Desktop version to the fixed version endpoint. */
export const DESKTOP_CURRENT_VERSION_HEADER = 'X-DSH-Desktop-Version'

/** Header selecting an isolated Desktop release stream. */
export const DESKTOP_RELEASE_CHANNEL_HEADER = 'X-DSH-Desktop-Channel'

/** Release streams supported by the Desktop service. */
export type DesktopReleaseChannel = 'stable' | 'beta'

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

/** Inputs for one channel-scoped version check. */
export interface UpdateCheckOptions {
  /** Installed application version, expressed as canonical SemVer. */
  readonly currentVersion: string
  /** Release stream that must be returned by the service. */
  readonly channel: DesktopReleaseChannel
  /** Channel of the installed application when explicitly switching streams. */
  readonly currentChannel?: DesktopReleaseChannel
  /** Treat a different older version as selectable for an explicit channel switch. */
  readonly allowDowngrade?: boolean
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
  /** Canonical installed version, including any prerelease identifiers. */
  readonly currentVersion: string
  /** Canonical latest stable version returned by the service. */
  readonly latestVersion: string
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
 * Check the fixed DSH Desktop version endpoint for a release in one channel.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when any request or validation step fails.
 */
export async function checkForDesktopUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalChannelVersion(
    options.currentVersion,
    options.currentChannel ?? options.channel,
  )
  if (current === null) return null

  let headers: HeadersInit
  try {
    headers = desktopVersionRequestHeaders(options.installationId, current.version, options.channel)
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

  const latest = parseVersionResponse(body, options.channel)
  if (latest === null) return null
  const comparison = compareParsedSemVer(latest, current)
  return {
    status: comparison > 0 || (options.allowDowngrade === true && comparison !== 0)
      ? 'update-available'
      : 'up-to-date',
    currentVersion: current.version,
    latestVersion: latest.version,
  }
}

/** Backward-compatible stable-channel entry point for existing callers. */
export function checkForStableUpdate(
  options: Omit<UpdateCheckOptions, 'channel'>,
): Promise<UpdateCheckResult | null> {
  return checkForDesktopUpdate({ ...options, channel: 'stable' })
}

/** Build the complete header set for the fixed version-check request only. */
export function desktopVersionRequestHeaders(
  installationId?: string,
  currentVersion?: string,
  channel?: DesktopReleaseChannel,
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (channel !== undefined) headers[DESKTOP_RELEASE_CHANNEL_HEADER] = channel
  if (currentVersion !== undefined) {
    const parsed = channel === undefined
      ? parseCanonicalChannelVersion(currentVersion, 'stable')
      : parseCanonicalSupportedVersion(currentVersion)
    if (parsed === null) {
      throw new Error(channel === undefined
        ? 'Desktop current version must be canonical stable SemVer.'
        : 'Desktop current version must be canonical SemVer.')
    }
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

function parseVersionResponse(body: string, expectedChannel: DesktopReleaseChannel): ParsedSemVer | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(value) || typeof value.version !== 'string') return null
  if (expectedChannel === 'beta' && value.channel !== 'beta') return null
  if (value.channel !== undefined && value.channel !== expectedChannel) return null
  return parseCanonicalChannelVersion(value.version, expectedChannel)
}

function parseCanonicalChannelVersion(
  input: string,
  channel: DesktopReleaseChannel,
): ParsedSemVer | null {
  const parsed = parseCanonicalVersion(input)
  if (parsed === null) return null
  if (channel === 'stable') return parsed.prerelease.length === 0 ? parsed : null
  return parsed.prerelease.length === 2
    && parsed.prerelease[0] === 'beta'
    && isNumeric(parsed.prerelease[1]!)
    ? parsed
    : null
}

function parseCanonicalSupportedVersion(input: string): ParsedSemVer | null {
  return parseCanonicalChannelVersion(input, 'stable')
    ?? parseCanonicalChannelVersion(input, 'beta')
}

function parseCanonicalVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.version === input ? parsed : null
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
