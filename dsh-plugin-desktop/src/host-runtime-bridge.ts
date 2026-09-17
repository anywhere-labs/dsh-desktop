/** Native capability adapters; frontend HTTP and WebSocket connections are unchanged. */
import type { DesktopNativeBrowserEvent } from './browser-view-service.ts'
import type { DesktopRuntime, DesktopShellSpec, DesktopTrayItem, DesktopTrayItemRegistration, DesktopUpdateAdapter } from './runtime.ts'
import { HostRpc } from './host-rpc.ts'

export type RuntimeSnapshot = Pick<DesktopRuntime, 'platform' | 'windowsBuild' | 'locale'> & {
  updates: Omit<DesktopUpdateAdapter, 'request' | 'confirmDownload' | 'showManualCheckResult' | 'downloadAndOpen' | 'notify'>
}
export function runtimeSnapshot(runtime: DesktopRuntime): RuntimeSnapshot {
  const { isPackaged, canDownload, currentVersion, releaseChannel, statePath, installationId } = runtime.updates
  return { platform: runtime.platform, windowsBuild: runtime.windowsBuild, locale: runtime.locale,
    updates: { isPackaged, canDownload, currentVersion, statePath,
      ...(releaseChannel ? { releaseChannel } : {}), ...(installationId ? { installationId } : {}) } }
}

