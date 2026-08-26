/** Same-origin browser client for launcher-owned Desktop settings operations. */

const SETTINGS_PATH = '/api/desktop/settings'
const PROFILE_CREATE_PATH = '/api/desktop/profiles/create'
const PROFILE_SELECT_PATH = '/api/desktop/profiles/select'
const PROFILE_DELETE_PATH = '/api/desktop/profiles/delete'
const MARKET_SELECT_PATH = '/api/desktop/market/select'
const TERMINAL_OPEN_PATH = '/api/desktop/terminal/open'
const RESTART_PATH = '/api/desktop/restart'
const RECOVERY_RESTART_PATH = '/api/desktop/restart/recovery'
const RENDERER_RELOAD_PATH = '/api/desktop/developer/reload'
const DEVELOPER_TOOLS_TOGGLE_PATH = '/api/desktop/developer/devtools'
const UPDATE_CHECK_PATH = '/api/desktop/updates/check'
const DIAGNOSTICS_EXPORT_PATH = '/api/desktop/diagnostics/export'
const MAX_PROFILES = 256
const MAX_PROFILE_NAME_LENGTH = 255
const MAX_LAN_URLS = 32

/** Launcher-supported plugin market implementations. */
export type DesktopMarketProvider = 'disabled' | 'community-market' | 'dsh-market'

/** Safe profile projection returned to the renderer. */
export interface DesktopProfileView {
  readonly name: string
  readonly exists: boolean
  readonly webCapable: boolean
  readonly selectable: boolean
  readonly deletable: boolean
}

/** Market selection fixed for the running generation. */
export interface DesktopMarketView {
  readonly requested: DesktopMarketProvider
  readonly effective: DesktopMarketProvider
  readonly legacyDefaulted: boolean
}

/** Marker-free ordinary-browser URLs for the running Desktop generation. */
export interface DesktopWebView {
  readonly localUrl: string
  readonly lanUrls: readonly string[]
}

/** Complete launcher-owned settings projection. */
export interface DesktopSettingsView {
  readonly current: string
  readonly profiles: readonly DesktopProfileView[]
  readonly market: DesktopMarketView
  readonly web: DesktopWebView
}

/** A persisted selection that requires a new Desktop generation. */
export interface DesktopRestartAcceptance {
  readonly accepted: true
  readonly restartRequired: boolean
}

