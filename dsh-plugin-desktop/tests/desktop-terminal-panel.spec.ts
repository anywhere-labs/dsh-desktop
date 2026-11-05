import { afterEach, describe, expect, it, vi } from 'vitest'
import { collapseTerminalPath, homeDirectoryOf, resolveCdTarget } from '../src/client/desktop-terminal-panel-path.ts'
import {
  TerminalInputTracker,
  fuzzyScore,
  inlineSuggestion,
  rankHistoryEntries,
  type TerminalHistoryEntry,
} from '../src/client/desktop-terminal-panel-history.ts'
import { createDesktopTerminalPanelStore, TERMINAL_PANEL_HISTORY_LIMIT } from '../src/client/desktop-terminal-panel-store.ts'

// Mirror of the logcat suite: exercise the pure store actions without the
// runtime adapter's optional zustand dependency.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (spec: { init: () => unknown; actions: Record<string, unknown> }) => ({
    create: () => {
      let state: unknown = spec.init()
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, action]) => [name, (...args: unknown[]) => {
        const draft = structuredClone(state)
        ;(action as (draft: unknown, ...args: unknown[]) => void)(draft, ...args)
        state = draft
      }]))
      return { actions, getSnapshot: () => state }
    },
  }),
}))

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function entry(id: number, command: string, at: number): TerminalHistoryEntry {
  return { id, command, at }
}

describe('homeDirectoryOf', () => {
  it('recognizes the Linux and macOS home layouts only', () => {
    expect(homeDirectoryOf('/home/fate/code')).toBe('/home/fate')
    expect(homeDirectoryOf('/Users/fate/code')).toBe('/Users/fate')
    expect(homeDirectoryOf('/opt/DSH Desktop')).toBeUndefined()
    expect(homeDirectoryOf('/home')).toBeUndefined()
    expect(homeDirectoryOf('relative/path')).toBeUndefined()
  })
})

describe('collapseTerminalPath', () => {
  const home = '/home/fate'
  it('returns short paths unchanged, folding home to ~', () => {
    expect(collapseTerminalPath('/home/fate/code', home)).toBe('~/code')
    expect(collapseTerminalPath('/opt/x', home)).toBe('/opt/x')
    expect(collapseTerminalPath('/home/fate', home)).toBe('~')
  })
  it('folds long paths around an ellipsis within the budget', () => {
    const collapsed = collapseTerminalPath('/home/fate/code/AndroidApk/osagentproject/capability-contract', home)
    expect(collapsed).toBe('~/…/osagentproject/capability-contract')
    expect(collapsed.length).toBeLessThanOrEqual(40)
  })
  it('drops further tail segments when still over budget', () => {
    const collapsed = collapseTerminalPath('/home/fate/code/a-very-long-segment-name-here/another-long-segment-name', home, 30)
    expect(collapsed).toBe('~/…/another-long-segment-name')
    expect(collapsed.length).toBeLessThanOrEqual(30)
  })
  it('truncates a tail segment that alone overflows the budget', () => {
    const collapsed = collapseTerminalPath('/home/fate/code/an-extremely-long-segment-overflowing-the-budget', home, 24)
    expect(collapsed.length).toBeLessThanOrEqual(24)
    expect(collapsed.endsWith('…')).toBe(true)
  })
  it('folds non-home absolute paths with a root ellipsis', () => {
    const collapsed = collapseTerminalPath('/usr/local/lib/some/really/deep/directory/name', undefined)
    expect(collapsed.startsWith('/…/')).toBe(true)
    expect(collapsed.length).toBeLessThanOrEqual(40)
  })
  it('keeps single-segment overflow verbatim rather than mangling it', () => {
    const long = `/${'a'.repeat(60)}`
    expect(collapseTerminalPath(long)).toBe(long)
  })
})

