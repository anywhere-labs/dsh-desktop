/** The Desktop settings page's state: the settings scopes, the Host view, busy and restart state, and the handlers its tabs share. */

import { type FormEvent, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { DesktopSettingsForm } from '../../../../dsh-plugin-desktop/src/client/settings-bridge.ts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DesktopMarketProvider,
  DesktopSettingsView,
} from '../../../../dsh-plugin-desktop/src/client/desktop-settings-api.ts'
import {
  desktopBrowserAccessAvailable,
  desktopBrowserAccessEnabled,
} from '../../../../dsh-plugin-desktop/src/desktop-network.ts'
import type {
  BusyOperation,
  DesktopNotificationSettings,
  DesktopSettingsSectionInjected,
  DesktopSettingsTab,
  DesktopShellSettings,
  RestartState,
} from './model.ts'
import {
  isAbortError,
  persistDesktopBrowserAccessHot,
  persistDesktopNetworkExposureHot,
  readDesktopSettingsUntilLanSettled,
} from './lan-access.ts'

function useScope<T>(scope: Pick<DesktopSettingsForm<T>, 'getSnapshot' | 'subscribe'>) {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useCallback(() => scope.getSnapshot(), [scope])
  return useSyncExternalStore(subscribe, snapshot)
}

/** State and handlers that the Desktop settings tabs share: the settings scopes, the Host view, busy and restart state. */
export function useDesktopSettingsSection({
  t,
  api,
  platform,
  version,
  initialMode,
  setMode: persistMode,
  desktopSettings,
  notificationSettings,
  capabilities,
  browserActions,
  presentationRows,
  tabSections,
}: DesktopSettingsSectionInjected & Pick<PropsLocale<'desktop.settings'>, 't'> & Partial<PropsRuntime<'settings.section'>>) {
  const desktop = useScope(desktopSettings)
  const notifications = useScope(notificationSettings)
  const tabsId = useId()
  const [tab, setTab] = useState<DesktopSettingsTab>('general')
  const [view, setView] = useState<DesktopSettingsView>()
  const [profileName, setProfileName] = useState('')
  const [busy, setBusy] = useState<BusyOperation | undefined>('load')
  const [loadFailed, setLoadFailed] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)
  const [aaStatus, setAaStatus] = useState<'idle' | 'saving' | 'failed' | 'saved'>('idle')
  const [restart, setRestart] = useState<RestartState>('none')
  const [pendingProfileDelete, setPendingProfileDelete] = useState<string>()
  const [confirmLan, setConfirmLan] = useState(false)
  const [sidebarFooterOpen, setSidebarFooterOpen] = useState(false)
  const sidebarFooterRegionId = useId()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationsRegionId = useId()
  const [updateCheck, setUpdateCheck] = useState<'idle' | 'checking' | 'failed'>('idle')
  const lanPoll = useRef<AbortController>()

  const publishView = useCallback((next: DesktopSettingsView) => {
    setView(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
  }, [])

  const refreshView = useCallback(async () => {
    lanPoll.current?.abort()
    const controller = new AbortController()
    lanPoll.current = controller
    try {
      return await readDesktopSettingsUntilLanSettled(api, publishView, controller.signal)
    } finally {
      if (lanPoll.current === controller) lanPoll.current = undefined
    }
  }, [api, publishView])

  const load = useCallback(async () => {
    setBusy('load')
    setLoadFailed(false)
    setOperationFailed(false)
    try {
      await refreshView()
    } catch (cause) {
      if (!isAbortError(cause)) setLoadFailed(true)
    } finally {
      setBusy(current => current === 'load' ? undefined : current)
    }
  }, [refreshView])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => { lanPoll.current?.abort() }, [])
  useEffect(() => {
    if (restart !== 'restarting') return
    const timer = setTimeout(() => { setRestart('required') }, 8_000)
    return () => { clearTimeout(timer) }
  }, [restart])

  const run = useCallback(async (operation: BusyOperation, invoke: () => Promise<void>) => {
    setBusy(operation)
    setOperationFailed(false)
    if (operation !== 'select-aa') setAaStatus('idle')
    try {
      await invoke()
    } catch {
      setOperationFailed(true)
    } finally {
      setBusy(current => current === operation ? undefined : current)
    }
  }, [])

  const runPreference = useCallback(async (invoke: () => Promise<void>) => {
    setOperationFailed(false)
    try {
      await invoke()
    } catch {
      setOperationFailed(true)
    }
  }, [])

  const requestRestart = (): void => { setRestart('restarting') }
  const profileBusy = busy === 'load' || busy === 'create-profile' || busy === 'select-profile' || busy === 'delete-profile'
  const settingsWritable = desktop.status === 'ready' && desktop.writable
  const notificationsWritable = notifications.status === 'ready' && notifications.writable
  const storedMode = desktop.value?.mode ?? initialMode
  const configuredNetworkExposure = desktop.value?.networkExposure ?? 'loopback'
  const browserAccess = desktopBrowserAccessEnabled(
    storedMode,
    desktop.value?.openBrowser ?? false,
    configuredNetworkExposure,
  )
  const mode = storedMode
  const networkExposure = browserAccess ? configuredNetworkExposure : 'loopback'
  const notificationValue = notifications.value ?? {
    enabled: true,
    notifyOnTurnCompletion: true,
    notifyOnTurnFailure: true,
    notifyOnJobCompletion: true,
    notifyOnJobFailure: true,
    notifyOnScheduleCompletion: true,
    notifyOnScheduleFailure: true,
  }

  const createProfile = (event: FormEvent): void => {
    event.preventDefault()
    const name = profileName.trim()
    if (name.length === 0) return
    void run('create-profile', async () => {
      setView(await api.createProfile(name))
      setProfileName('')
    })
  }

  const selectProfile = (name: string): void => {
    void run('select-profile', async () => {
      const response = await api.selectProfile(name)
      if (response.restartRequired) requestRestart()
      else setView(await refreshView())
    })
  }

  const deleteProfile = (name: string): void => {
    void run('delete-profile', async () => {
      setView(await api.deleteProfile(name))
      setPendingProfileDelete(undefined)
    })
  }

  const selectAa = (enabled: boolean): void => {
    setAaStatus('saving')
    void run('select-aa', async () => {
      try {
        if (!api.selectAa) throw new Error('AA selection is unavailable')
        const response = await api.selectAa(enabled)
        setView(current => current === undefined ? current : {
          ...current, aa: { requested: enabled, effective: current.aa?.effective ?? false },
        })
        setAaStatus('saved')
        if (response.restartRequired) requestRestart()
        else setView(await refreshView())
      } catch (cause) {
        setAaStatus('failed')
        throw cause
      }
    })
  }

  const selectMarket = (provider: DesktopMarketProvider): void => {
    void run('select-market', async () => {
      const response = await api.selectMarket(provider)
      setView(current => current === undefined ? current : {
        ...current,
        market: { requested: provider, effective: current.market.effective, legacyDefaulted: false },
      })
      if (response.restartRequired) requestRestart()
      else setView(await refreshView())
    })
  }

  const openBrowser = (event: React.MouseEvent<HTMLAnchorElement>, url: string): void => {
    if (!api.openBrowser) return
    event.preventDefault()
    void runPreference(() => api.openBrowser!(url))
  }

  const setMode = (next: DesktopShellSettings['mode']): void => {
    void run('mode', async () => {
      await persistMode(next)
      requestRestart()
    })
  }

  const setMaterial = (next: string): void => {
    void runPreference(async () => {
      if (platform === 'darwin') {
        if (next !== 'off' && next !== 'transparent') {
          throw new Error(`dsh-plugin-desktop: invalid macOS material ${JSON.stringify(next)}`)
        }
        await desktopSettings.set('macosMaterial', next)
      } else if (platform === 'linux') {
        if (next !== 'off' && next !== 'transparent') {
          throw new Error(`dsh-plugin-desktop: invalid Linux material ${JSON.stringify(next)}`)
        }
        await desktopSettings.set('linuxMaterial', next)
      }
      if (capabilities?.materialRequiresRestart !== false) requestRestart()
    })
  }

  const setNotification = (field: keyof DesktopNotificationSettings, checked: boolean): void => {
    void runPreference(async () => { await notificationSettings.set(field, checked) })
  }

  // The interactive update flow owns its own native dialogs and downloads, so it
  // stays outside the settings-scope busy state and reports only its own failures.
  const runUpdateCheck = (): void => {
    setUpdateCheck('checking')
    void api.checkForUpdates()
      .then(() => { setUpdateCheck('idle') })
      .catch(() => { setUpdateCheck('failed') })
  }

  const setBrowserAccess = (checked: boolean): void => {
    void runPreference(async () => {
      if (checked) {
        if (!desktopBrowserAccessAvailable(mode)) return
        await persistDesktopBrowserAccessHot(desktopSettings, true, configuredNetworkExposure, refreshView)
        return
      }
      await persistDesktopBrowserAccessHot(desktopSettings, false, configuredNetworkExposure, refreshView)
    })
  }

  const setNetworkExposure = (exposure: DesktopShellSettings['networkExposure']): void => {
    void runPreference(async () => {
      if (exposure === 'lan' && (!desktopBrowserAccessAvailable(mode) || !browserAccess)) return
      await persistDesktopNetworkExposureHot(desktopSettings, exposure, refreshView)
    })
  }

  return {
    t, api, platform, version, desktopSettings, capabilities, browserActions, presentationRows, tabSections, desktop,
    notifications, tabsId, tab, setTab, view, profileName, setProfileName, busy, loadFailed, operationFailed,
    aaStatus, restart, pendingProfileDelete, setPendingProfileDelete, confirmLan, setConfirmLan, sidebarFooterOpen,
    setSidebarFooterOpen, sidebarFooterRegionId, notificationsOpen, setNotificationsOpen, notificationsRegionId,
    updateCheck, load, runPreference, profileBusy, settingsWritable, notificationsWritable, browserAccess, mode,
    networkExposure, notificationValue, createProfile, selectProfile, deleteProfile, selectAa, selectMarket,
    openBrowser, setMode, setMaterial, setNotification, runUpdateCheck, setBrowserAccess, setNetworkExposure,
  }
}

/** What the Desktop settings tabs read from the page state. */
export type DesktopSettingsModel = ReturnType<typeof useDesktopSettingsSection>
