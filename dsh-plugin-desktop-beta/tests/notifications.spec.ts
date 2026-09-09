import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JobId, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SessionTitleService } from '@deepseek-ai/dsh-session-title'
import { describe, expect, it, vi } from 'vitest'
import {
  apply,
  DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  DesktopNotificationSettingsSchema,
  inject,
  name,
  type DesktopNotificationSettings,
} from '../src/notifications.ts'
import type { DesktopRuntime } from '../src/runtime.ts'

type OptionalService = 'jobs' | 'sessions' | 'settings'

interface NotificationHarness {
  readonly notifyAttention: ReturnType<typeof vi.fn>
  readonly registerSettings: ReturnType<typeof vi.fn>
  readonly stopJobs: ReturnType<typeof vi.fn>
  readonly stopSessions: ReturnType<typeof vi.fn>
  jobDone(snapshot: JobSnapshot): Promise<void>
  sessionEvent(session: Session, event: SessionEvent): Promise<void>
  sessionDisposed(session: Session): Promise<void>
  updateSettings(settings: DesktopNotificationSettings): Promise<void>
  teardownSessions(): void
  reattachSessions(): void
  dispose(): void
}

function createHarness(available: readonly OptionalService[] = ['jobs', 'sessions', 'settings']): NotificationHarness {
  const notifyAttention = vi.fn()
  const stopJobs = vi.fn()
  const stopSessions = vi.fn()
  const enabled = new Set(available)
  const injections = new Map<OptionalService, (ctx: Context) => void>()
  const disposers = new Map<OptionalService, Array<() => void>>()
  let activeService: OptionalService | undefined
  let jobListener: ((snapshot: JobSnapshot) => void | PromiseLike<void>) | undefined
  let sessionListener: ((session: Session, event: SessionEvent) => void | PromiseLike<void>) | undefined
  let sessionDisposedListener: ((session: Session) => void | PromiseLike<void>) | undefined
  let settingsWatcher:
    | ((next: DesktopNotificationSettings, previous: DesktopNotificationSettings) => void | Promise<void>)
    | undefined
  let currentSettings = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)

  const runtime = {
    platform: 'darwin',
    locale: 'en',
    notifyAttention,
  } as unknown as DesktopRuntime

  const registerSettings = vi.fn(() => ({
    get: () => currentSettings,
    watch: (watcher: typeof settingsWatcher) => {
      settingsWatcher = watcher
      return () => { settingsWatcher = undefined }
    },
    update: vi.fn(async () => {}),
    replace: vi.fn(async () => {}),
  }))

  const ctx = {
    desktopRuntime: runtime,
    settings: { register: registerSettings },
    jobs: {
      onJobDone: (listener: typeof jobListener) => {
        jobListener = listener
        return () => {
          jobListener = undefined
          stopJobs()
        }
      },
    },
    on: (event: string, listener: typeof sessionListener | typeof sessionDisposedListener) => {
      if (event === 'session/event') sessionListener = listener as typeof sessionListener
      else if (event === 'session/disposed') sessionDisposedListener = listener as typeof sessionDisposedListener
      else return () => {}
      return () => {
        if (event === 'session/event') sessionListener = undefined
        else sessionDisposedListener = undefined
        stopSessions()
      }
    },
    inject: (services: OptionalService[], callback: (child: Context) => void) => {
      const service = services[0]
      if (service === undefined) return
      injections.set(service, callback)
      if (!enabled.has(service)) return
      activeService = service
      callback(ctx as unknown as Context)
      activeService = undefined
    },
    effect: (register: () => void | (() => void)) => {
      const dispose = register()
      if (activeService !== undefined && typeof dispose === 'function') {
        disposers.set(activeService, [...(disposers.get(activeService) ?? []), dispose])
      }
      return dispose
    },
  } as unknown as Context

  const teardown = (service: OptionalService): void => {
    for (const dispose of [...(disposers.get(service) ?? [])].reverse()) dispose()
    disposers.delete(service)
  }

  apply(ctx)

  return {
    notifyAttention,
    registerSettings,
    stopJobs,
    stopSessions,
    async jobDone(snapshot) { await jobListener?.(snapshot) },
    async sessionEvent(session, event) { await sessionListener?.(session, event) },
    async sessionDisposed(session) { await sessionDisposedListener?.(session) },
    async updateSettings(next) {
      const previous = currentSettings
      currentSettings = next
      await settingsWatcher?.(next, previous)
    },
    teardownSessions() { teardown('sessions') },
    reattachSessions() {
      activeService = 'sessions'
      injections.get('sessions')?.(ctx)
      activeService = undefined
    },
    dispose() {
      teardown('sessions')
      teardown('jobs')
      teardown('settings')
    },
  }
}

