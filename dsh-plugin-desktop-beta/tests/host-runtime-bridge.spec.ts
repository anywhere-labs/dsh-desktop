import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'
import { bindNativeRuntime, createHostRuntime, runtimeSnapshot } from '../src/host-runtime-bridge.ts'
import type { DesktopRuntime, DesktopShellSpec, DesktopTrayItem } from '../src/runtime.ts'

it('preserves the Web URL and authentication while projecting shell and tray callbacks', async () => {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  })) as [HostRpc, HostRpc]
  let shell!: DesktopShellSpec
  let tray!: DesktopTrayItem
  const disposeShell = vi.fn(async () => {})
  const disposeTray = vi.fn()
  const native = {
    platform: 'win32', windowsBuild: 22631, locale: 'en',
    updates: { isPackaged: true, canDownload: true, currentVersion: '2.0.7-beta.1', statePath: '/tmp/update',
      request: vi.fn(async () => new Response('{"version":"2.0.8-beta.1"}', { headers: { 'x-test': 'yes' } })),
    },
    schedule: (value: DesktopShellSpec) => { shell = value; return disposeShell },
    registerTrayItem: (value: DesktopTrayItem) => { tray = value; return { refresh() {}, dispose: disposeTray } },
  } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    let language: 'zh' | undefined
    const mode = vi.fn(async () => {})
    const invoke = vi.fn(async () => {})
    const spec = { url: 'http://127.0.0.1:1234/?dsh-desktop-mode=advanced',
      authenticationUrl: 'http://127.0.0.1:1234/?token=fixture',
      rendererAccessHeader: { name: 'x-dsh-desktop-renderer', value: 'fixture' },
      readLocalePreference: () => language, readThemeSource: () => 'dark',
      requestQuit() {}, requestModeChange: mode,
    } as unknown as DesktopShellSpec
    spec.readRemoteControl = vi.fn(async () => false)
    spec.enableRemoteControl = vi.fn(async () => {})
    const stopShell = runtime.schedule(spec)
    runtime.registerTrayItem({ group: 'tools', order: 1, label: () => 'Plugin action', invoke,
      submenu: () => [{ label: () => 'Child', invoke }] })
    language = 'zh'
    await runtime.mountScheduled()
    expect(await shell.readRemoteControl?.()).toBe(false)
    await shell.enableRemoteControl?.()
    expect(spec.enableRemoteControl).toHaveBeenCalledTimes(1)
    expect(shell.url).toBe(spec.url)
    expect(shell.authenticationUrl).toBe(spec.authenticationUrl)
    expect(shell.rendererAccessHeader).toEqual(spec.rendererAccessHeader)
    expect(shell.readLocalePreference()).toBe('zh')
    await shell.requestModeChange('extended')
    expect(mode).toHaveBeenCalledWith('extended')
    expect(tray.label()).toBe('Plugin action')
    await tray.submenu?.()[0]?.invoke()
    expect(invoke).toHaveBeenCalledOnce()
    const response = await runtime.updates.request('https://example.invalid', { headers: { accept: 'application/json' } })
    expect(response.headers.get('x-test')).toBe('yes')
    expect(await response.json()).toEqual({ version: '2.0.8-beta.1' })
    await stopShell()
    expect(disposeShell).toHaveBeenCalledOnce()
  } finally { await release(); parent.close(); child.close(); port1.close(); port2.close() }
})

it('proxies native guest browser views and forwards their events to Host subscribers', async () => {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: value => port.postMessage(value),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  })) as [HostRpc, HostRpc]
  const listeners = new Set<(event: unknown) => void>()
  const createView = vi.fn(async () => ({ id: 'tab-1' }))
  const setBounds = vi.fn(async () => {})
  const command = vi.fn(async () => ({ frameId: 'frame-1' }))
  const native = {
    platform: 'darwin', windowsBuild: undefined, locale: 'en',
    updates: { isPackaged: true, canDownload: true, currentVersion: '2.0.7', statePath: '/tmp/update' },
    nativeBrowser: {
      version: 1,
      createView,
      setBounds,
      setZoom: vi.fn(async () => {}),
      setVisible: vi.fn(async () => {}),
      focus: vi.fn(async () => {}),
      navigate: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      closeOwner: vi.fn(async () => {}),
      command,
      googleLoginStatus: vi.fn(async () => ({ phase: 'idle' })),
      startGoogleLogin: vi.fn(async () => ({ phase: 'launching' })),
      cancelGoogleLogin: vi.fn(async () => {}),
      subscribe: (listener: (event: unknown) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  } as unknown as DesktopRuntime
  const release = bindNativeRuntime(parent, native)
  try {
    const runtime = createHostRuntime(child, runtimeSnapshot(native))
    const events: unknown[] = []
    const unsubscribe = runtime.nativeBrowser.subscribe(event => { events.push(event) })
    expect(runtime.nativeBrowser.version).toBe(1)
    await runtime.nativeBrowser.createView({ id: 'tab-1', owner: 'session-a', allowOrigins: ['https://example.com'] })
    expect(createView).toHaveBeenCalledWith({ id: 'tab-1', owner: 'session-a', allowOrigins: ['https://example.com'] })
    await runtime.nativeBrowser.setBounds('tab-1', { x: 1, y: 2, width: 3, height: 4 })
    expect(setBounds).toHaveBeenCalledWith('tab-1', { x: 1, y: 2, width: 3, height: 4 })
    await expect(runtime.nativeBrowser.command('tab-1', 'Page.enable')).resolves.toEqual({ frameId: 'frame-1' })
    expect(command).toHaveBeenCalledWith('tab-1', 'Page.enable', undefined)
    await expect(runtime.nativeBrowser.startGoogleLogin()).resolves.toEqual({ phase: 'launching' })
    await expect(runtime.nativeBrowser.googleLoginStatus()).resolves.toEqual({ phase: 'idle' })
    await runtime.nativeBrowser.cancelGoogleLogin()

    for (const listener of listeners) listener({ type: 'navigated', id: 'tab-1', url: 'https://example.com/' })
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    expect(events[0]).toEqual({ type: 'navigated', id: 'tab-1', url: 'https://example.com/' })

    unsubscribe()
    await vi.waitFor(() => { expect(listeners.size).toBe(0) })
    for (const listener of listeners) listener({ type: 'title', id: 'tab-1', title: 'Example' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events).toHaveLength(1)
  } finally { await release(); parent.close(); child.close(); port1.close(); port2.close() }
})
