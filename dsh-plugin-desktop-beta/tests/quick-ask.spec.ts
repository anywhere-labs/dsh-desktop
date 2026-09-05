import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import { DesktopQuickAskSettingsSchema, refreshSessions, submitQuickAsk } from '../src/quick-ask.ts'
import { parseQuickAskAction } from '../src/quick-ask-window.ts'
import { desktopShortcutFromKeyboardEvent, isDesktopShortcut } from '../src/quick-ask-shortcut.ts'

function context(renameRejects = false): { readonly ctx: Context, readonly create: ReturnType<typeof vi.fn>, readonly rename: ReturnType<typeof vi.fn>, readonly prompt: ReturnType<typeof vi.fn>, readonly selectModel: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({ sessionId: 'session-quick' as SessionId }))
  const rename = renameRejects ? vi.fn(async () => { throw new Error('title unavailable') }) : vi.fn(async () => ({ title: 'ok', seq: 1 }))
  const prompt = vi.fn(async () => ({ accepted: true as const }))
  const selectModel = vi.fn(async () => ({ ok: true }))
  const ctx = {
    sessionController: { create, rename, prompt, selectModel },
    workspaceRegistry: {
      list: () => [{ id: 'workspace-1' as WorkspaceId, title: 'Project', path: '/tmp/project' }],
    },
    logger: { warn: vi.fn() },
    get: (key: string) => (key === 'sessionController' ? { create, rename, prompt, selectModel } : undefined),
  } as unknown as Context
  return { ctx, create, rename, prompt, selectModel }
}

