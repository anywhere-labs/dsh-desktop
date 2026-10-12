/**
 * Inherit the operating system's proxy for Node-side egress.
 *
 * Chromium already routes its own requests through the system proxy, so the update check and every
 * renderer load follow it without help. Node's `fetch` does not: it reads neither the system
 * configuration nor `HTTP_PROXY`, so the LLM transport, WebFetch, web search, MCP over HTTP, and
 * package installs all connect directly no matter what the machine is configured to do. Users who
 * turn on their proxy client's "system proxy" switch — which writes the registry or the network
 * preferences and sets no environment variable — see the browser work and the agent fail.
 *
 * This module turns what Chromium resolved into the environment shape `@deepseek-ai/dsh-http-proxy`
 * already understands, so one installed policy covers undici's global dispatcher, `proxyRouteFor`,
 * and every spawned child. It holds only pure functions: the Electron call that reads the system
 * configuration lives in `main.ts`, because the Host utility process imports this file and must not
 * import an Electron main API.
 * @module
 */

/** The one thing proxy resolution needs from an environment, matching the upstream `EnvLookup`. */
export interface DesktopProxyEnvLookup {
  get(name: string): { readonly value: string } | undefined
}

/** Environment names, lowercase, that this module may synthesize. */
export type DesktopProxyOverlay = Readonly<Record<string, string>>

/** Which layer supplied the proxy the process will use. */
export type DesktopProxySource = 'environment' | 'system' | 'none'

/** What one `resolveProxy` answer means for Node-side egress. */
export type PacProxyResult =
  | { readonly kind: 'direct' }
  | { readonly kind: 'proxy'; readonly url: string }
  | { readonly kind: 'unsupported'; readonly detail: string }

/** A synthesized overlay plus everything an operator needs to read in the log. */
export interface DesktopProxyResolution {
  /** Names to layer over the launch environment before resolving the policy. Empty unless `source` is `system`. */
  readonly overlay: DesktopProxyOverlay
  /** Which layer won. The single most useful field when triaging a connectivity report. */
  readonly source: DesktopProxySource
  /** Operator-facing sentences about values that were seen and not used. */
  readonly diagnostics: readonly string[]
  /** The one line written at startup, whether or not a proxy was found. */
  readonly summary: string
}

/**
 * URLs probed against the system proxy resolver.
 *
 * Three, not one: a PAC script may route HTTPS and HTTP differently, and the npm registry is the
 * origin package installs use, which enterprise configurations often exempt or redirect on its own.
 */
export const PROBE_URLS: readonly string[] = Object.freeze([
  'https://api.deepseek.com/',
  'https://registry.npmjs.org/',
  'http://api.deepseek.com/',
])

/** Proxy names read to decide whether the user configured one explicitly. */
const EXPLICIT_PROXY_ENV_NAMES: readonly string[] = Object.freeze([
  'http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY',
])

/** PAC proxy types that carry traffic this package cannot route over Node's HTTP transport. */
const UNROUTABLE_PAC_TYPES: ReadonlySet<string> = new Set(['SOCKS', 'SOCKS4', 'SOCKS5', 'SOCKS5H', 'QUIC'])

/**
 * A bare `host:port` authority, bracketed for IPv6. The port is required: matching it here rather
 * than reading `URL.port` keeps an explicit `:443` on an `HTTPS` entry, which `URL` would normalize
 * away as the scheme default.
 */
const PAC_AUTHORITY_PATTERN = /^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9._-]+):\d{1,5}$/u

/** Accept only a bare `host:port` authority, so a malformed PAC answer never becomes a proxy URL. */
function proxyUrlFromAuthority(scheme: 'http' | 'https', authority: string): string | undefined {
  if (!PAC_AUTHORITY_PATTERN.test(authority)) return undefined
  let parsed: URL
  try {
    parsed = new URL(`${scheme}://${authority}`)
  } catch {
    return undefined
  }
  if (parsed.hostname === '') return undefined
  return `${scheme}://${authority}`
}

