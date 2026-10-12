import { expect, it, vi } from 'vitest'
const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(async () => ({ languages: ['zh-Hans-CN'], preference: null })), send: vi.fn() },
}))
vi.mock('electron', () => electron)
import { syncNativeLocale } from '../src/preload-locale.ts'
import { IPC } from '../src/ipc.ts'

it('does not publish the English HTML placeholder before the official locale service initializes', async () => {
  syncNativeLocale()
  expect(electron.ipcRenderer.send).not.toHaveBeenCalled()
  const [name, bridge] = electron.contextBridge.exposeInMainWorld.mock.calls[0]!
  expect(name).toBe('__DSH_LOCALE__')
  await expect(bridge.read()).resolves.toEqual({ languages: ['zh-Hans-CN'], preference: null })
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC.localeRead)
  expect(electron.ipcRenderer.send).not.toHaveBeenCalled()
  bridge.onChange('zh')
  expect(electron.ipcRenderer.send).toHaveBeenCalledExactlyOnceWith(IPC.locale, 'zh')
})
