import { describe, expect, it, vi } from 'vitest'
import {
  buildDesktopSessionProgressJumpTasks,
  buildDesktopSessionProgressMenu,
  desktopSessionProgressDisplayTitle,
  desktopSessionProgressLabel,
  parseDesktopSessionJumpArgv,
} from '../src/session-progress-menu.ts'
import {
  desktopSessionProgressFallbackTitle,
  parseDesktopSessionProgressEntry,
  parseDesktopSessionProgressSnapshot,
  truncateDesktopSessionProgressTitle,
  type DesktopSessionProgressEntry,
  type DesktopSessionProgressSnapshot,
} from '../src/session-progress.ts'

function entry(sessionId: string, title = `Title ${sessionId}`): DesktopSessionProgressEntry {
  return { sessionId, title, failed: false, completedAt: 1 }
}

function snapshot(unread: DesktopSessionProgressEntry[], recent: DesktopSessionProgressEntry[] = []): DesktopSessionProgressSnapshot {
  return { unread, recent }
}

describe('desktop session-progress surface', () => {
  it('truncates titles to 35 characters with an ellipsis', () => {
    expect(truncateDesktopSessionProgressTitle('short')).toBe('short')
    expect(truncateDesktopSessionProgressTitle('x'.repeat(35))).toBe('x'.repeat(35))
    expect(truncateDesktopSessionProgressTitle('x'.repeat(36))).toBe(`${'x'.repeat(34)}…`)
    expect(desktopSessionProgressFallbackTitle('session-1')).toBe('Session session-1')
  })

  it('builds Unread+Recent sections with a 3+More layout', () => {
    const openSession = vi.fn()
    const openDesktop = vi.fn()
    const template = buildDesktopSessionProgressMenu(
      'en',
      snapshot(
        [entry('u1'), entry('u2'), entry('u3'), entry('u4'), entry('u5')],
        [entry('u1'), entry('r1')],
      ),
      'DSH Desktop',
      openSession,
      openDesktop,
    )
    const labels = template.map(item => item.label)
    expect(labels[0]).toBe('Unread')
    expect(labels.slice(1, 4)).toEqual(['Title u1', 'Title u2', 'Title u3'])
    expect(labels[4]).toBe('More')
    const more = template[4]
    expect(more?.submenu).toHaveLength(2)
    const recentHeader = labels.indexOf('Recent')
    expect(recentHeader).toBeGreaterThan(0)
    expect(template[template.length - 1]?.label).toBe('Title r1')
    // Recent excludes sessions already listed under Unread.
    expect(labels.filter(label => label === 'Title u1')).toHaveLength(1)

    const first = template[1]
    first?.click?.({} as never, undefined, {} as never)
    expect(openSession).toHaveBeenCalledWith('u1')
  })

  it('falls back to Open when the snapshot is empty and localizes headers', () => {
    const openDesktop = vi.fn()
    const template = buildDesktopSessionProgressMenu('zh', snapshot([]), 'DSH Desktop', vi.fn(), openDesktop)
    expect(template).toHaveLength(1)
    expect(template[0]?.label).toBe('打开 DSH Desktop')
    template[0]?.click?.({} as never, undefined, {} as never)
    expect(openDesktop).toHaveBeenCalledOnce()
    expect(desktopSessionProgressLabel('en', 'unreadSessions')).toBe('Unread')
    expect(desktopSessionProgressLabel('zh', 'recentSessions')).toBe('最近会话')
    expect(desktopSessionProgressDisplayTitle({ ...entry('x'), title: '   ' }).startsWith('Session ')).toBe(true)
  })

  it('builds Windows Jump List tasks with --open-session args', () => {
    const tasks = buildDesktopSessionProgressJumpTasks(
      snapshot([entry('a'), entry('b'), entry('c'), entry('d')]),
    )
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toEqual({ title: 'Title a', description: 'Title a', args: '--open-session=a' })
  })

  it('parses --open-session argv strictly', () => {
    expect(parseDesktopSessionJumpArgv(['--open-session=abc-123'])).toBe('abc-123')
    expect(parseDesktopSessionJumpArgv(['app', '--open-session=abc-123'])).toBe('abc-123')
    expect(parseDesktopSessionJumpArgv([])).toBeUndefined()
    expect(parseDesktopSessionJumpArgv(['--open-session='])).toBeUndefined()
    expect(parseDesktopSessionJumpArgv(['--open-session=a b'])).toBeUndefined()
    expect(parseDesktopSessionJumpArgv(['--open-sessionx=y'])).toBeUndefined()
  })

  it('validates snapshots at the Host/Electron boundary', () => {
    expect(parseDesktopSessionProgressEntry(entry('a'))).toEqual(entry('a'))
    expect(parseDesktopSessionProgressEntry({ sessionId: '', title: 't', failed: false, completedAt: 1 })).toBeUndefined()
    expect(parseDesktopSessionProgressEntry({ sessionId: 'a', title: '', failed: false, completedAt: 1 })).toBeUndefined()
    const parsed = parseDesktopSessionProgressSnapshot(snapshot([entry('a')], [entry('b')]))
    expect(parsed).toEqual(snapshot([entry('a')], [entry('b')]))
    expect(parseDesktopSessionProgressSnapshot({ unread: [{ sessionId: 'a' }], recent: [] })).toBeUndefined()
    expect(parseDesktopSessionProgressSnapshot(null)).toBeUndefined()
  })
})