/** Browser operations consumed by the Desktop settings section. */
export interface DesktopSettingsApi {
  read(): Promise<DesktopSettingsView>
  createProfile(name: string): Promise<DesktopSettingsView>
  selectProfile(name: string): Promise<DesktopRestartAcceptance>
  deleteProfile(name: string): Promise<DesktopSettingsView>
  selectMarket(provider: DesktopMarketProvider): Promise<DesktopRestartAcceptance>
  openTerminal(): Promise<void>
  restart(): Promise<void>
  restartToRecovery(): Promise<void>
  reloadRenderer(): Promise<void>
  toggleDeveloperTools(): Promise<void>
  checkForUpdates(): Promise<void>
  exportDiagnostics(): Promise<void>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMarketProvider(value: unknown): value is DesktopMarketProvider {
  return value === 'disabled' || value === 'community-market' || value === 'dsh-market'
}

function parseProfile(value: unknown): DesktopProfileView {
  if (!isObject(value)
    || typeof value.name !== 'string'
    || value.name.length === 0
    || value.name.length > MAX_PROFILE_NAME_LENGTH
    || typeof value.exists !== 'boolean'
    || typeof value.webCapable !== 'boolean'
    || typeof value.selectable !== 'boolean'
    || typeof value.deletable !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid profile settings response')
  }
  return Object.freeze({
    name: value.name,
    exists: value.exists,
    webCapable: value.webCapable,
    selectable: value.selectable,
    deletable: value.deletable,
  })
}

function parseBrowserUrl(value: unknown, loopback: boolean): string {
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  if (url.protocol !== 'http:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.port === '') {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  if (loopback ? url.hostname !== '127.0.0.1' : !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(url.hostname)) {
    throw new Error('dsh-plugin-desktop: invalid browser URL in settings response')
  }
  return url.href
}

/** Validate the bounded settings projection before it reaches React state. */
export function parseDesktopSettingsView(value: unknown): DesktopSettingsView {
  if (!isObject(value)
    || typeof value.current !== 'string'
    || value.current.length === 0
    || value.current.length > MAX_PROFILE_NAME_LENGTH
    || !Array.isArray(value.profiles)
    || value.profiles.length > MAX_PROFILES
    || !isObject(value.market)
    || !isMarketProvider(value.market.requested)
    || !isMarketProvider(value.market.effective)
    || typeof value.market.legacyDefaulted !== 'boolean'
    || !isObject(value.web)
    || !Array.isArray(value.web.lanUrls)
    || value.web.lanUrls.length > MAX_LAN_URLS) {
    throw new Error('dsh-plugin-desktop: invalid Desktop settings response')
  }
  const profiles = value.profiles.map(parseProfile)
  const localUrl = parseBrowserUrl(value.web.localUrl, true)
  const lanUrls = value.web.lanUrls.map(url => parseBrowserUrl(url, false))
  if (new Set(profiles.map(profile => profile.name)).size !== profiles.length) {
    throw new Error('dsh-plugin-desktop: duplicate profile in settings response')
  }
  return Object.freeze({
    current: value.current,
    profiles: Object.freeze(profiles),
    market: Object.freeze({
      requested: value.market.requested,
      effective: value.market.effective,
      legacyDefaulted: value.market.legacyDefaulted,
    }),
    web: Object.freeze({
      localUrl,
      lanUrls: Object.freeze(lanUrls),
    }),
  })
}

/** Validate restart acknowledgement returned before the Host generation exits. */
export function parseDesktopRestartAcceptance(value: unknown): DesktopRestartAcceptance {
  if (!isObject(value) || value.accepted !== true || typeof value.restartRequired !== 'boolean') {
    throw new Error('dsh-plugin-desktop: invalid Desktop restart response')
  }
  return Object.freeze({ accepted: true, restartRequired: value.restartRequired })
}

/** Validate the exact acknowledgement returned by a Desktop side effect. */
export function parseDesktopActionAcceptance(value: unknown): void {
  if (!isObject(value)
    || Object.keys(value).length !== 1
    || value.accepted !== true) {
    throw new Error('dsh-plugin-desktop: invalid Desktop action response')
  }
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: Desktop settings request failed (${String(response.status)})`)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new Error('dsh-plugin-desktop: Desktop settings response was not JSON')
  }
}

function post(fetcher: FetchLike, path: string, body: object): Promise<Response> {
  return fetcher(path, {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'error',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** Construct the default same-origin API, with a fetch seam for focused tests. */
export function createDesktopSettingsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopSettingsApi {
  return Object.freeze({
    async read() {
      const response = await fetcher(SETTINGS_PATH, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      return parseDesktopSettingsView(await readResponse(response))
    },
    async createProfile(name: string) {
      return parseDesktopSettingsView(await readResponse(await post(fetcher, PROFILE_CREATE_PATH, { name })))
    },
    async selectProfile(name: string) {
      return parseDesktopRestartAcceptance(await readResponse(await post(fetcher, PROFILE_SELECT_PATH, { name })))
    },
    async deleteProfile(name: string) {
      return parseDesktopSettingsView(await readResponse(await post(fetcher, PROFILE_DELETE_PATH, { name })))
    },
    async selectMarket(provider: DesktopMarketProvider) {
      return parseDesktopRestartAcceptance(await readResponse(await post(fetcher, MARKET_SELECT_PATH, { provider })))
    },
    async openTerminal() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, TERMINAL_OPEN_PATH, {})))
    },
    async restart() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, RESTART_PATH, {})))
    },
    async restartToRecovery() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, RECOVERY_RESTART_PATH, {})))
    },
    async reloadRenderer() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, RENDERER_RELOAD_PATH, {})))
    },
    async toggleDeveloperTools() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, DEVELOPER_TOOLS_TOGGLE_PATH, {})))
    },
    async checkForUpdates() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, UPDATE_CHECK_PATH, {})))
    },
    async exportDiagnostics() {
      parseDesktopActionAcceptance(await readResponse(await post(fetcher, DIAGNOSTICS_EXPORT_PATH, {})))
    },
  })
}

export const desktopSettingsPaths = Object.freeze({
  settings: SETTINGS_PATH,
  profileCreate: PROFILE_CREATE_PATH,
  profileSelect: PROFILE_SELECT_PATH,
  profileDelete: PROFILE_DELETE_PATH,
  marketSelect: MARKET_SELECT_PATH,
  terminalOpen: TERMINAL_OPEN_PATH,
  restart: RESTART_PATH,
  recoveryRestart: RECOVERY_RESTART_PATH,
  rendererReload: RENDERER_RELOAD_PATH,
  developerToolsToggle: DEVELOPER_TOOLS_TOGGLE_PATH,
  updateCheck: UPDATE_CHECK_PATH,
  diagnosticsExport: DIAGNOSTICS_EXPORT_PATH,
})