/**
 * Read one `session.resolveProxy` answer.
 *
 * The answer is a PAC result string — `DIRECT`, `PROXY host:port`, or several of those joined by
 * `;` as failover candidates. Entries are taken in order and the first routable one wins, so a
 * `SOCKS5 127.0.0.1:7891;PROXY 127.0.0.1:7890` configuration lands on the HTTP port rather than
 * giving up. Failover past the first routable entry is not modelled: undici holds one proxy per
 * scheme, and a proxy that is down is a condition the user must fix either way.
 *
 * @param pac - the raw string `resolveProxy` resolved with.
 * @returns the direct verdict, the proxy URL to use, or why nothing here was usable.
 */
export function parsePacProxyResult(pac: string): PacProxyResult {
  const rejected: string[] = []
  for (const entry of pac.split(';')) {
    const trimmed = entry.trim()
    if (trimmed === '') continue
    const separator = trimmed.search(/\s/u)
    const type = (separator === -1 ? trimmed : trimmed.slice(0, separator)).toUpperCase()
    const authority = separator === -1 ? '' : trimmed.slice(separator + 1).trim()
    if (type === 'DIRECT') return { kind: 'direct' }
    if (type === 'PROXY' || type === 'HTTPS') {
      const url = proxyUrlFromAuthority(type === 'HTTPS' ? 'https' : 'http', authority)
      if (url !== undefined) return { kind: 'proxy', url }
      rejected.push(`unparseable ${type} entry ${JSON.stringify(trimmed)}`)
      continue
    }
    if (UNROUTABLE_PAC_TYPES.has(type)) {
      rejected.push(`${type} (${authority})`)
      continue
    }
    rejected.push(`unrecognized entry ${JSON.stringify(trimmed)}`)
  }
  if (rejected.length === 0) return { kind: 'direct' }
  return { kind: 'unsupported', detail: rejected.join(', ') }
}

/** What the Electron probe observed, kept transport-free so this module stays testable. */
export interface DesktopSystemProxyProbe {
  /** Proxy for `http:` origins, as the resolver answered for an `http:` probe. */
  readonly http?: string
  /** Proxy for `https:` origins, as the resolver answered for an `https:` probe. */
  readonly https?: string
  /** Whether probes disagreed, which means per-URL PAC rules are in force. */
  readonly disagreed?: boolean
  /** Sentences about answers that were seen and not used, including SOCKS-only configurations. */
  readonly notes?: readonly string[]
}

/** Everything needed to decide what the process's proxy environment should be. */
export interface DesktopProxyOverlayInput {
  /** The launch environment, already layered so real variables beat `.env` files. */
  readonly env: DesktopProxyEnvLookup
  /** What the system proxy resolver answered. */
  readonly probe: DesktopSystemProxyProbe
  /** This machine's LAN IPv4 literals, which must never be routed through a proxy. */
  readonly lanAddresses?: readonly string[]
}

/** Join bypass entries into the one string undici and the policy both read. */
function mergeNoProxy(entries: readonly (string | undefined)[]): string {
  const merged = entries
    .flatMap(entry => (entry ?? '').split(','))
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
  return [...new Set(merged)].join(',')
}

/** Read the first proxy name the environment supplies with a non-empty value. */
function explicitProxyEnvName(env: DesktopProxyEnvLookup): string | undefined {
  for (const name of EXPLICIT_PROXY_ENV_NAMES) {
    if ((env.get(name)?.value ?? '').trim() !== '') return name
  }
  return undefined
}

/**
 * Decide the proxy environment this process runs with.
 *
 * An explicitly exported proxy wins over the system configuration, matching what `curl` and every
 * browser do: a user who exported `HTTPS_PROXY` chose a route for this program specifically, and
 * silently overriding it with the machine-wide setting would be the surprising outcome. That case
 * synthesizes nothing and hands the environment through untouched, so the upstream resolver applies
 * its own precedence — including the `ALL_PROXY` fallback — exactly as it does for the CLI.
 *
 * @param input - the launch environment, the probe result, and this machine's LAN literals.
 * @returns the overlay to apply, which layer won, and the lines to log.
 */
