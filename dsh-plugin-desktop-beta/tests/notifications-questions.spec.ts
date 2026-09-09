import { Context } from '@deepseek-ai/cordis'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { UserQuestionService, type AskUserQuestionAnswer, type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, DesktopNotificationSettingsSchema, inject, name, type DesktopNotificationSettings } from '../src/notifications.ts'
import type { DesktopRuntime } from '../src/runtime.ts'

type QuestionAgent = NonNullable<AskUserQuestionRequest['agent']>
const cleanup: Array<() => Promise<void>> = []
const ANSWER: AskUserQuestionAnswer = { answers: [{ id: 'goal', selected: ['Research'] }] }
const QUESTIONS = [{ id: 'goal', question: '**What would you like to do?**',
  detail: 'Private supporting detail', options: [{ label: 'Research', description: 'Private option detail' }] }]

async function harness() {
  const ctx = new Context()
  const notifyAttention = vi.fn()
  let settings = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)
  let watcher: ((value: DesktopNotificationSettings) => void) | undefined
  ctx.provide('desktopRuntime', { locale: 'en', notifyAttention } as unknown as DesktopRuntime)
  ctx.provide('settings', { register: () => ({
    get: () => settings,
    watch: (callback: typeof watcher) => { watcher = callback; return () => { watcher = undefined } },
  }) } as unknown as Context['settings'])
  const agents: QuestionAgent[] = []
  ctx.provide('agents', {
    get: (id: QuestionAgent['id']) => agents.find(agent => agent.id === id),
    roots: () => agents,
  } as unknown as Context['agents'])
  const sessions = ctx.plugin(SessionStore)
  const questions = ctx.plugin(UserQuestionService)
  await sessions
  await questions
  const waiting: Array<{ resolve: (answer: AskUserQuestionAnswer) => void; reject: (reason: Error) => void }> = []
  const answerer = vi.fn((request: AskUserQuestionRequest) => {
    let resolve!: (answer: AskUserQuestionAnswer) => void
    let reject!: (reason: Error) => void
    const answer = new Promise<AskUserQuestionAnswer>((accept, decline) => { resolve = accept; reject = decline })
    waiting.push({ resolve, reject })
    const abort = (): void => { reject(new Error('Question cancelled')) }
    request.signal?.addEventListener('abort', abort, { once: true })
    return answer.finally(() => { request.signal?.removeEventListener('abort', abort) })
  })
  // The observer must run even when an existing UI answerer claims the waterfall.
  const stopAnswerer = ctx.on('user-questions/request', answerer)
  const notifications = ctx.plugin({ name, inject, apply })
  await notifications
  cleanup.push(async () => {
    await notifications.dispose()
    for (const pending of waiting) pending.resolve(ANSWER)
    stopAnswerer()
    await questions.dispose()
    await sessions.dispose()
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const agent = (title: string): QuestionAgent => {
    const session = ctx.sessions.create()
    session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
    const value = { id: session.id, session } as unknown as QuestionAgent
    agents.push(value)
    return value
  }
  return {
    ctx, agent, notifyAttention, answerer, waiting, notifications, stopAnswerer,
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

describe('pending model question notifications', () => {
  it('notifies once for a question group before the turn ends and preserves the UI answer', async () => {
    const h = await harness()
    const agent = h.agent('Research task')
    const questions = [...QUESTIONS, { id: 'format', question: 'Which format?' }, { id: 'language', question: 'Which language?' }]
    const answer = h.ctx.userQuestions.ask({ agent, questions })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.answerer).toHaveBeenCalledOnce()
    expect(h.notifyAttention).toHaveBeenCalledExactlyOnceWith({
      title: 'Research task', body: 'Your answer is needed. What would you like to do? Which format? Which language?',
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.notifyAttention).toHaveBeenCalledOnce()
    expect(JSON.stringify(h.notifyAttention.mock.calls)).not.toContain('Private')
    h.waiting[0]!.resolve(ANSWER)
    await expect(answer).resolves.toBe(ANSWER)
  })

  it('keeps concurrent sessions separate and reads renames at delivery time', async () => {
    const h = await harness()
    const first = h.agent('Old name')
    const second = h.agent('Second task')
    const answers = [first, second].map(agent => h.ctx.userQuestions.ask({ agent, questions: QUESTIONS }))
    first.session.append('session/title', { title: 'New name', messageSeqs: [], source: { kind: 'user' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention.mock.calls.map(([notification]) => notification.title)).toEqual(['New name', 'Second task'])
    h.waiting[1]!.resolve(ANSWER)
    h.waiting[0]!.resolve(ANSWER)
    await expect(Promise.all(answers)).resolves.toEqual([ANSWER, ANSWER])
  })

  it('notifies independently of completion settings and honors the live content-preview choice', async () => {
    const h = await harness()
    h.setSettings({ notifyOnTurnCompletion: false })
    const answer = h.ctx.userQuestions.ask({ agent: h.agent('Task'), questions: QUESTIONS })
    h.setSettings({ showResponsePreview: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).toHaveBeenCalledExactlyOnceWith({ title: 'Task', body: 'Your answer is needed.' })
    h.waiting[0]!.resolve(ANSWER)
    await expect(answer).resolves.toBe(ANSWER)
  })

  it.each(['enabled', 'notifyOnUserQuestion'] as const)('honors the live %s switch without intercepting the question', async (key) => {
    const h = await harness()
    const answer = h.ctx.userQuestions.ask({ agent: h.agent('Task'), questions: QUESTIONS })
    h.setSettings({ [key]: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
    expect(h.answerer).toHaveBeenCalledOnce()
    h.waiting[0]!.resolve(ANSWER)
    await expect(answer).resolves.toBe(ANSWER)
  })

  it('does not notify for an immediately answered request or one without a UI answerer', async () => {
    const h = await harness()
    const agent = h.agent('Task')
    h.answerer.mockResolvedValueOnce(ANSWER)
    await expect(h.ctx.userQuestions.ask({ agent, questions: QUESTIONS })).resolves.toBe(ANSWER)
    h.stopAnswerer()
    await expect(h.ctx.userQuestions.ask({ agent, questions: QUESTIONS })).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
  })

  it('suppresses cancelled requests and preserves cancellation errors', async () => {
    const h = await harness()
    const controller = new AbortController()
    const request = { agent: h.agent('Task'), questions: QUESTIONS, signal: controller.signal }
    const answer = h.ctx.userQuestions.ask(request)
    const rejected = expect(answer).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    controller.abort()
    await rejected
    await expect(h.ctx.userQuestions.ask(request)).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
  })

  it.each(['session', 'plugin'] as const)('cancels queued notifications on %s disposal', async (kind) => {
    const h = await harness()
    const agent = h.agent('Task')
    const answer = h.ctx.userQuestions.ask({ agent, questions: QUESTIONS })
    if (kind === 'plugin') await h.notifications.dispose()
    else h.ctx.emit('session/disposed', agent.session)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.notifyAttention).not.toHaveBeenCalled()
    h.waiting[0]!.resolve(ANSWER)
    await expect(answer).resolves.toBe(ANSWER)
  })

  it('bounds question previews at 400 visible characters', async () => {
    const h = await harness()
    const emoji = '👩🏽‍💻'
    const answer = h.ctx.userQuestions.ask({ agent: h.agent('Task'), questions: [{ id: 'long', question: emoji.repeat(401) }] })
    await vi.advanceTimersByTimeAsync(0)
    const body: string = h.notifyAttention.mock.calls[0]![0].body
    expect(body).toBe(`Your answer is needed. ${emoji.repeat(377)}…`)
    h.waiting[0]!.resolve(ANSWER)
    await expect(answer).resolves.toBe(ANSWER)
  })

  it('keeps the question answerable if native notification delivery fails', async () => {
    const h = await harness()
    h.notifyAttention.mockImplementation(() => { throw new Error('Native notifications unavailable') })
    const answer = h.ctx.userQuestions.ask({ agent: h.agent('Task'), questions: QUESTIONS })
    await vi.advanceTimersByTimeAsync(0)
    expect(h.answerer).toHaveBeenCalledOnce()
    h.waiting[0]!.resolve(ANSWER)
    await expect(answer).resolves.toBe(ANSWER)
  })
})