/** Keep functions in their owning process and send snapshots plus opaque callback IDs. */
export function createHostRuntime(rpc: HostRpc, snapshot: RuntimeSnapshot): DesktopRuntime {
  let sequence = 0
  let locale = snapshot.locale
  const calls = new Set<Promise<unknown>>()
  const setup: Promise<unknown>[] = []
  let booting = true
  const trayPublishers = new Map<string, () => void>()
  const trackSetup = (task: Promise<unknown>) => { if (booting) setup.push(task) }
  const shellSpecs = new Map<string, DesktopShellSpec>()
  const send = <T = void>(method: string, args: unknown[] = [], signal?: AbortSignal): Promise<T> => {
    const interactive = ['update:confirmDownload', 'update:showManualCheckResult', 'update:downloadAndOpen',
      'native:pickDirectory', 'native:exportDiagnostics', 'browser:startGoogleLogin'].includes(method)
    const task = rpc.call<T>(method, args, signal, interactive ? 0 : undefined)
    calls.add(task)
    // Report fire-and-forget failures without creating an unhandled rejection.
    void task.then(() => calls.delete(task), error => { calls.delete(task); process.stderr.write(`${String(error)}\n`) })
    return task
  }
  const callbacks = (handlers: Record<string, (...args: any[]) => unknown>) => {
    const id = `callback:${++sequence}`
    const releases = Object.entries(handlers).map(([name, handler]) => rpc.handle(`${id}:${name}`, args => handler(...args)))
    return { id, release: () => releases.forEach(dispose => dispose()) }
  }
  const runtime: DesktopRuntime = {
    platform: snapshot.platform, windowsBuild: snapshot.windowsBuild,
    get locale() { return locale },
    nativeBrowser: {
      version: 1,
      createView: options => send('browser:createView', [options]),
      setBounds: (id, bounds) => send('browser:setBounds', [id, bounds]),
      setZoom: (id, factor) => send('browser:setZoom', [id, factor]),
      setVisible: (id, visible) => send('browser:setVisible', [id, visible]),
      focus: id => send('browser:focus', [id]),
      navigate: (id, url) => send('browser:navigate', [id, url]),
      close: id => send('browser:close', [id]),
      closeOwner: owner => send('browser:closeOwner', [owner]),
      command: (id, method, params) => send('browser:command', [id, method, params]),
      googleLoginStatus: () => send('browser:googleLoginStatus'),
      startGoogleLogin: () => send('browser:startGoogleLogin'),
      cancelGoogleLogin: () => send('browser:cancelGoogleLogin'),
      openInChrome: urls => send('browser:openInChrome', [urls]),
      subscribe(listener) {
        const callback = callbacks({ event: (event: DesktopNativeBrowserEvent) => listener(event) })
        void send('browser:subscribe', [callback.id]).catch((cause: unknown) => {
          callback.release()
          process.stderr.write(`${String(cause)}\n`)
        })
        let active = true
        return () => {
          if (!active) return
          active = false
          callback.release()
          void send('browser:unsubscribe', [callback.id])
        }
      },
    },
    updates: {
      ...snapshot.updates,
      request: async (url, init) => {
        const { signal, ...options } = init
        const response = await send<{ body: string; status: number; headers: [string, string][] }>('update:request',
          [url, { ...options, headers: [...new Headers(init.headers).entries()] }], signal ?? undefined)
        return new Response([204, 205, 304].includes(response.status) ? null : response.body, { status: response.status, headers: response.headers })
      },
      confirmDownload: (version, channel) => send('update:confirmDownload', [version, channel]),
      showManualCheckResult: result => send('update:showManualCheckResult', [result]),
      downloadAndOpen: (version, signal, channel) => send('update:downloadAndOpen', [version, channel], signal),
      notify: notification => { void send('update:notify', [notification]) },
    },
    schedule(spec) {
      const callback = callbacks({ quit: spec.requestQuit, mode: spec.requestModeChange,
        ...(spec.readRemoteControl ? { remoteRead: spec.readRemoteControl } : {}),
        ...(spec.enableRemoteControl ? { remoteEnable: spec.enableRemoteControl } : {}),
      })
      const { readLocalePreference, readThemeSource, requestQuit: _quit, requestModeChange: _mode, readRemoteControl: _remoteRead, enableRemoteControl: _remoteEnable, ...data } = spec
      shellSpecs.set(callback.id, spec)
      trackSetup(send('shell:schedule', [callback.id, data, readLocalePreference(), readThemeSource(), Boolean(spec.readRemoteControl && spec.enableRemoteControl)]))
      return async () => { try { await send('shell:dispose', [callback.id]) } finally { shellSpecs.delete(callback.id); callback.release() } }
    },
    // The parent mounts only after Host boot and this barrier finish.
    async mountScheduled() {
      await Promise.all(setup)
      setup.length = 0
      booting = false
      for (const [id, spec] of shellSpecs) {
        await send('shell:preferences', [id, spec.readLocalePreference(), spec.readThemeSource()])
      }
    },
    registerTrayItem(item) {
      const id = `tray:${++sequence}`
      let releases: (() => void)[] = []
      const publish = () => {
        for (const release of releases) release()
        releases = []
        const project = (entry: DesktopTrayItem | NonNullable<ReturnType<NonNullable<DesktopTrayItem['submenu']>>>[number], index: number) => {
          const method = `${id}:${index}`
          releases.push(rpc.handle(method, () => entry.invoke()))
          return { label: entry.label(), enabled: entry.enabled?.() ?? true,
            checked: 'checked' in entry ? entry.checked?.() ?? false : false, type: 'type' in entry ? entry.type : undefined, method }
        }
        trackSetup(send('tray:set', [id, { ...project(item, -1), group: item.group, order: item.order, id: item.id,
          submenu: item.submenu?.().map((entry, index) => project(entry, index)) }]))
      }
      trayPublishers.set(id, publish)
      publish()
      return { refresh: publish, dispose() { trayPublishers.delete(id); releases.forEach(release => release()); void send('tray:dispose', [id]) } }
    },
    show() { void send('native:show') },
    notifyAttention(value) { void send('native:notifyAttention', [value]) },
    openTerminal() { void send('native:openTerminal') },
    reloadRenderer() { void send('native:reloadRenderer') },
    toggleDeveloperTools() { void send('native:toggleDeveloperTools') },
    exportDiagnostics: () => send('native:exportDiagnostics'),
    pickDirectory: () => send('native:pickDirectory'),
    validateDirectory: path => send('native:validateDirectory', [path]),
    reportRendererBoot: report => { void send('native:reportRendererBoot', [report]) },
    setLocalePreference(preference) { locale = preference ?? snapshot.locale; trayPublishers.forEach(publish => publish()); void send('native:setLocalePreference', [preference]) },
    setThemeSource(source) { void send('native:setThemeSource', [source]) },
    requestRestart: () => send('native:requestRestart'),
    requestRecoveryRestart: () => send('native:requestRecoveryRestart'),
    prepareToQuit() { void send('native:prepareToQuit') },
    openProfileCreateWindow(options) {
      const callback = callbacks({
        submit: async name => { await options.onSubmit(name); callback.release() },
        cancel: () => { options.onCancel?.(); callback.release() },
      })
      void send('native:openProfileCreateWindow', [callback.id])
    },
  }
  return runtime
}