describe('resolveCdTarget', () => {
  const cwd = '/home/fate/code'
  const home = '/home/fate'
  it('resolves relative, absolute, parent, and bare cd', () => {
    expect(resolveCdTarget(cwd, 'cd sub', home)).toBe('/home/fate/code/sub')
    expect(resolveCdTarget(cwd, 'cd /opt/x', home)).toBe('/opt/x')
    expect(resolveCdTarget(cwd, 'cd ..', home)).toBe('/home/fate')
    expect(resolveCdTarget(cwd, 'cd ../..', home)).toBe('/home')
    expect(resolveCdTarget(cwd, 'cd', home)).toBe(home)
    expect(resolveCdTarget(cwd, 'cd ~', home)).toBe(home)
    expect(resolveCdTarget(cwd, 'cd ~/Tools', home)).toBe('/home/fate/Tools')
  })
  it('normalizes dots and trailing slashes', () => {
    expect(resolveCdTarget(cwd, 'cd ./a/./b/', home)).toBe('/home/fate/code/a/b')
    expect(resolveCdTarget('/', 'cd ..', home)).toBe('/')
  })
  it('handles quoted directories', () => {
    expect(resolveCdTarget(cwd, 'cd "my dir"', home)).toBe('/home/fate/code/my dir')
    expect(resolveCdTarget(cwd, "cd 'my dir'", home)).toBe('/home/fate/code/my dir')
  })
  it('refuses compound, option, and unsupported forms', () => {
    expect(resolveCdTarget(cwd, 'cd sub && ls', home)).toBeUndefined()
    expect(resolveCdTarget(cwd, 'cd -', home)).toBeUndefined()
    expect(resolveCdTarget(cwd, 'cd -L sub', home)).toBeUndefined()
    expect(resolveCdTarget(cwd, 'cd ~other', home)).toBeUndefined()
    expect(resolveCdTarget(cwd, 'ls cd', home)).toBeUndefined()
  })
  it('degrades gracefully without a known home', () => {
    expect(resolveCdTarget(cwd, 'cd', undefined)).toBeUndefined()
    expect(resolveCdTarget(cwd, 'cd ~', undefined)).toBeUndefined()
    expect(resolveCdTarget(cwd, 'cd sub', undefined)).toBe('/home/fate/code/sub')
  })
})

describe('TerminalInputTracker', () => {
  it('accumulates printable input and commits on Enter', () => {
    const tracker = new TerminalInputTracker()
    expect(tracker.feed('l', false)).toEqual([])
    expect(tracker.feed('s', false)).toEqual([])
    expect(tracker.current).toBe('ls')
    expect(tracker.feed('\r', false)).toEqual(['ls'])
    expect(tracker.current).toBe('')
  })
  it('applies backspace and kills on Ctrl-C / Ctrl-U', () => {
    const tracker = new TerminalInputTracker()
    tracker.feed('git stats', false)
    tracker.feed('\x7f\x7f', false)
    expect(tracker.current).toBe('git sta')
    expect(tracker.feed('\x03', false)).toEqual([])
    expect(tracker.current).toBe('')
    tracker.feed('make', false)
    tracker.feed('\x15', false)
    expect(tracker.current).toBe('')
  })
  it('ignores arrow and navigation escape sequences', () => {
    const tracker = new TerminalInputTracker()
    tracker.feed('l', false)
    tracker.feed('\x1b[D\x1b[C', false) // left/right arrows
    tracker.feed('\x1b[H\x1b[F', false) // home/end
    tracker.feed('\x1bOA', false) // SS3 application-mode up
    tracker.feed('s', false)
    expect(tracker.current).toBe('ls')
  })
  it('commits each line of a paste burst in order', () => {
    const tracker = new TerminalInputTracker()
    expect(tracker.feed('ls\rcd /tmp\r', false)).toEqual(['ls', 'cd /tmp'])
  })
  it('tracks CJK input by code point', () => {
    const tracker = new TerminalInputTracker()
    tracker.feed('echo 你好', false)
    expect(tracker.feed('\r', false)).toEqual(['echo 你好'])
  })
  it('drops everything and stays silent on the alternate screen', () => {
    const tracker = new TerminalInputTracker()
    tracker.feed('top', false)
    expect(tracker.feed('q\r', true)).toEqual([])
    expect(tracker.current).toBe('')
  })
  it('skips empty commits and trims whitespace', () => {
    const tracker = new TerminalInputTracker()
    expect(tracker.feed('\r', false)).toEqual([])
    tracker.feed('  ls  ', false)
    expect(tracker.feed('\r', false)).toEqual(['ls'])
  })
})

