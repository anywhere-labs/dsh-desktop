// TinTin first-boot provisioning seed (channel-only addition).
//
// The full provisioning semantics live in the bridge's client chrome
// (installTinTinProvisioning in dsh-tintin-bundle/client.js, user ruling
// 2026-09-30: exactly one place configures the inference server). That flow
// exits early until the bridge's own store carries a server URL, so this
// seed — ported from the source repository's first-boot — writes the one
// precondition file before the Host boots:
//
//   <home>/tintin/config.json = { server: { url: <seed> } }
//
// The seed URL is the legacy client's server.json when an old install
// exists, else the loopback default. Only writes when the file is absent,
// so a URL the user configured later always wins.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDesktopChannelHome } from '../desktop-channel-home.ts'
import { DESKTOP_PRODUCT_IDENTITY } from '../product-identity.ts'

// 定制版默认=部署服务器（2026-10-12 用户裁决：新装零配置即连；与
// dsh-tintin-bundle/lib/server-proxy.js 的解析链兜底同值，改动须两边同步）
const DEFAULT_SERVER_URL = 'http://192.168.111.31:8000'

// The old client's userData used the package name; earlier packaged builds
// used the productName. Read both (newest mtime wins when both exist).
const LEGACY_APP_DIRS = ['tintin-client-electron', '螺丝钉-电商智能体矩阵']

/** Resolve the seed server URL: legacy client config when present, else default. */
function resolveSeedServerUrl(appDataDir: string | undefined): string {
  if (appDataDir !== undefined) {
    for (const dir of LEGACY_APP_DIRS) {
      const legacy = join(appDataDir, dir, 'config', 'server.json')
      try {
        const raw = JSON.parse(readFileSync(legacy, 'utf8')) as Record<string, unknown>
        const nested = raw.server as { url?: unknown } | undefined
        const url = raw['server.url'] ?? nested?.url ?? raw.server_url
        if (typeof url === 'string' && url.length > 0) return url.replace(/\/$/u, '')
      } catch { /* absent or malformed — try the next dir */ }
    }
  }
  return DEFAULT_SERVER_URL
}

/**
 * Seed the bridge's own config store when absent, resolving the channel home
 * the same way the mirrored bootstrap will. Provisioning must never block
 * startup; without the seed the first-boot wizard still configures the URL.
 */
export function seedTinTinDefaults(appDataDir: string | undefined): void {
  try {
    const resolution = resolveDesktopChannelHome({
      identity: DESKTOP_PRODUCT_IDENTITY,
      environment: process.env,
      homeDirectory: homedir(),
    })
    const dshHome = resolution.homeDir
    const storePath = join(dshHome, 'tintin', 'config.json')
    if (existsSync(storePath)) return
    const serverUrl = resolveSeedServerUrl(appDataDir)
    mkdirSync(join(dshHome, 'tintin'), { recursive: true })
    writeFileSync(storePath, `${JSON.stringify({ server: { url: serverUrl } }, null, 2)}\n`, 'utf8')
    console.info(`[tintin-first-boot] seeded server url ${serverUrl} for ${dshHome}`)
  } catch (error) {
    console.warn('[tintin-first-boot] seed failed:', error instanceof Error ? error.message : String(error))
  }
}
