/**
 * Workspace directory selection in the Desktop window, aligned with upstream Desktop.
 *
 * Next hands every sampled LAN address to the Host as a trusted authority so LAN access
 * can be switched on later without a Host restart. Upstream's adaptive `directory-picker`
 * row reads that trust as "remote browsers may be present" and mounts the in-app browsing
 * panel for every browser it serves. Upstream Desktop declares no trusted hosts, so its
 * window always receives the native chooser. This occupant restores that behaviour for the
 * Desktop window alone: it shadows whichever flow the Host mounted (registered at the
 * default priority 0; the lowest live entry of a single hole renders) with a renderless
 * driver over the preload bridge, so the system folder dialog opens immediately. Ordinary
 * browsers reached through local or LAN access have no bridge and keep the Host's panel.
 *
 * The driver mirrors upstream `@deepseek-ai/dsh-client-ui-directory-picker-native` (MIT),
 * whose published Loader entry registers only at the default priority.
 */
import { useEffect, useRef, type ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

/** Preload bridge of the Desktop document; the official native flow consumes the same name. */
export const DESKTOP_DIRECTORY_PICKER_GLOBAL = '__DSH_DIRECTORY_PICKER__'
/** The ui-workspace directory-flow holes: the conversation empty-state picker and the sidebar browser. */
export const DIRECTORY_FLOW_HOLES = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'] as const
/** Below the Host-mounted occupant's default 0: the lowest live entry of a single hole renders. */
export const DESKTOP_DIRECTORY_FLOW_PRIORITY = -1

/** The Desktop preload bridge: one system folder dialog per call, `null` when dismissed. */
export interface DesktopDirectoryPicker {
  pick(): Promise<string | null>
}

/** Injected face of the flow occupant: the bridge call bound in the registration closure. */
export interface NativeDirectoryFlowInjected {
  pick: () => Promise<string | null>
}

/**
 * Read the Desktop preload bridge; absent in ordinary browsers and in the shell window.
 * @param target - Global object to read (the window in production).
 * @returns The bridge when it exposes `pick`, otherwise undefined.
 */
export function desktopDirectoryPicker(target: object = globalThis): DesktopDirectoryPicker | undefined {
  const bridge = (target as Record<string, unknown>)[DESKTOP_DIRECTORY_PICKER_GLOBAL]
  if (typeof bridge !== 'object' || bridge === null) return undefined
  const pick = (bridge as { pick?: unknown }).pick
  if (typeof pick !== 'function') return undefined
  return { pick: () => (pick as () => Promise<string | null>).call(bridge) }
}

/**
 * Renderless flow occupant: each rising `open` edge runs exactly one pick and reports
 * exactly one outcome. The armed ref guards re-renders (busy flips, handler identity
 * changes, a re-created injected face) from launching a second dialog; the owner
 * withdrawing `open` re-arms the next request. Outcomes report through the owner's latest
 * handlers, and an unmounted instance discards its settlement wholesale: the dialog has no
 * abort, so its late answer lands nowhere instead of adopting a path for a dead occupant.
 * @param props - Owner conversation plus the injected pick call.
 * @returns Nothing; the system dialog renders on the host display.
 */
export function NativeDirectoryFlow(props: DirectoryFlowOwnerProps & NativeDirectoryFlowInjected): ReactElement | null {
  const { open, pick } = props
  const armed = useRef(false)
  const outcome = useRef(props)
  outcome.current = props
  const alive = useRef(true)
  useEffect(() => {
    // StrictMode's development replay runs the cleanup once before the real lifetime.
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    if (!open) {
      armed.current = false
      return
    }
    if (armed.current) return
    armed.current = true
    pick().then(
      (path) => {
        if (!alive.current) return
        if (path === null) outcome.current.onCancel(); else outcome.current.onPicked(path)
      },
      (reason: unknown) => {
        if (!alive.current) return
        outcome.current.onError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }, [open, pick])
  return null
}

/**
 * Shadow both directory-flow holes with the Desktop occupant. Both declarations must be
 * live before the pair installs; the generator makes the two registrations one effect, so
 * a conflict in the second hole rolls the first back instead of leaving a partial mix.
 * @param ctx - Client root context carrying the slot registry.
 * @param picker - The Desktop preload bridge.
 */
export function registerDesktopDirectoryPicker(ctx: Context, picker: DesktopDirectoryPicker): void {
  const injected = (): NativeDirectoryFlowInjected => ({ pick: () => picker.pick() })
  const [hero, sidebar] = DIRECTORY_FLOW_HOLES
  ctx.slots.inject(hero, () => ctx.slots.inject(sidebar, function* () {
    yield ctx.slots.register({ name: hero, inject: injected, priority: DESKTOP_DIRECTORY_FLOW_PRIORITY }, NativeDirectoryFlow)
    yield ctx.slots.register({ name: sidebar, inject: injected, priority: DESKTOP_DIRECTORY_FLOW_PRIORITY }, NativeDirectoryFlow)
  }))
}
