/**
 * Inherit the operating system's proxy for the Next Host's Node-side egress.
 *
 * Next's Host already installs an outbound proxy policy: the upstream `runProfile()` hands its
 * launch environment to `installProxyFromEnvironment` before any plugin mounts. What it cannot see
 * is the system proxy. A proxy client's "system proxy" switch writes the Windows registry or the
 * macOS network preferences and sets no environment variable, so model conversations, WebFetch,
 * web search, MCP over HTTP, and package installs kept connecting directly while the application
 * windows (Chromium) followed the proxy.
 *
 * Electron main owns the probe, because only Chromium can evaluate the system configuration
 * (including PAC and WPAD) and the Host runs in Node mode. The Host owns the decision, because only
 * the Host's layered launch environment knows whether the user configured a proxy explicitly --
 * including in a `.env` file -- which must win over the machine-wide setting. The precedence rules
 * and PAC parsing are shared with Stable and Beta.
 *
 * This file must not import Electron: the Host bundle imports it.
 * @module
 */

import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import {
  buildDesktopProxyOverlay,
  parsePacProxyResult,
  socksProxyDiagnostic,
  PROBE_URLS,
  type DesktopProxyResolution,
  type DesktopSystemProxyProbe,
} from '../../dsh-plugin-desktop-beta/src/system-proxy.ts'

export type { DesktopSystemProxyProbe } from '../../dsh-plugin-desktop-beta/src/system-proxy.ts'

/** Environment name carrying the main-process probe to the Host; removed before the Host snapshots its environment. */
export const SYSTEM_PROXY_ENV = 'DSH_NEXT_SYSTEM_PROXY'

/** The part of an Electron `Session` the probe needs. */
export interface SystemProxyResolver {
  forceReloadProxyConfig(): Promise<void>
  resolveProxy(url: string): Promise<string>
}

/** The proxy resolver reads a fresh configuration lazily; give it a moment before believing DIRECT. */
const SYSTEM_PROXY_PROBE_ATTEMPTS = 3
const SYSTEM_PROXY_PROBE_BACKOFF_MS = 200

/**
 * Ask Chromium what the operating system routes each probe URL through.
 *
 * A failure is never fatal: the application must still start, connecting directly, on a machine
 * whose proxy configuration cannot be read. Nothing is logged here; notes travel on the return
 * value and are logged by the Host together with the decision that was actually made.
 *
 * @param resolver - the default session, or a test double.
 * @param wait - delay between attempts; injectable for tests.
 * @returns the proxy for each scheme, whether probes disagreed, and what was rejected.
 */
export async function probeSystemProxy(
  resolver: SystemProxyResolver,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<DesktopSystemProxyProbe> {
  const notes: string[] = []
  const rejected: string[] = []
  try {
    try {
      await resolver.forceReloadProxyConfig()
    } catch (cause) {
      notes.push(`could not refresh the system proxy configuration: ${String(cause)}`)
    }
    for (let attempt = 1; attempt <= SYSTEM_PROXY_PROBE_ATTEMPTS; attempt += 1) {
      // Only the last round describes what was acted on; clearing keeps one SOCKS port from being
      // reported once per attempt.
      rejected.length = 0
      const answers = new Map<string, string>()
      for (const url of PROBE_URLS) {
        const result = parsePacProxyResult(await resolver.resolveProxy(url))
        if (result.kind === 'proxy') answers.set(url, result.url)
        else if (result.kind === 'unsupported') rejected.push(socksProxyDiagnostic(url, result.detail))
      }
      if (answers.size === 0) {
        // A session may answer before its configuration lands; retry before concluding the machine
        // is direct, but never delay a SOCKS-only or genuinely direct start past the last attempt.
        if (rejected.length > 0 || attempt === SYSTEM_PROXY_PROBE_ATTEMPTS) break
        await wait(SYSTEM_PROXY_PROBE_BACKOFF_MS)
        continue
      }
      const probe: { http?: string; https?: string } = {}
      for (const [url, proxy] of answers) {
        if (url.startsWith('https:')) probe.https ??= proxy
        else probe.http ??= proxy
      }
      const disagreed = new Set(answers.values()).size > 1 || answers.size !== PROBE_URLS.length
      return { ...probe, disagreed, notes: [...notes, ...rejected] }
    }
  } catch (cause) {
    notes.push(`could not read the system proxy configuration: ${String(cause)}`)
  }
  return { notes: [...notes, ...rejected] }
}

function isProxyUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Read the probe main passed across the process boundary.
 *
 * The value crosses a process boundary as text, so it is validated field by field; anything
 * malformed degrades to "no system proxy" with a note rather than stopping the Host.
 *
 * @param text - the raw environment value, if any.
 * @returns a probe that is safe to hand to {@link buildDesktopProxyOverlay}.
 */
export function parseSystemProxyProbe(text: string | undefined): DesktopSystemProxyProbe {
  if (text === undefined || text === '') return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { notes: ['ignored an unreadable system proxy probe from the Desktop main process'] }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { notes: ['ignored an unreadable system proxy probe from the Desktop main process'] }
  }
  const raw = value as Record<string, unknown>
  const notes = Array.isArray(raw.notes) ? raw.notes.filter((note): note is string => typeof note === 'string') : []
  const probe: { http?: string; https?: string; disagreed?: boolean; notes: string[] } = { notes }
  for (const scheme of ['http', 'https'] as const) {
    if (raw[scheme] === undefined) continue
    if (isProxyUrl(raw[scheme])) probe[scheme] = raw[scheme]
    else notes.push(`ignored an invalid ${scheme} system proxy from the Desktop main process`)
  }
  if (raw.disagreed === true) probe.disagreed = true
  return probe
}

/** A decided outbound route plus the launch environment that carries it. */
export interface NextProxyEnvironment {
  readonly environment: LaunchEnvironmentSnapshot
  readonly resolution: DesktopProxyResolution
}

/**
 * Layer the system proxy under the user's own configuration.
 *
 * {@link buildDesktopProxyOverlay} synthesizes nothing when any layer -- the inherited
 * environment or either `.env` file -- already names a proxy, so the upstream resolver then applies
 * its own precedence exactly as the CLI does. Otherwise the synthesized lowercase names answer as
 * the inherited environment would, for both casings, which is the layer the upstream installer
 * trusts most.
 *
 * @param snapshot - the Host's layered launch environment.
 * @param probe - what main's resolver answered.
 * @param lanAddresses - this machine's LAN literals, which must never be proxied.
 * @returns the environment to boot with and the resolution to log.
 */
export function withSystemProxy(
  snapshot: LaunchEnvironmentSnapshot,
  probe: DesktopSystemProxyProbe,
  lanAddresses: readonly string[],
): NextProxyEnvironment {
  const resolution = buildDesktopProxyOverlay({ env: snapshot, probe, lanAddresses })
  const overlay = resolution.overlay
  if (Object.keys(overlay).length === 0) return { environment: snapshot, resolution }
  const environment: LaunchEnvironmentSnapshot = {
    get(name) {
      const value = overlay[name.toLowerCase()]
      return value === undefined ? snapshot.get(name) : { value, source: 'process' }
    },
    getFrom(name, sources) {
      const value = overlay[name.toLowerCase()]
      return value === undefined || !sources.includes('process')
        ? snapshot.getFrom(name, sources)
        : { value, source: 'process' }
    },
  }
  return { environment, resolution }
}