function session(id: string, origin?: 'subagent', history: SessionEvent[] = [], cwd: string | null = '/projects/Example session'): Session {
  return {
    snapshotEvents: () => history,
    header: {
      id: id as SessionId,
      version: 0,
      createdAt: 1,
      ...(cwd === null ? {} : { cwd }),
      ...(origin === undefined ? {} : { origin }),
    },
  } as unknown as Session
}

function event<T extends SessionEvent['type']>(
  type: T,
  data: Extract<SessionEvent, { type: T }>['data'],
  seq: number,
): Extract<SessionEvent, { type: T }> {
  return { type, data, seq, time: seq } as Extract<SessionEvent, { type: T }>
}

function userMessage(source: 'user' | 'plugin', seq: number): SessionEvent<'user/message'> {
  return event('user/message', {
    id: `message-${String(seq)}` as never,
    role: 'user',
    content: [{ type: 'text', text: 'secret /Users/example session-123' }] as never,
    source: source === 'user'
      ? { kind: 'user' }
      : { kind: 'plugin', plugin: 'test', form: 'notice', summary: 'continuation' },
  } as never, seq)
}

function assistantMessage(content: ContentBlock[], seq: number, turn = 1): SessionEvent<'assistant/message'> {
  return event('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({ content, source: { provider: 'test', model: 'test' } }),
    stream: [],
  }, seq)
}