export function buildDesktopProxyOverlay(input: DesktopProxyOverlayInput): DesktopProxyResolution {
  const { env, probe, lanAddresses = [] } = input
  const diagnostics = [...probe.notes ?? []]
  const explicit = explicitProxyEnvName(env)
  if (explicit !== undefined) {
    const summary = `outbound proxy = ${env.get(explicit)?.value ?? ''} (source: environment ${explicit}; system proxy ignored)`
    return { overlay: Object.freeze({}), source: 'environment', diagnostics: Object.freeze(diagnostics), summary }
  }
  if (probe.http === undefined && probe.https === undefined) {
    const reason = diagnostics.length === 0
      ? 'the system proxy resolver returned DIRECT for every probe'
      : 'no usable system proxy was found'
    return {
      overlay: Object.freeze({}),
      source: 'none',
      diagnostics: Object.freeze(diagnostics),
      summary: `outbound proxy = none (source: none; ${reason})`,
    }
  }
  const noProxy = mergeNoProxy([env.get('no_proxy')?.value ?? env.get('NO_PROXY')?.value, ...lanAddresses, '.local'])
  const overlay: Record<string, string> = { no_proxy: noProxy }
  if (probe.http !== undefined) overlay.http_proxy = probe.http
  if (probe.https !== undefined) overlay.https_proxy = probe.https
  if (probe.disagreed === true) {
    diagnostics.push('system proxy answers differ between probe URLs, which means per-URL PAC rules are in force;'
      + ' applying the first proxy found, so some hosts may be routed differently than in your browser')
  }
  const applied = probe.https ?? probe.http ?? ''
  return {
    overlay: Object.freeze(overlay),
    source: 'system',
    diagnostics: Object.freeze(diagnostics),
    summary: `outbound proxy = ${applied} (source: system, no_proxy: ${noProxy})`,
  }
}

/**
 * Layer a synthesized overlay over the launch environment.
 *
 * The overlay wins, because {@link buildDesktopProxyOverlay} already applied the precedence: it is
 * empty whenever the user exported a proxy themselves, and its bypass list already carries whatever
 * they wrote. Both processes resolve their policy through this one function, so the Host can never
 * route differently from the supervisor that told it what to route.
 *
 * @param snapshot - the launch environment snapshot.
 * @param overlay - names synthesized from the system proxy, keyed lowercase.
 * @returns a lookup the upstream resolver accepts unchanged.
 */
export function desktopProxyEnvLookup(
  snapshot: DesktopProxyEnvLookup,
  overlay: DesktopProxyOverlay,
): DesktopProxyEnvLookup {
  return {
    get(name: string) {
      const synthesized = overlay[name.toLowerCase()]
      if (synthesized !== undefined) return { value: synthesized }
      return snapshot.get(name)
    },
  }
}

/**
 * Explain a SOCKS-only system proxy in terms of the switch the user can actually reach.
 *
 * Letting the upstream resolver report this instead would name `HTTPS_PROXY` — a variable the user
 * never set — and send them looking for a misconfiguration that is not there.
 *
 * @param url - the probe URL whose answer was SOCKS.
 * @param detail - the rejected PAC entries.
 * @returns one operator-facing sentence.
 */
export function socksProxyDiagnostic(url: string, detail: string): string {
  return `the system proxy for ${url} is ${detail}, which Node-side HTTP cannot use; those requests will connect`
    + ' directly. Enable your proxy client\'s HTTP or mixed port and turn on the system HTTP proxy, or set'
    + ' HTTPS_PROXY to an http:// URL. Application windows and the update check are unaffected.'
}
