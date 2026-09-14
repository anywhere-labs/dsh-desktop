import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import ApprovalService, { type ApprovalOutcome, type ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, DesktopNotificationSettingsSchema, inject, name, type DesktopNotificationSettings } from '../src/notifications.ts'
import type { DesktopRuntime } from '../src/runtime.ts'

type ApprovalAgent = NonNullable<ApprovalRequest['agent']>
const cleanup: Array<() => Promise<void>> = []

async function harness(locale: 'en' | 'zh' = 'en') {
  const ctx = new Context()
  const notifyAttention = vi.fn()
  let settings = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)
  let watcher: ((value: DesktopNotificationSettings) => void) | undefined
  ctx.provide('desktopRuntime', { locale, notifyAttention } as unknown as DesktopRuntime)
  ctx.provide('settings', { register: () => ({
    get: () => settings,
    watch: (callback: typeof watcher) => { watcher = callback; return () => { watcher = undefined } },
  }) } as unknown as Context['settings'])
  const sessions = ctx.plugin(SessionStore)
  const approvals = ctx.plugin(ApprovalService)
  await sessions
  await approvals
  const waiting: Array<{ resolve: (outcome: ApprovalOutcome) => void }> = []
  const answerer = vi.fn(() => new Promise<ApprovalOutcome>((resolve) => { waiting.push({ resolve }) }))
  // The observer must run even when an existing UI answerer claims the waterfall.
  const stopAnswerer = ctx.on('approval/request', answerer)
  const notifications = ctx.plugin({ name, inject, apply })
  await notifications
  cleanup.push(async () => {
    await notifications.dispose()
    for (const pending of waiting.splice(0)) pending.resolve('allowed-once')
    stopAnswerer()
    await approvals.dispose()
    await sessions.dispose()
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const agent = (title: string): ApprovalAgent => {
    const session = ctx.sessions.create()
    session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
    session.append('turn/start', { turn: 1 })
    return { id: session.id, session } as unknown as ApprovalAgent
  }
  return {
    ctx, notifyAttention, answerer, waiting, notifications, stopAnswerer, agent,
    ask(a: ApprovalAgent, toolName = 'bash', reason?: string, signal?: AbortSignal): Promise<ApprovalOutcome> {
      const request: ApprovalRequest = { agent: a, toolName, ...reason === undefined ? {} : { reason }, ...signal === undefined ? {} : { signal } }
      return ctx.approval.request(request)
    },
    setSettings(patch: Partial<DesktopNotificationSettings>) {
      settings = { ...settings, ...patch }
      watcher?.(settings)
    },
  }
}

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.useRealTimers()
})

describe('pending approval request notifications', () => {
  it('tags the title and names the tool, passing the answerer outcome through', async () => {
    const h = await harness()
    const a = h.agent('Research task')
    const outcome = h.ask(a, 'bash')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.answerer).toHaveBeenCalledOnce()
    expect(h.notifyAttention).toHaveBeenCalledExactlyOnceWith({
      title: 'Research task',
      body: '"bash" is waiting for your approval.',
    })
    h.waiting[0]!.resolve('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
  })

  it('localizes the tagged title and tool name', async () => {
    const h = await harness('zh')
    const a = h.agent('研究任务')
    const outcome = h.ask(a, 'write')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).toHaveBeenCalledExactlyOnceWith({
      title: '研究任务',
      body: '「write」正在等待你的批准。',
    })
    h.waiting[0]!.resolve('rejected')
    await expect(outcome).resolves.toBe('rejected')
  })

  it('appends the approval reason to the body when content previews are on', async () => {
    const h = await harness()
    const a = h.agent('Build task')
    const outcome = h.ask(a, 'bash', 'needs write access to /tmp')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention.mock.calls[0]![0]).toMatchObject({
      title: 'Build task',
      body: '"bash" is waiting for your approval. needs write access to /tmp',
    })
    h.waiting[0]!.resolve('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
  })

  it('hides the reason when content previews are off', async () => {
    const h = await harness()
    h.setSettings({ showResponsePreview: false })
    const a = h.agent('Build task')
    const outcome = h.ask(a, 'bash', 'needs write access to /tmp')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).toHaveBeenCalledExactlyOnceWith({
      title: 'Build task',
      body: '"bash" is waiting for your approval.',
    })
    h.waiting[0]!.resolve('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
  })

  it('does not notify for an immediately decided request or one without any answerer', async () => {
    const h = await harness()
    const a = h.agent('Task')
    h.answerer.mockResolvedValueOnce('allowed-once')
    await expect(h.ask(a)).resolves.toBe('allowed-once')
    h.stopAnswerer()
    await expect(h.ask(h.agent('Other'))).resolves.toBe('unavailable')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
  })

  it.each(['enabled', 'notifyOnApprovalRequest'] as const)('honors the live %s switch without intercepting the request', async (key) => {
    const h = await harness()
    h.setSettings({ [key]: false })
    const a = h.agent('Task')
    const outcome = h.ask(a)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
    expect(h.answerer).toHaveBeenCalledOnce()
    h.waiting[0]!.resolve('rejected')
    await expect(outcome).resolves.toBe('rejected')
  })

  it('suppresses cancelled requests and preserves the cancelled outcome', async () => {
    const h = await harness()
    const controller = new AbortController()
    const a = h.agent('Task')
    const outcome = h.ask(a, 'bash', undefined, controller.signal)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
    h.waiting[0]!.resolve('allowed-once')
    await expect(outcome).resolves.toBe('cancelled')
  })

  it('delivers at most one pending-approval notification per session at a time', async () => {
    const h = await harness()
    const a = h.agent('Task')
    const first = h.ask(a, 'bash')
    const second = h.ask(a, 'write')
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).toHaveBeenCalledOnce()
    expect(h.notifyAttention.mock.calls[0]![0]).toMatchObject({ body: '"bash" is waiting for your approval.' })
    h.waiting[0]!.resolve('allowed-once')
    await expect(first).resolves.toBe('allowed-once')
    h.waiting[1]!.resolve('rejected')
    await expect(second).resolves.toBe('rejected')
  })

  it.each(['session', 'plugin'] as const)('cancels queued notifications on %s disposal', async (kind) => {
    const h = await harness()
    const controller = new AbortController()
    const a = h.agent('Task')
    const outcome = h.ask(a, 'bash', undefined, controller.signal)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    if (kind === 'plugin') await h.notifications.dispose()
    else h.ctx.emit('session/disposed', a.session)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
    controller.abort()
    h.waiting[0]!.resolve('allowed-once')
    await expect(outcome).resolves.toBe('cancelled')
  })

  it('keeps the approval answerable if native notification delivery fails', async () => {
    const h = await harness()
    h.notifyAttention.mockImplementation(() => { throw new Error('Native notifications unavailable') })
    const outcome = h.ask(h.agent('Task'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.answerer).toHaveBeenCalledOnce()
    h.waiting[0]!.resolve('allowed-once')
    await expect(outcome).resolves.toBe('allowed-once')
  })
})
