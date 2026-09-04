import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, expect, it, vi } from 'vitest'
import { DesktopQuickAskSettingsSchema, submitQuickAsk } from '../src/quick-ask.ts'
import { parseQuickAskAction } from '../src/quick-ask-window.ts'

function context(renameRejects = false): { readonly ctx: Context, readonly create: ReturnType<typeof vi.fn>, readonly rename: ReturnType<typeof vi.fn>, readonly prompt: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => ({ sessionId: 'session-quick' as SessionId }))
  const rename = renameRejects ? vi.fn(async () => { throw new Error('title unavailable') }) : vi.fn(async () => ({ title: 'ok', seq: 1 }))
  const prompt = vi.fn(async () => ({ accepted: true as const }))
  const ctx = {
    sessionController: { create, rename, prompt },
    workspaceRegistry: {
      list: () => [{ id: 'workspace-1' as WorkspaceId, title: 'Project', path: '/tmp/project' }],
    },
    logger: { warn: vi.fn() },
  } as unknown as Context
  return { ctx, create, rename, prompt }
}

describe('Quick Ask Host bridge', () => {
  it('has distinct cross-platform shortcuts by default', () => {
    expect(DesktopQuickAskSettingsSchema({} as never)).toEqual({
      quickAskShortcut: 'CommandOrControl+Alt+Space',
      mainWindowShortcut: 'CommandOrControl+Shift+Space',
      workspaceId: '',
    })
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

  it('falls back to the default cwd and still prompts when naming fails', async () => {
    const harness = context(true)
    await expect(submitQuickAsk(harness.ctx, { prompt: 'work', workspaceId: 'missing' })).resolves.toEqual({ sessionId: 'session-quick' })
    expect(harness.create).toHaveBeenCalledWith({})
    expect(harness.prompt).toHaveBeenCalledOnce()
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
    expect(parseQuickAskAction('dsh-quick-ask://hide')).toEqual({ action: 'hide' })
    expect(parseQuickAskAction('https://example.com/')).toBeUndefined()
    expect(parseQuickAskAction('dsh-quick-ask://submit?prompt=ok&extra=no')).toBeUndefined()
  })
})
