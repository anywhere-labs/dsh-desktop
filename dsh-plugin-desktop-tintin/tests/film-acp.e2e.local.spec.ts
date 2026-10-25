import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilmAgentManager } from '../src/tintin/film-acp'

/** 真实端到端(2026-10-25 用户要求"自己先测试"): 真实服务端 /llm + /mcp + 真实补丁。 */
describe('film agent e2e against the live server', () => {
  it('completes a prompt round trip', async () => {
    const home = mkdtempSync(join(tmpdir(), 'tintin-e2e-home-'))
    const project = mkdtempSync(join(tmpdir(), 'tintin-e2e-proj-'))
    const events: Array<Record<string, unknown>> = []
    const manager = new FilmAgentManager({
      channelHome: home,
      serverUrl: () => 'http://192.168.111.31:8000',
      onEvent: (u) => {
        events.push(u.event as unknown as Record<string, unknown>)
        if (u.event.kind === 'update') console.log('[update]', JSON.stringify(u.event.update).slice(0, 160))
      },
      log: (m) => console.log('[film-acp]', m),
    })
    const info = await manager.begin(project)
    expect(info.sessionId).toBeTruthy()
    await manager.prompt(project, '只回复两个字母: ok')
    const deadline = Date.now() + 120_000
    let done: Record<string, unknown> | null = null
    while (Date.now() < deadline) {
      done = (events.find((e) => e.kind === 'done') as Record<string, unknown> | undefined) ?? null
      if (done) break
      await new Promise((r) => setTimeout(r, 400))
    }
    expect(done, `120s 内未完成; 事件: ${JSON.stringify(events.slice(-6))}`).toBeTruthy()
    expect(done!.ok).toBe(true)
  }, 180_000)
})