describe('desktop notifications Host plugin', () => {
  it('uses each session title and answer when multiple sessions finish out of order', async () => {
    const harness = createHarness(['sessions'])
    const title = (text: string): SessionEvent<'session/title'> => event('session/title', {
      title: text, messageSeqs: [], source: { kind: 'user' },
    }, 0)
    const firstHistory = [title('旧标题')]
    const first = session('first', undefined, firstHistory)
    const second = session('second', undefined, [title('项目开发')])
    for (const active of [first, second]) {
      await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
      await harness.sessionEvent(active, userMessage('user', 2))
    }
    await harness.sessionEvent(first, assistantMessage([{ type: 'text', text: '哲学问题的回答。' }], 3))
    await harness.sessionEvent(second, assistantMessage([{ type: 'text', text: '项目功能已完成。' }], 3))
    // A rename during the turn must be read at notification time, not cached at turn/start.
    firstHistory.push(title('哲学问题'))
    await harness.sessionEvent(second, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
    await harness.sessionEvent(first, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
    expect(harness.notifyAttention.mock.calls).toEqual([
      [{ title: '项目开发', body: '项目功能已完成。' }],
      [{ title: '哲学问题', body: '哲学问题的回答。' }],
    ])
  })

  it('keeps the session title when response previews are disabled and when a turn fails', async () => {
    const harness = createHarness()
    await harness.updateSettings({
      ...DesktopNotificationSettingsSchema({} as DesktopNotificationSettings),
      showResponsePreview: false,
    })
    const active = session('named', undefined, [event('session/title', {
      title: '  我的\n会话  ', messageSeqs: [], source: { kind: 'fallback' },
    }, 0)])
    for (const kind of ['completed', 'error'] as const) {
      await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
      await harness.sessionEvent(active, userMessage('user', 2))
      await harness.sessionEvent(active, assistantMessage([{ type: 'text', text: 'Hidden answer' }], 3))
      const reason = kind === 'error' ? { kind, error: { code: 'UNKNOWN' as const, message: 'Private error' } } : { kind }
      await harness.sessionEvent(active, event('turn/end', { turn: 1, reason }, 4))
    }
    expect(harness.notifyAttention.mock.calls).toEqual([
      [{ title: '我的 会话', body: 'A user-initiated turn has finished.' }],
      [{ title: '我的 会话', body: 'A user-initiated turn could not finish. Open DSH Desktop for details.' }],
    ])
  })

  it('uses the project display title for an empty logged title', async () => {
    const harness = createHarness(['sessions'])
    const active = session('empty-title', undefined, [event('session/title', {
      title: '\n  ', messageSeqs: [], source: { kind: 'user' },
    }, 0)])
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
    expect(harness.notifyAttention).toHaveBeenCalledExactlyOnceWith({
      title: 'Example session', body: 'A user-initiated turn has finished.',
    })
  })

  it.each([
    ['D:\\projects\\通知项目\\', '通知项目'],
    ['/projects/通知项目/', '通知项目'],
    ['\\\\server\\share\\通知项目', '通知项目'],
    ['', 'session-without-title'],
    ['/', 'session-without-title'],
  ])('matches the session list display title before a title is logged (%s)', async (cwd, title) => {
    const harness = createHarness(['sessions'])
    const active = session('session-without-title', undefined, [], cwd)
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionEvent(active, assistantMessage([{ type: 'text', text: '回答已完成。' }], 3))
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
    expect(harness.notifyAttention).toHaveBeenCalledExactlyOnceWith({ title, body: '回答已完成。' })
  })

  it('uses the session id shown by the list when neither a title nor a project exists', async () => {
    const harness = createHarness(['sessions'])
    const withoutProject = session('session-without-project', undefined, [], null)
    await harness.sessionEvent(withoutProject, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(withoutProject, userMessage('user', 2))
    await harness.sessionEvent(withoutProject, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
    expect(harness.notifyAttention).toHaveBeenCalledExactlyOnceWith({
      title: 'session-without-project', body: 'A user-initiated turn has finished.',
    })
  })

  it('uses the list display title while automatic naming is pending, then the generated title', async () => {
    const ctx = new Context()
    const notifyAttention = vi.fn()
    ctx.provide('desktopRuntime', { locale: 'zh', notifyAttention } as unknown as DesktopRuntime)
    const notifications = ctx.plugin({ name, inject, apply })
    const sessions = ctx.plugin(SessionStore)
    const projections = ctx.plugin(SessionProjectionRegistry)
    const titles = ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
    await notifications
    await sessions
    await projections
    await titles
    try {
      const active = ctx.sessions.create(undefined, { meta: { cwd: '/projects/通知项目' } })
      const complete = (turn: number): void => {
        active.append('turn/start', { turn })
        active.append('user/message', createUserMessage({ content: [{ type: 'text', text: '会话通知修复' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
        active.append('assistant/message', assistantMessage([{ type: 'text', text: '回答已就绪。' }], 0, turn).data, { surfaceOp: 'append' })
        active.append('turn/end', { turn, reason: { kind: 'completed' } })
      }
      // End the first turn before the title service's queued fallback write runs.
      complete(1)
      expect(ctx.sessionTitle.get(active)).toBeUndefined()
      expect(notifyAttention).toHaveBeenCalledExactlyOnceWith({ title: '通知项目', body: '回答已就绪。' })
      await vi.waitFor(() => { expect(ctx.sessionTitle.get(active)?.title).toBe('会话通知修复') })
      complete(2)
      expect(notifyAttention).toHaveBeenCalledTimes(2)
      expect(notifyAttention).toHaveBeenLastCalledWith({
        title: ctx.sessionProjections.stateOf(active, 'title'), body: '回答已就绪。',
      })
    } finally {
      await notifications.dispose()
      await titles.dispose()
      await projections.dispose()
      await sessions.dispose()
    }
  })

  it('previews the final answer as plain text without prompt, reasoning, or earlier commentary', async () => {
    const harness = createHarness(['sessions'])
    const active = session('preview')
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionEvent(active, assistantMessage([{ type: 'text', text: 'Earlier commentary' }], 3))
    await harness.sessionEvent(active, assistantMessage([
      { type: 'reasoning', text: 'Private reasoning' },
      { type: 'text', text: '## 已完成\n**结果**：修复了通知。' },
      { type: 'text', text: '详情见[说明](https://example.com/private)。' },
    ], 4))
    expect(harness.notifyAttention).not.toHaveBeenCalled()
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    expect(harness.notifyAttention).toHaveBeenCalledExactlyOnceWith({
      title: 'Example session',
      body: '已完成 结果：修复了通知。 详情见说明。',
    })
    expect(JSON.stringify(harness.notifyAttention.mock.calls)).not.toMatch(/private|reasoning|secret|Earlier/iu)
  })

  it('bounds long previews without splitting emoji graphemes', async () => {
    const harness = createHarness(['sessions'])
    const active = session('long')
    const emoji = '👩🏽‍💻'
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionEvent(active, assistantMessage([{ type: 'text', text: emoji.repeat(401) }], 3))
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
    expect(harness.notifyAttention).toHaveBeenCalledWith({ title: 'Example session', body: `${emoji.repeat(400)}…` })
  })

  it('applies the preview switch live and never carries answers into later turns or sessions', async () => {
    const harness = createHarness()
    const settings = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)
    const active = session('private')
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionEvent(active, assistantMessage([{ type: 'text', text: 'Hidden answer' }], 3))
    await harness.updateSettings({ ...settings, showResponsePreview: false })
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 4))
    await harness.updateSettings(settings)
    for (const current of [active, session('other')]) {
      await harness.sessionEvent(current, event('turn/start', { turn: 2 }, 5))
      await harness.sessionEvent(current, userMessage('user', 6))
      // Late output from a different turn must not populate this turn's preview.
      await harness.sessionEvent(current, assistantMessage([{ type: 'text', text: 'Stale answer' }], 7, 1))
      await harness.sessionEvent(current, event('turn/end', { turn: 2, reason: { kind: 'completed' } }, 8))
    }
    expect(harness.notifyAttention).toHaveBeenCalledTimes(3)
    for (const [notification] of harness.notifyAttention.mock.calls) {
      expect(notification).toEqual({ title: 'Example session', body: 'A user-initiated turn has finished.' })
    }
  })

  it('falls back to a generic notice when the last message has no final answer', async () => {
    const harness = createHarness(['sessions'])
    const active = session('empty')
    for (const content of [
      [],
      [{ type: 'reasoning', text: 'Private thought' }],
      [{ type: 'text', text: '  \n  ' }],
      [{ type: 'text', text: 'Running a tool' }, { type: 'tool-call', id: 'call' as never, name: 'bash', arguments: 'secret' }],
    ] satisfies ContentBlock[][]) {
      await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
      await harness.sessionEvent(active, userMessage('user', 2))
      await harness.sessionEvent(active, assistantMessage([{ type: 'text', text: 'Earlier answer' }], 3))
      await harness.sessionEvent(active, assistantMessage(content, 4))
      await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    }
    expect(harness.notifyAttention).toHaveBeenCalledTimes(4)
    for (const [notification] of harness.notifyAttention.mock.calls) {
      expect(notification.body).toBe('A user-initiated turn has finished.')
    }
  })

  it('does not preview interrupted responses or failed turns', async () => {
    const harness = createHarness(['sessions'])
    const active = session('interrupted')
    for (const kind of ['completed', 'error'] as const) {
      await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
      await harness.sessionEvent(active, userMessage('user', 2))
      const response = assistantMessage([{ type: 'text', text: 'Partial answer' }], 3)
      await harness.sessionEvent(active, { ...response, data: { ...response.data, interrupted: true } })
      const reason = kind === 'error' ? { kind, error: { code: 'UNKNOWN' as const, message: 'Private error' } } : { kind }
      await harness.sessionEvent(active, event('turn/end', { turn: 1, reason }, 4))
    }
    expect(harness.notifyAttention).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(harness.notifyAttention.mock.calls)).not.toMatch(/Partial|Private/u)
  })

  it('delivers previews through real Cordis session events and removes the observer on disposal', async () => {
    const ctx = new Context()
    const notifyAttention = vi.fn()
    ctx.provide('desktopRuntime', { locale: 'zh', notifyAttention } as unknown as DesktopRuntime)
    const notifications = ctx.plugin({ name, inject, apply })
    const sessions = ctx.plugin(SessionStore)
    await notifications
    await sessions
    try {
      const active = ctx.sessions.create()
      active.append('session/title', { title: '真实会话标题', messageSeqs: [], source: { kind: 'user' } })
      const complete = (turn: number): void => {
        active.append('turn/start', { turn })
        active.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Prompt' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
        active.append('assistant/message', assistantMessage([{ type: 'text', text: '回答已就绪。' }], 0, turn).data, { surfaceOp: 'append' })
        active.append('turn/end', { turn, reason: { kind: 'completed' } })
      }
      complete(1)
      expect(notifyAttention).toHaveBeenCalledExactlyOnceWith({ title: '真实会话标题', body: '回答已就绪。' })
      await notifications.dispose()
      complete(2)
      expect(notifyAttention).toHaveBeenCalledOnce()
    } finally {
      await notifications.dispose()
      await sessions.dispose()
    }
  })

  it('registers live notification settings with the global switch enabled by default', () => {
    const harness = createHarness(['settings'])

    expect(name).toBe('desktop-notifications')
    expect(inject).toEqual(['desktopRuntime'])
    expect(String(DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE)).toBe('dsh-desktop-notifications')
    expect(DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)).toEqual({
      enabled: true,
      notifyOnTurnCompletion: true,
      notifyOnTurnFailure: true,
      notifyOnUserQuestion: true,
      notifyOnJobCompletion: true,
      notifyOnJobFailure: true,
      showResponsePreview: true,
    })
    expect(harness.registerSettings).toHaveBeenCalledWith(
      DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
      DesktopNotificationSettingsSchema,
      { applies: 'live' },
    )
  })

  it('notifies for completed and failed jobs without exposing job details', async () => {
    const harness = createHarness(['jobs', 'settings'])
    const snapshot = {
      id: 'bash-1' as JobId,
      kind: 'bash',
      label: 'node /Users/example/private.js --token secret',
      status: 'completed',
      detail: 'session-123',
      output: 'private output',
      startedAt: 1,
      finishedAt: 2,
      reported: false,
    } satisfies JobSnapshot & { output: string }

    await harness.jobDone(snapshot)
    await harness.jobDone({ ...snapshot, status: 'failed' })
    await harness.jobDone({ ...snapshot, status: 'killed' })

    expect(harness.notifyAttention.mock.calls).toEqual([
      [{ title: 'Background Job Completed', body: 'A background job has finished.' }],
      [{ title: 'Background Job Failed', body: 'A background job could not finish. Open DSH Desktop for details.' }],
    ])
    expect(JSON.stringify(harness.notifyAttention.mock.calls)).not.toMatch(/Users|private|secret|session-123/u)
  })

  it('applies live settings independently to successful and failed outcomes', async () => {
    const harness = createHarness()
    const snapshot = {
      id: 'bash-2' as JobId,
      kind: 'bash',
      label: 'build',
      status: 'completed',
      startedAt: 1,
      finishedAt: 2,
      reported: false,
    } satisfies JobSnapshot

    await harness.updateSettings({
      enabled: true,
      notifyOnTurnCompletion: false,
      notifyOnTurnFailure: true,
      notifyOnUserQuestion: true,
      notifyOnJobCompletion: false,
      notifyOnJobFailure: true,
      showResponsePreview: true,
    })
    await harness.jobDone(snapshot)
    await harness.jobDone({ ...snapshot, status: 'failed' })

    const active = session('session-1')
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))
    await harness.sessionEvent(active, event('turn/start', { turn: 2 }, 4))
    await harness.sessionEvent(active, userMessage('user', 5))
    await harness.sessionEvent(active, event('turn/end', {
      turn: 2,
      reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private error' } },
    }, 6))

    expect(harness.notifyAttention.mock.calls).toEqual([
      [{ title: 'Background Job Failed', body: 'A background job could not finish. Open DSH Desktop for details.' }],
      [{ title: 'Example session', body: 'A user-initiated turn could not finish. Open DSH Desktop for details.' }],
    ])
  })

  it('keeps fine-grained choices while the live global switch is disabled', async () => {
    const harness = createHarness()
    const snapshot = {
      id: 'bash-disabled' as JobId,
      kind: 'bash',
      label: 'build',
      status: 'completed',
      startedAt: 1,
      finishedAt: 2,
      reported: false,
    } satisfies JobSnapshot

    await harness.updateSettings({
      enabled: false,
      notifyOnTurnCompletion: true,
      notifyOnTurnFailure: true,
      notifyOnUserQuestion: true,
      notifyOnJobCompletion: true,
      notifyOnJobFailure: true,
      showResponsePreview: true,
    })
    await harness.jobDone(snapshot)

    const active = session('disabled')
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))

    expect(harness.notifyAttention).not.toHaveBeenCalled()
  })

  it('notifies only matching direct-user turn endings', async () => {
    const harness = createHarness(['sessions'])
    const direct = session('direct')
    const plugin = session('plugin')
    const subagent = session('subagent', 'subagent')

    await harness.sessionEvent(direct, event('turn/start', { turn: 7 }, 1))
    await harness.sessionEvent(direct, userMessage('user', 2))
    await harness.sessionEvent(direct, event('turn/end', { turn: 8, reason: { kind: 'completed' } }, 3))
    await harness.sessionEvent(direct, event('turn/end', { turn: 7, reason: { kind: 'completed' } }, 4))

    await harness.sessionEvent(plugin, event('turn/start', { turn: 1 }, 5))
    await harness.sessionEvent(plugin, userMessage('plugin', 6))
    await harness.sessionEvent(plugin, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 7))

    await harness.sessionEvent(subagent, event('turn/start', { turn: 1 }, 8))
    await harness.sessionEvent(subagent, userMessage('user', 9))
    await harness.sessionEvent(subagent, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 10))

    expect(harness.notifyAttention).toHaveBeenCalledOnce()
    expect(harness.notifyAttention).toHaveBeenCalledWith({
      title: 'Example session',
      body: 'A user-initiated turn has finished.',
    })
  })

  it('treats max-tokens as a failure and keeps non-failure endings silent', async () => {
    const harness = createHarness(['sessions'])
    const active = session('direct')
    const endings: Array<Extract<SessionEvent, { type: 'turn/end' }>['data']['reason']> = [
      { kind: 'max-tokens' },
      { kind: 'aborted', reason: { kind: 'user' } },
      { kind: 'blocked' },
      { kind: 'interrupted' },
    ]

    for (const [index, reason] of endings.entries()) {
      const turn = index + 1
      await harness.sessionEvent(active, event('turn/start', { turn }, turn * 3))
      await harness.sessionEvent(active, userMessage('user', turn * 3 + 1))
      await harness.sessionEvent(active, event('turn/end', { turn, reason } as never, turn * 3 + 2))
    }

    expect(harness.notifyAttention).toHaveBeenCalledOnce()
    expect(harness.notifyAttention).toHaveBeenCalledWith({
      title: 'Example session',
      body: 'A user-initiated turn could not finish. Open DSH Desktop for details.',
    })
  })

  it('drops open turn state when sessions detach and disposes optional observers', async () => {
    const harness = createHarness()
    const active = session('session-1')
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))

    harness.teardownSessions()
    harness.reattachSessions()
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))

    expect(harness.notifyAttention).not.toHaveBeenCalled()
    expect(harness.stopSessions).toHaveBeenCalledTimes(2)
    harness.dispose()
    expect(harness.stopSessions).toHaveBeenCalledTimes(4)
    expect(harness.stopJobs).toHaveBeenCalledOnce()
  })

  it('drops an unfinished turn when its session is disposed', async () => {
    const harness = createHarness(['sessions'])
    const active = session('session-1')
    await harness.sessionEvent(active, event('turn/start', { turn: 1 }, 1))
    await harness.sessionEvent(active, userMessage('user', 2))
    await harness.sessionDisposed(active)
    await harness.sessionEvent(active, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 3))

    expect(harness.notifyAttention).not.toHaveBeenCalled()
  })
})