describe('Quick Ask Host bridge', () => {
  it('has distinct cross-platform shortcuts by default', () => {
    expect(DesktopQuickAskSettingsSchema({} as never)).toEqual({
      quickAskShortcut: 'CommandOrControl+Shift+K',
      mainWindowShortcut: 'CommandOrControl+Shift+Space',
      workspaceId: '',
    })
  })

  it('accepts custom Electron accelerators and rejects unsafe strings', () => {
    expect(DesktopQuickAskSettingsSchema({
      quickAskShortcut: 'CommandOrControl+Shift+K',
      mainWindowShortcut: 'Alt+F12',
    } as never)).toMatchObject({
      quickAskShortcut: 'CommandOrControl+Shift+K',
      mainWindowShortcut: 'Alt+F12',
    })
    expect(isDesktopShortcut('CommandOrControl+Alt+Space')).toBe(true)
    expect(isDesktopShortcut('Shift+F12')).toBe(true)
    expect(isDesktopShortcut('Space')).toBe(false)
    expect(isDesktopShortcut('Control+')).toBe(false)
    expect(isDesktopShortcut('CommandOrControl+Control+K')).toBe(false)
    expect(() => DesktopQuickAskSettingsSchema({ quickAskShortcut: 'not a shortcut' } as never)).toThrow()
  })

  it('records browser key events as canonical cross-platform accelerators', () => {
    expect(desktopShortcutFromKeyboardEvent({ key: 'k', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false })).toBe('CommandOrControl+Alt+K')
    expect(desktopShortcutFromKeyboardEvent({ key: 'ArrowUp', metaKey: false, ctrlKey: true, altKey: false, shiftKey: true })).toBe('CommandOrControl+Shift+Up')
    expect(desktopShortcutFromKeyboardEvent({ key: 'a', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBeUndefined()
    expect(desktopShortcutFromKeyboardEvent({ key: 'Shift', metaKey: false, ctrlKey: false, altKey: false, shiftKey: true })).toBeUndefined()
  })

  it('creates, names, and prompts one ordinary Session in the selected workspace', async () => {
    const harness = context()
    await expect(submitQuickAsk(harness.ctx, { prompt: '  inspect this project  ', workspaceId: 'workspace-1' })).resolves.toEqual({ sessionId: 'session-quick' })
    expect(harness.create).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(harness.rename).toHaveBeenCalledWith({ sessionId: 'session-quick', title: 'Quick Ask · inspect this project' })
    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-quick', mode: 'queue', content: [{ type: 'text', text: 'inspect this project' }],
    }), expect.any(AbortSignal))
  })

  it('continues an existing Session without renaming it', async () => {
    const harness = context()
    await expect(submitQuickAsk(harness.ctx, { prompt: 'follow up', sessionId: 'session-quick' })).resolves.toEqual({ sessionId: 'session-quick' })
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.rename).not.toHaveBeenCalled()
    expect(harness.prompt).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-quick', content: [{ type: 'text', text: 'follow up' }] }), expect.any(AbortSignal))
  })

  it('falls back to the default cwd and still prompts when naming fails', async () => {
    const harness = context(true)
    await expect(submitQuickAsk(harness.ctx, { prompt: 'work', workspaceId: 'missing' })).resolves.toEqual({ sessionId: 'session-quick' })
    expect(harness.create).toHaveBeenCalledWith({})
    expect(harness.prompt).toHaveBeenCalledOnce()
  })

  it('selects the requested model during Session submission', async () => {
    const harness = context()
    await expect(submitQuickAsk(harness.ctx, {
      prompt: 'hello',
      model: { provider: 'deepseek-official', model: 'deepseek-chat' },
    })).resolves.toEqual({ sessionId: 'session-quick' })
    expect(harness.selectModel).toHaveBeenCalledWith({
      sessionId: 'session-quick',
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
  })

  it('loads historical sessions and titles from sessionQuery', async () => {
    const listSessions = vi.fn(async () => [
      { header: { id: 'session-1' as SessionId, cwd: '/tmp/project', createdAt: 100 } },
      { header: { id: 'subagent-1' as SessionId, origin: 'subagent', createdAt: 200 } },
    ])
    const readTitleSnapshots = vi.fn(async () => [
      { status: 'fulfilled', value: { session: { id: 'session-1' as SessionId }, title: { title: 'Historical Task' } } },
    ])
    const ctx = {
      workspaceRegistry: { list: () => [{ id: 'workspace-1' as WorkspaceId, title: 'Project', path: '/tmp/project' }] },
      logger: { warn: vi.fn() },
      get: (key: string) => (key === 'sessionQuery' ? { listSessions, readTitleSnapshots } : undefined),
    } as unknown as Context
    await refreshSessions(ctx)
    expect(listSessions).toHaveBeenCalled()
    expect(readTitleSnapshots).toHaveBeenCalledWith(['session-1'])
  })

  it('rejects blank and oversized prompts before Session creation', async () => {
    const harness = context()
    await expect(submitQuickAsk(harness.ctx, { prompt: '   ' })).rejects.toThrow('empty')
    await expect(submitQuickAsk(harness.ctx, { prompt: 'x'.repeat(65 * 1024) })).rejects.toThrow('too large')
    expect(harness.create).not.toHaveBeenCalled()
  })
})

describe('Quick Ask local action parser', () => {
  it('accepts only bounded local actions', () => {
    expect(parseQuickAskAction('dsh-quick-ask://submit?prompt=hello&workspace=workspace-1')).toEqual({ action: 'submit', prompt: 'hello', workspaceId: 'workspace-1' })
    expect(parseQuickAskAction('dsh-quick-ask://submit?prompt=hello&modelProvider=deepseek&modelId=deepseek-chat')).toEqual({ action: 'submit', prompt: 'hello', model: { provider: 'deepseek', model: 'deepseek-chat' } })
    expect(parseQuickAskAction('dsh-quick-ask://select-model?session=session-1&provider=deepseek&model=deepseek-chat')).toEqual({ action: 'select-model', sessionId: 'session-1', model: { provider: 'deepseek', model: 'deepseek-chat' } })
    expect(parseQuickAskAction('dsh-quick-ask://submit?prompt=follow&session=session-quick')).toEqual({ action: 'submit', prompt: 'follow', sessionId: 'session-quick' })
    expect(parseQuickAskAction('dsh-quick-ask://sessions?session=session-quick')).toEqual({ action: 'sessions', sessionId: 'session-quick' })
    expect(parseQuickAskAction('dsh-quick-ask://hide')).toEqual({ action: 'hide' })
    expect(parseQuickAskAction('https://example.com/')).toBeUndefined()
    expect(parseQuickAskAction('dsh-quick-ask://submit?prompt=ok&extra=no')).toBeUndefined()
  })
})
