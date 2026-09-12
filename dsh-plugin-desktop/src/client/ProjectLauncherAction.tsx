import { useEffect, useState, type ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { DESKTOP_ENVIRONMENT_STORAGE_KEY } from './environment.ts'
import { withDesktopNavigationMarkers } from './workbench-navigation.ts'

type Props = PropsRuntime<'sidebar.footer.action'>
type State = '可启动' | '启动中' | '运行中' | '不可用'

interface ProjectLauncherProps extends Props {
  id: string
  label: string
  icon: string
  path: string
  runtimePath?: string
  tone: string
}

export function ProjectLauncherAction({ wide, id, label, icon, path, runtimePath, tone }: ProjectLauncherProps): ReactElement {
  const [state, setState] = useState<State>(runtimePath ? '启动中' : '可启动')
  useEffect(() => {
    if (!runtimePath) return
    let active = true
    fetch(runtimePath, { credentials: 'same-origin' }).then(async response => {
      const value = await response.json() as { state?: string }
      if (!active) return
      setState(value.state === 'READY' ? '运行中' : value.state === 'FAILED' ? '不可用' : '启动中')
    }).catch(() => { if (active) setState('可启动') })
    return () => { active = false }
  }, [runtimePath])
  const start = () => {
    setState('启动中')
    let currentUrl = window.location.href
    try {
      const storedSearch = window.sessionStorage.getItem(DESKTOP_ENVIRONMENT_STORAGE_KEY)
      if (storedSearch && !window.location.search.includes('dsh-desktop-')) {
        const current = new URL(currentUrl)
        current.search = storedSearch
        currentUrl = current.href
      }
    } catch { /* Fall back to the current URL when session storage is unavailable. */ }
    window.location.assign(withDesktopNavigationMarkers(path, currentUrl))
  }
  return <button type="button" className={`dshWorkbenchNavAction dshProjectLauncher ${id}`} aria-label={`${label}，${state}`} title={`${label} · ${state}`} onClick={start}>
    <span className="dshProjectLauncherIcon" style={{ color: tone }} aria-hidden>{icon}</span>
    {wide ? <span className="dshProjectLauncherCopy"><span>{label}</span><small><i data-state={state} />{state}</small></span> : null}
  </button>
}
