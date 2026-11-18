/** Browser and LAN access: following a hot LAN transition, and persisting access changes to the running edge. */

import type { DesktopSettingsForm } from '../../../../dsh-plugin-desktop/src/client/settings-bridge.ts'
import type {
  DesktopSettingsApi,
  DesktopSettingsView,
} from '../../../../dsh-plugin-desktop/src/client/desktop-settings-api.ts'
import type { DesktopShellSettings } from './model.ts'

type LanPollWait = (signal: AbortSignal) => Promise<void>

const LAN_POLL_INTERVAL_MS = 250
const LAN_POLL_MAX_READS = 21

function waitForLanPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, LAN_POLL_INTERVAL_MS)
    const cancel = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
}

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

/** Refresh Host state, briefly following an in-flight hot LAN transition. */
export async function readDesktopSettingsUntilLanSettled(
  api: Pick<DesktopSettingsApi, 'read'>,
  publish: (view: DesktopSettingsView) => void,
  signal: AbortSignal,
  wait: LanPollWait = waitForLanPoll,
): Promise<DesktopSettingsView> {
  let latest: DesktopSettingsView | undefined
  for (let read = 0; read < LAN_POLL_MAX_READS; read += 1) {
    signal.throwIfAborted()
    latest = await api.read()
    signal.throwIfAborted()
    publish(latest)
    if (latest.web.lanState !== 'starting' || read === LAN_POLL_MAX_READS - 1) return latest
    await wait(signal)
  }
  throw new Error('dsh-plugin-desktop: unreachable LAN settings polling state')
}

/** Persist ordinary-browser permission and refresh the already-running edge. */
export async function persistDesktopBrowserAccessHot(
  settings: Pick<DesktopSettingsForm<DesktopShellSettings>, 'set'>,
  checked: boolean,
  currentExposure: DesktopShellSettings['networkExposure'],
  refresh: () => Promise<DesktopSettingsView>,
): Promise<DesktopSettingsView> {
  if (!checked && currentExposure === 'lan') {
    await settings.set('networkExposure', 'loopback')
  }
  await settings.set('openBrowser', checked)
  return refresh()
}

/** Persist LAN intent and refresh its hot HTTPS ingress state. */
export async function persistDesktopNetworkExposureHot(
  settings: Pick<DesktopSettingsForm<DesktopShellSettings>, 'set'>,
  exposure: DesktopShellSettings['networkExposure'],
  refresh: () => Promise<DesktopSettingsView>,
): Promise<DesktopSettingsView> {
  await settings.set('networkExposure', exposure)
  return refresh()
}

/** URLs are advertised only after the user explicitly enables browser access. */
export function desktopBrowserUrlsShouldRender(
  browserAccess: boolean,
  _networkExposure: DesktopShellSettings['networkExposure'],
): boolean {
  return browserAccess
}

/** Keep cancellation side-effect free; only explicit confirmation enables LAN. */
export function resolveDesktopLanConfirmation(
  confirmed: boolean,
  dismiss: () => void,
  enableLan: () => void,
): void {
  dismiss()
  if (confirmed) enableLan()
}
