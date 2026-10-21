import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_HOST_PATHS_BRIDGE,
  type DesktopHostPathBridge,
} from '../src/file-path-bridge-contract.ts'
import { DESKTOP_NATIVE_DIRECTORY_PICKER_CHANNEL } from '../src/directory-picker-contract.ts'
import {
  DESKTOP_RENDERER_ACTION_CHANNEL,
  DESKTOP_RENDERER_ACTIONS_BRIDGE,
  type DesktopRendererActionsBridge,
} from '../src/renderer-actions-contract.ts'
import { SETUP_ONBOARDING_CHANNEL } from '../src/setup-onboarding-bridge.ts'

const electron = vi.hoisted(() => {
  const exposed = new Map<string, unknown>()
  const hostPaths = new Map<File, string>()
  return {
    exposed,
    hostPaths,
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, api: unknown) => {
        exposed.set(key, api)
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => null as unknown),
    },
    webUtils: {
      getPathForFile: vi.fn((file: File) => hostPaths.get(file) ?? ''),
    },
  }
})

vi.mock('electron', () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer,
  webUtils: electron.webUtils,
}))

describe('Desktop renderer preload bridges', () => {
  beforeEach(() => {
    electron.exposed.clear()
    electron.hostPaths.clear()
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the upstream __DSH_HOST_PATHS__ bridge so dropped folders and files resolve to host paths', async () => {
    await import('../src/preload.ts')

    expect(DESKTOP_HOST_PATHS_BRIDGE).toBe('__DSH_HOST_PATHS__')
    const bridge = electron.exposed.get(DESKTOP_HOST_PATHS_BRIDGE) as DesktopHostPathBridge | undefined
    expect(bridge?.pathFor).toEqual(expect.any(Function))

    const droppedFolder = { name: 'workspace-folder' } as File
    const pastedImage = { name: 'pasted.png' } as File
    electron.hostPaths.set(droppedFolder, '/Users/me/workspace-folder')

    expect(bridge?.pathFor(droppedFolder)).toBe('/Users/me/workspace-folder')
    expect(electron.webUtils.getPathForFile).toHaveBeenCalledWith(droppedFolder)
    expect(bridge?.pathFor(pastedImage)).toBe('')
    expect(electron.webUtils.getPathForFile).toHaveBeenCalledWith(pastedImage)
    expect(electron.exposed.has('__DSH_DESKTOP_FILE_PATH__')).toBe(false)
  })

  it('exposes renderer actions, setup onboarding, and the macOS directory picker bridge', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    await import('../src/preload.ts')

    const actions = electron.exposed.get(DESKTOP_RENDERER_ACTIONS_BRIDGE) as DesktopRendererActionsBridge | undefined
    await actions?.invoke('terminal')
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_RENDERER_ACTION_CHANNEL, 'terminal')

    const picker = electron.exposed.get('__DSH_DIRECTORY_PICKER__') as { pick(): Promise<string | null> } | undefined
    await picker?.pick()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_NATIVE_DIRECTORY_PICKER_CHANNEL)

    expect(electron.exposed.get('dshDesktop')).toEqual({ protocolVersion: 1 })

    const setup = electron.exposed.get('dshDesktopSetup') as {
      read(): Promise<unknown>
      dismissAccount(profile: string): Promise<unknown>
      applyPending(profile: string): Promise<unknown>
      finish(profile: string, selection?: unknown): Promise<unknown>
    } | undefined
    await setup?.read()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(SETUP_ONBOARDING_CHANNEL, { action: 'read' })
  })

  it('exposes the directory picker bridge on win32 too (TinTin cache-directory picker)', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    await import('../src/preload.ts')

    const picker = electron.exposed.get('__DSH_DIRECTORY_PICKER__') as { pick(): Promise<string | null> } | undefined
    expect(picker?.pick).toEqual(expect.any(Function))
    await picker?.pick()
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_NATIVE_DIRECTORY_PICKER_CHANNEL)
  })

  it('exposes exactly the declared bridge surface (scripts/bridge-surface.json snapshot)', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    await import('../src/preload.ts')

    // 全量快照：任何新增/删除/改名桥都必须显式更新 scripts/bridge-surface.json，
    // 本用例与对账 gate（verify-bridge-surface.mjs）共用同一份单一事实源。
    const { readFileSync } = await import('node:fs')
    const manifest = JSON.parse(
      readFileSync(new URL('../../../scripts/bridge-surface.json', import.meta.url), 'utf8'),
    ) as { exposure: { preload: string[] } }
    expect([...electron.exposed.keys()].sort()).toEqual([...manifest.exposure.preload].sort())
  })
})