describe('fuzzyScore', () => {
  it('is case-insensitive and requires a subsequence', () => {
    expect(fuzzyScore('CAP', 'cd capability-contract')).toBeDefined()
    expect(fuzzyScore('xyz', 'cd capability-contract')).toBeUndefined()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
  it('prefers consecutive, prefix, and word-start hits', () => {
    const consecutive = fuzzyScore('cap', 'capability-contract')
    const scattered = fuzzyScore('cap', 'c a p ability')
    expect(consecutive).toBeDefined()
    expect(scattered).toBeDefined()
    expect(consecutive!).toBeGreaterThan(scattered!)
    const prefix = fuzzyScore('git', 'git status')
    const wordStart = fuzzyScore('git', 'sudo git status')
    expect(prefix!).toBeGreaterThan(wordStart!)
  })
})

describe('rankHistoryEntries', () => {
  const entries = [
    entry(1, 'git status', 100),
    entry(2, 'cd capability-contract', 200),
    entry(3, 'git commit -m "cap"', 300),
  ]
  it('keeps every entry newest-first for a blank query', () => {
    expect(rankHistoryEntries(entries, '').map(item => item.id)).toEqual([3, 2, 1])
    expect(rankHistoryEntries(entries, '   ').map(item => item.id)).toEqual([3, 2, 1])
  })
  it('filters case-insensitively and ranks by score then recency', () => {
    expect(rankHistoryEntries(entries, 'CAP').map(item => item.id)).toEqual([2, 3])
    expect(rankHistoryEntries(entries, 'git').map(item => item.id)).toEqual([3, 1])
    expect(rankHistoryEntries(entries, 'zzz')).toEqual([])
  })
  it('dedupes identical commands to their most recent entry for the popup', () => {
    const repeated = [
      entry(1, 'ls -la', 100),
      entry(2, 'pwd', 200),
      entry(3, 'ls -la', 300),
    ]
    expect(rankHistoryEntries(repeated, 'ls', true).map(item => item.id)).toEqual([3])
    expect(rankHistoryEntries(repeated, 'ls', false).map(item => item.id)).toEqual([3, 1])
    expect(rankHistoryEntries(repeated, '', true).map(item => item.id)).toEqual([3, 2])
  })
})

describe('inlineSuggestion', () => {
  const entries = [entry(1, 'cd code', 100), entry(2, 'cd capability-contract', 200)]
  it('extends the line from the most recent prefix match', () => {
    expect(inlineSuggestion('cd c', entries)).toBe('cd capability-contract')
    expect(inlineSuggestion('CD C', entries)).toBe('cd capability-contract')
  })
  it('stays silent for short, exact, or prefix-less lines', () => {
    expect(inlineSuggestion('c', entries)).toBeUndefined()
    expect(inlineSuggestion('cd code', entries)).toBeUndefined()
    expect(inlineSuggestion('ls', entries)).toBeUndefined()
  })
})

interface PanelStoreState {
  histories: Record<string, TerminalHistoryEntry[]>
  cwds: Record<string, string>
  homes: Record<string, string>
  filters: Record<string, string>
  nextHistoryId: number
}

describe('desktop terminal panel store', () => {
  it('appends, dedupes consecutive repeats, and caps the history', () => {
    const store = createDesktopTerminalPanelStore().create()
    store.actions.appendHistory('c1', 'ls')
    store.actions.appendHistory('c1', 'ls')
    store.actions.appendHistory('c1', 'pwd')
    expect((store.getSnapshot() as PanelStoreState).histories['c1']?.map(item => item.command)).toEqual(['ls', 'pwd'])
    for (let index = 0; index < TERMINAL_PANEL_HISTORY_LIMIT + 20; index += 1) store.actions.appendHistory('c1', `cmd-${index}`)
    const state = store.getSnapshot() as PanelStoreState
    expect(state.histories['c1']).toHaveLength(TERMINAL_PANEL_HISTORY_LIMIT)
    expect(state.histories['c1']?.[0]?.command).toBe('cmd-20')
  })

  it('tracks per-tab directories, filters, and purges tab data', () => {
    const store = createDesktopTerminalPanelStore().create()
    store.actions.initTab('c1', '/home/fate/code', '/home/fate')
    store.actions.initTab('c1', '/elsewhere', '')
    store.actions.setCwd('c1', '/home/fate/code/sub')
    store.actions.setFilter('c1', 'git')
    store.actions.appendHistory('c1', 'ls')
    let state = store.getSnapshot() as PanelStoreState
    // initTab never overwrites an existing record.
    expect(state.cwds['c1']).toBe('/home/fate/code/sub')
    expect(state.homes['c1']).toBe('/home/fate')
    expect(state.filters['c1']).toBe('git')
    store.actions.purgeTab('c1')
    state = store.getSnapshot() as PanelStoreState
    expect(state.cwds['c1']).toBeUndefined()
    expect(state.homes['c1']).toBeUndefined()
    expect(state.filters['c1']).toBeUndefined()
    expect(state.histories['c1']).toBeUndefined()
  })

  it('removes single entries and clears whole lists', () => {
    const store = createDesktopTerminalPanelStore().create()
    store.actions.appendHistory('c1', 'a')
    store.actions.appendHistory('c1', 'b')
    const before = store.getSnapshot() as PanelStoreState
    const firstId = before.histories['c1']?.[0]?.id ?? 0
    store.actions.removeHistory('c1', firstId)
    expect((store.getSnapshot() as PanelStoreState).histories['c1']?.map(item => item.command)).toEqual(['b'])
    store.actions.clearHistory('c1')
    expect((store.getSnapshot() as PanelStoreState).histories['c1']).toBeUndefined()
  })
})
