import { useEffect, useSyncExternalStore } from 'react'
import type { DesktopState } from '../desktop-contract.ts'
import type { NextSettingsAdapter } from './settings-adapter.ts'

export function useDesktopState(adapter: NextSettingsAdapter): DesktopState | undefined {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot)
  useEffect(() => {
    void adapter.refresh().catch(() => {})
    const timer = setInterval(() => { if (!document.hidden) void adapter.refresh().catch(() => {}) }, 2000)
    return () => clearInterval(timer)
  }, [adapter])
  return state
}
