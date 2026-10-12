import { expect, it, vi } from 'vitest'
import { NativePermissions, type PermissionPlatform } from '../src/native-permissions.ts'
import type { DesktopPermissionStatus } from '../src/permissions.ts'

function fixture(platform = 'darwin') {
  let status: DesktopPermissionStatus = 'not-determined'
  const native: PermissionPlatform = {
    platform, status: vi.fn(() => status), microphone: vi.fn(async () => { status = 'granted'; return true }),
    screen: vi.fn(async () => { status = 'granted' }), accessibility: vi.fn(async () => { status = 'granted' }), openSettings: vi.fn(async () => {}),
  }
  return { native, service: new NativePermissions(native), setStatus(value: DesktopPermissionStatus) { status = value } }
}

it('queries without prompting and requests only undecided macOS grants', async () => {
  const { service, native, setStatus } = fixture()
  expect(service.query('microphone')).toEqual({ permission: 'microphone', status: 'not-determined', canRequest: true, canOpenSettings: true })
  expect(native.microphone).not.toHaveBeenCalled()
  expect(native.screen).not.toHaveBeenCalled()
  expect((await service.request('microphone')).status).toBe('granted')
  await service.request('microphone')
  expect(native.microphone).toHaveBeenCalledOnce()
  for (const status of ['denied', 'restricted'] as const) {
    setStatus(status)
    expect(await service.request('screen')).toMatchObject({ status, canRequest: false, canOpenSettings: true })
    expect(native.screen).not.toHaveBeenCalled()
  }
  setStatus('unknown')
  expect((await service.request('accessibility')).status).toBe('granted')
  expect(native.accessibility).toHaveBeenCalledOnce()
})

it('coalesces concurrent requests and rereads external changes', async () => {
  const { service, native, setStatus } = fixture()
  let release!: () => void
  vi.mocked(native.screen).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const first = service.request('screen')
  const second = service.request('screen')
  expect(first).toBe(second)
  expect(native.screen).toHaveBeenCalledOnce()
  setStatus('denied'); release()
  expect((await first).status).toBe('denied')
  setStatus('granted')
  expect(service.query('screen').status).toBe('granted')
})

it('opens only fixed OS panes and does not fabricate unsupported platform grants', async () => {
  const mac = fixture()
  await mac.service.openSettings('accessibility')
  expect(mac.native.openSettings).toHaveBeenCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  expect(() => mac.service.query('https://example.com')).toThrow('Unsupported')
  const win = fixture('win32')
  win.setStatus('denied')
  expect(await win.service.request('microphone')).toMatchObject({ status: 'denied', canRequest: false })
  await win.service.openSettings('microphone')
  expect(win.native.openSettings).toHaveBeenCalledWith('ms-settings:privacy-microphone')
  expect(win.native.microphone).not.toHaveBeenCalled()
  const linux = fixture('linux')
  expect(await linux.service.request('screen')).toMatchObject({ status: 'unknown', canRequest: false, canOpenSettings: false })
  expect(linux.native.status).not.toHaveBeenCalled()
  await expect(linux.service.openSettings('screen')).rejects.toThrow('no Desktop permission settings shortcut')
})
