import { expect, it, vi } from 'vitest'
import { desktopMenu } from '../src/desktop-menu.ts'
import { DEFAULT_PREFERENCES, type DesktopState } from '../src/desktop-contract.ts'
import { relaunchArguments } from '../src/relaunch.ts'

const state: DesktopState = {
  selected: 'desktop', profiles: ['desktop', 'work', 'broken'], unavailableProfiles: ['broken'],
  preferences: { ...DEFAULT_PREFERENCES }, features: { market: true, remoteControl: false },
  phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture', platform: 'darwin',
  version: '0.1.0-dev.0', trayAvailable: true, notificationsAvailable: true, windowsMicaSupported: false,
  browserUrl: null, lan: null, checkpoint: null, logs: '',
}

it('keeps the original tray tool order, direct recovery actions and Profile creation without unavailable placeholders', () => {
  const run = vi.fn()
  const show = vi.fn()
  const menu = desktopMenu(state, 'zh-CN', show, run)
  expect(menu.filter(item => item.type !== 'separator').map(item => item.label)).toEqual([
    '打开 DSH NEXT', '重新加载界面', '打开 DSH 终端', '导出诊断信息…', '进入安全模式…',
    'Profile：desktop', '设置…', '恢复助手…', '退出',
  ])
  const profiles = menu.find(item => item.label === 'Profile：desktop')!.submenu
  if (!Array.isArray(profiles)) throw new Error('Missing Profile submenu')
  expect(profiles.find(item => item.label === 'broken（不可用于桌面端）')!.enabled).toBe(false)
  ;(profiles.find(item => item.label === 'desktop')!.click as () => void)()
  expect(run).not.toHaveBeenCalled()
  ;(profiles.find(item => item.label === 'work')!.click as () => void)()
  expect(run).toHaveBeenLastCalledWith({ type: 'switch', name: 'work' })
  ;(profiles.find(item => item.label === '新建 Profile…')!.click as () => void)()
  expect(run).toHaveBeenLastCalledWith({ type: 'controls', page: 'create-profile' })
  ;(menu.find(item => item.label === '进入安全模式…')!.click as () => void)()
  expect(run).toHaveBeenLastCalledWith({ type: 'safe-mode' })
  expect(menu.find(item => item.label === '设置…')!.accelerator).toBe('CmdOrCtrl+,')
  expect(menu.at(-1)!.accelerator).toBe('CmdOrCtrl+Q')
})

it('keeps valid escape routes during failure or safe mode and only advertises supported tools', () => {
  const menu = desktopMenu({ ...state, safeMode: true, busy: true, phase: 'error', platform: 'linux' }, 'en', vi.fn(), vi.fn())
  expect(menu.some(item => item.label === 'Open DSH Terminal')).toBe(false)
  expect(menu.find(item => item.label === 'Reload Interface')!.enabled).toBe(false)
  expect(menu.find(item => item.label === 'Exit Safe Mode and Restart…')!.enabled).toBe(false)
  expect(menu.find(item => item.label === 'Settings…')!.enabled).toBe(true)
  expect(menu.at(-1)!.enabled).not.toBe(false)
  expect(desktopMenu({ ...state, browserUrl: 'http://127.0.0.1:1234' }, 'en', vi.fn(), vi.fn()).some(item => item.label === 'Open in Browser')).toBe(true)
})

it('preserves application arguments while replacing one-shot launch modes', () => {
  const argv = ['/fixture/lib/main.js', '--next-recovery', '--next-safe-mode', '--next-onboarding', '--example=value']
  expect(relaunchArguments(argv, true, true, true)).toEqual(['/fixture/lib/main.js', '--example=value', '--next-recovery'])
  expect(relaunchArguments(argv, false, true, true)).toEqual(['/fixture/lib/main.js', '--example=value', '--next-safe-mode'])
  expect(relaunchArguments(argv, false, false, true)).toEqual(['/fixture/lib/main.js', '--example=value', '--next-onboarding'])
  expect(relaunchArguments(argv, false, false)).toEqual(['/fixture/lib/main.js', '--example=value'])
})
