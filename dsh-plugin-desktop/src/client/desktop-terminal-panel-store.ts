/** Declared Client slot store: per-terminal command history, tracked directories, and rail filter drafts. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TerminalHistoryEntry } from './desktop-terminal-panel-history.ts'

/** Commands kept per terminal tab; the rail and the suggestion popup read the same bounded list. */
export const TERMINAL_PANEL_HISTORY_LIMIT = 300

/** Per-tab business data owned by the store seat; keyed by terminal content identity. */
export interface DesktopTerminalPanelStoreState {
  histories: Record<string, TerminalHistoryEntry[]>
  cwds: Record<string, string>
  homes: Record<string, string>
  filters: Record<string, string>
  nextHistoryId: number
}

type DesktopTerminalPanelStoreActions = {
  initTab: (draft: DesktopTerminalPanelStoreState, contentId: string, cwd: string, home: string) => void
  appendHistory: (draft: DesktopTerminalPanelStoreState, contentId: string, command: string) => void
  removeHistory: (draft: DesktopTerminalPanelStoreState, contentId: string, id: number) => void
  clearHistory: (draft: DesktopTerminalPanelStoreState, contentId: string) => void
  setCwd: (draft: DesktopTerminalPanelStoreState, contentId: string, cwd: string) => void
  setFilter: (draft: DesktopTerminalPanelStoreState, contentId: string, text: string) => void
  purgeTab: (draft: DesktopTerminalPanelStoreState, contentId: string) => void
}

/** Shared Client slot state for the terminal panel's per-terminal business data. */
export function createDesktopTerminalPanelStore(): EngineStoreHandle<DesktopTerminalPanelStoreState, DesktopTerminalPanelStoreActions> {
  return defineStore({
    persist: 'dsh-desktop-terminal-panel.v1.history',
    init: (): DesktopTerminalPanelStoreState => ({
      histories: {},
      cwds: {},
      homes: {},
      filters: {},
      nextHistoryId: 1,
    }),
    actions: {
      initTab: (draft, contentId, cwd, home) => {
        if (draft.cwds[contentId] === undefined && cwd !== '') draft.cwds[contentId] = cwd
        if (draft.homes[contentId] === undefined && home !== '') draft.homes[contentId] = home
      },
      appendHistory: (draft, contentId, command) => {
        const trimmed = command.trim()
        if (trimmed === '') return
        const list = draft.histories[contentId] ?? []
        // A consecutive repeat refreshes the timestamp instead of duplicating the row.
        const last = list[list.length - 1]
        if (last !== undefined && last.command === trimmed) list.splice(list.length - 1, 1)
        list.push({ id: draft.nextHistoryId++, command: trimmed, at: Date.now() })
        if (list.length > TERMINAL_PANEL_HISTORY_LIMIT) list.splice(0, list.length - TERMINAL_PANEL_HISTORY_LIMIT)
        draft.histories[contentId] = list
      },
      removeHistory: (draft, contentId, id) => {
        const list = draft.histories[contentId]
        if (list === undefined) return
        draft.histories[contentId] = list.filter(entry => entry.id !== id)
      },
      clearHistory: (draft, contentId) => { delete draft.histories[contentId] },
      setCwd: (draft, contentId, cwd) => { draft.cwds[contentId] = cwd },
      setFilter: (draft, contentId, text) => { draft.filters[contentId] = text },
      purgeTab: (draft, contentId) => {
        delete draft.histories[contentId]
        delete draft.cwds[contentId]
        delete draft.homes[contentId]
        delete draft.filters[contentId]
      },
    },
  })
}

export type DesktopTerminalPanelStore = ReturnType<typeof createDesktopTerminalPanelStore>
