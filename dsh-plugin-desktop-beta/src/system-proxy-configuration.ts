/**
 * Read whether the operating system configures any proxy at all, without asking Chromium.
 *
 * `probeSystemProxy` retries a DIRECT answer because a session can answer before its configuration
 * lands (electron#26166). That can only hide a configuration that exists: with no manual proxy, no
 * PAC file and no proxy auto-discovery, the first DIRECT is the answer, and each retry only delays
 * the Host start. macOS is read from the same SystemConfiguration dictionary Chromium uses, through
 * `scutil --proxy`. Other platforms answer `unknown`, which keeps the retries.
 * @module
 */
import { execFile } from 'node:child_process'
import type { SystemProxyConfiguration } from './system-proxy.ts'

/** Global proxy dictionary switches that can route an HTTP or HTTPS request through a proxy. */
const MACOS_PROXY_SWITCHES = ['HTTPEnable', 'HTTPSEnable', 'SOCKSEnable', 'ProxyAutoConfigEnable', 'ProxyAutoDiscoveryEnable']
const SCUTIL_TIMEOUT_MS = 1_000

/**
 * Read the global proxy dictionary `scutil --proxy` prints.
 * @param output - the command's standard output.
 * @returns `none` only for a dictionary whose proxy switches are all absent or 0.
 */
export function parseScutilProxy(output: string): SystemProxyConfiguration {
  if (!/^<dictionary> \{$/mu.test(output)) return 'unknown'
  // The dictionary's own keys are indented by two spaces; per-interface `__SCOPED__` entries and
  // array items nest deeper, and Chromium does not read them either.
  const values = new Map([...output.matchAll(/^ {2}([A-Za-z]+) : (.*)$/gmu)].map(match => [match[1]!, match[2]!.trim()]))
  return MACOS_PROXY_SWITCHES.some(key => values.has(key) && values.get(key) !== '0') ? 'configured' : 'none'
}

/**
 * Ask the operating system whether it configures any proxy.
 * @param platform - the running platform.
 * @param run - runs a command and resolves its standard output; injectable for tests.
 * @returns the operating system's answer; never rejects.
 */
export async function readSystemProxyConfiguration(
  platform: NodeJS.Platform,
  run: (file: string, args: readonly string[]) => Promise<string> = (file, args) => new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: SCUTIL_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => { if (error) reject(error); else resolve(stdout) })
  }),
): Promise<SystemProxyConfiguration> {
  if (platform !== 'darwin') return 'unknown'
  try { return parseScutilProxy(await run('/usr/sbin/scutil', ['--proxy'])) } catch { return 'unknown' }
}