/** Install only the declared native surface; never expose arbitrary Electron APIs. */
export function bindNativeRuntime(rpc: HostRpc, runtime: DesktopRuntime): () => Promise<void> {
  const trays = new Map<string, DesktopTrayItemRegistration>()
  const shells = new Map<string, () => Promise<void>>()
  const preferences = new Map<string, { locale: any; theme: any }>()
  const browserSubscriptions = new Map<string, () => void>()
  const releases: (() => void)[] = []
  const handle = (name: string, fn: (args: any[], signal: AbortSignal) => unknown) => { releases.push(rpc.handle(name, fn)) }
  const callback = (method: string, args: unknown[] = []) => rpc.call(method, args)
  const report = (promise: Promise<unknown>) => { void promise.catch(error => process.stderr.write(`${String(error)}\n`)) }
  for (const method of ['show', 'notifyAttention', 'openTerminal', 'reloadRenderer', 'toggleDeveloperTools',
    'exportDiagnostics', 'pickDirectory', 'validateDirectory', 'reportRendererBoot', 'setLocalePreference',
    'setThemeSource', 'prepareToQuit'] as const) {
    handle(`native:${method}`, args => (runtime[method] as (...args: any[]) => unknown).apply(runtime, args))
  }
  // Acknowledge restart before teardown can close the channel used by this call.
  for (const method of ['requestRestart', 'requestRecoveryRestart'] as const) {
    handle(`native:${method}`, () => { setImmediate(() => report(runtime[method]())) })
  }
  handle('native:openProfileCreateWindow', ([id]) => runtime.openProfileCreateWindow({
    onSubmit: name => callback(`${id}:submit`, [name]), onCancel: () => report(callback(`${id}:cancel`)),
  }))
  handle('shell:schedule', ([id, data, locale, theme, remoteControl]) => {
    if (shells.has(id)) throw new Error('Duplicate Host shell')
    const state = { locale, theme }
    preferences.set(id, state)
    shells.set(id, runtime.schedule({ ...data,
      readLocalePreference: () => state.locale, readThemeSource: () => state.theme,
      requestQuit: code => report(callback(`${id}:quit`, [code])),
      requestModeChange: mode => callback(`${id}:mode`, [mode]),
      ...(remoteControl ? {
        readRemoteControl: () => callback(`${id}:remoteRead`),
        enableRemoteControl: () => callback(`${id}:remoteEnable`),
      } : {}),
    } as DesktopShellSpec))
  })
  handle('shell:preferences', ([id, locale, theme]) => {
    const state = preferences.get(id)
    if (!state) throw new Error('Host shell is unavailable')
    state.locale = locale; state.theme = theme
  })
  handle('shell:dispose', async ([id]) => { const dispose = shells.get(id); shells.delete(id); preferences.delete(id); await dispose?.() })
  handle('tray:set', ([id, data]) => {
    trays.get(id)?.dispose()
    const project = (entry: any) => ({ ...entry, label: () => entry.label, enabled: () => entry.enabled,
      checked: () => entry.checked, invoke: () => callback(entry.method) })
    trays.set(id, runtime.registerTrayItem({ ...project(data), submenu: data.submenu ? () => data.submenu.map(project) : undefined }))
  })
  handle('tray:dispose', ([id]) => { trays.get(id)?.dispose(); trays.delete(id) })
  handle('update:request', async ([url, init], signal) => {
    const response = await runtime.updates.request(url, { ...init, signal })
    return { body: await response.text(), status: response.status, headers: [...response.headers.entries()] }
  })
  handle('browser:createView', ([options]) => runtime.nativeBrowser.createView(options))
  handle('browser:setBounds', ([id, bounds]) => runtime.nativeBrowser.setBounds(id, bounds))
  handle('browser:setZoom', ([id, factor]) => runtime.nativeBrowser.setZoom(id, factor))
  handle('browser:setVisible', ([id, visible]) => runtime.nativeBrowser.setVisible(id, visible))
  handle('browser:focus', ([id]) => runtime.nativeBrowser.focus(id))
  handle('browser:navigate', ([id, url]) => runtime.nativeBrowser.navigate(id, url))
  handle('browser:close', ([id]) => runtime.nativeBrowser.close(id))
  handle('browser:closeOwner', ([owner]) => runtime.nativeBrowser.closeOwner(owner))
  handle('browser:command', ([id, method, params]) => runtime.nativeBrowser.command(id, method, params))
  handle('browser:googleLoginStatus', () => runtime.nativeBrowser.googleLoginStatus())
  handle('browser:startGoogleLogin', () => runtime.nativeBrowser.startGoogleLogin())
  handle('browser:cancelGoogleLogin', () => runtime.nativeBrowser.cancelGoogleLogin())
  handle('browser:openInChrome', ([urls]) => runtime.nativeBrowser.openInChrome(Array.isArray(urls) ? urls.map(String) : []))
  handle('browser:subscribe', ([id]) => {
    browserSubscriptions.get(id)?.()
    browserSubscriptions.set(id, runtime.nativeBrowser.subscribe(event => { report(callback(`${id}:event`, [event])) }))
  })
  handle('browser:unsubscribe', ([id]) => {
    browserSubscriptions.get(id)?.()
    browserSubscriptions.delete(id)
  })
  handle('update:confirmDownload', ([version, channel]) => runtime.updates.confirmDownload(version, channel))
  handle('update:showManualCheckResult', ([result]) => runtime.updates.showManualCheckResult(result))
  handle('update:downloadAndOpen', ([version, channel], signal) => runtime.updates.downloadAndOpen(version, signal, channel))
  handle('update:notify', ([value]) => runtime.updates.notify(value))
  return async () => {
    trays.forEach(tray => tray.dispose()); trays.clear()
    await Promise.all([...shells.values()].map(dispose => dispose())); shells.clear(); preferences.clear()
    browserSubscriptions.forEach(unsubscribe => { unsubscribe() }); browserSubscriptions.clear()
    releases.forEach(release => release())
  }
}
