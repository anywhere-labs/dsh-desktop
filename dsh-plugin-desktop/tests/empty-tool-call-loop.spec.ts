import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'

type ExecuteToolCalls = (
  ctx: {
    agents: { requireInitiator(): { session: SessionRecorder } }
    tools: {
      executionMode(exec: unknown): { kind: 'exclusive' | 'parallel' }
      [TOOL_RUNTIME_SCHEDULER]: {
        prepare(exec: unknown): Promise<unknown>
        dispatch(exec: unknown): Promise<unknown>
        finalize(exec: unknown, result: unknown): unknown
        finish(exec: unknown, result: unknown): unknown
      }
    }
    agentLoop: { config: { maxParallelToolCalls: number } }
  },
  turn: number,
  step: number,
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  signal: AbortSignal,
  acceptContext: (context: unknown) => void,
) => Promise<{ concluded: boolean }>

type SessionEventRecord = {
  type: string
  data: unknown
  options: unknown
}

class SessionRecorder {
  readonly events: SessionEventRecord[] = []

  append(type: string, data: unknown, options?: unknown): { seq: number } {
    this.events.push({ type, data, options })
    return { seq: this.events.length }
  }
}

const require = createRequire(import.meta.url)
const agentLoopPackageJson = require.resolve('@deepseek-ai/dsh-agent-loop/package.json')
const agentLoopLibPath = join(dirname(agentLoopPackageJson), 'lib/index.js')
const cleanupPaths = new Set<string>()

afterEach(() => {
  vi.restoreAllMocks()
  for (const path of cleanupPaths) rmSync(path, { force: true, recursive: true })
  cleanupPaths.clear()
})

async function loadExecuteToolCalls(): Promise<ExecuteToolCalls> {
  const original = readFileSync(agentLoopLibPath, 'utf8')
  const patched = `${original}\nexport { executeToolCalls };\n`
  const tempDir = mkdtempSync(join(tmpdir(), 'dsh-agent-loop-'))
  cleanupPaths.add(tempDir)
  const tempFile = join(tempDir, 'index.mjs')
  writeFileSync(tempFile, patched)
  const module = await import(`${pathToFileURL(tempFile).href}?t=${Date.now()}`)
  return module.executeToolCalls as ExecuteToolCalls
}

describe('empty tool-call handling', () => {
  it('fails once with a clear terminal result instead of entering the unknown-tool dispatch path', async () => {
    const executeToolCalls = await loadExecuteToolCalls()
    const session = new SessionRecorder()
    const prepare = vi.fn(async (exec: { name: string }) => ({
      kind: 'final-result',
      exec,
      result: {
        content: [{ type: 'text', text: `Error: unknown tool "${exec.name}"` }],
        isError: true,
      },
    }))
    const dispatch = vi.fn()
    const finalize = vi.fn()
    const finish = vi.fn((_exec: unknown, result: unknown) => result)

    const result = await executeToolCalls({
      agents: {
        requireInitiator: () => ({ session }),
      },
      tools: {
        executionMode: () => ({ kind: 'parallel' }),
        [TOOL_RUNTIME_SCHEDULER]: {
          prepare,
          dispatch,
          finalize,
          finish,
        },
      },
      agentLoop: {
        config: { maxParallelToolCalls: 1 },
      },
    }, 1, 1, [
      {
        id: 'valid-call',
        name: 'known-tool',
        arguments: '{}',
      },
      {
        id: '',
        name: '',
        arguments: '{}',
      },
    ], new AbortController().signal, () => {})

    expect(result).toEqual({ concluded: true })
    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      callId: 'valid-call',
      name: 'known-tool',
    }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(finalize).not.toHaveBeenCalled()
    expect(finish).toHaveBeenCalledOnce()
    expect(session.events).toHaveLength(4)
    expect(session.events[2]).toMatchObject({
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: '',
        name: '',
        arguments: '{}',
      },
    })
    expect(session.events[3]).toMatchObject({
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'user',
          content: [{
            type: 'tool-result',
            toolCallId: '',
            isError: true,
            content: [{
              type: 'text',
              text: expect.stringContaining('empty tool name'),
            }],
          }],
        },
      },
      options: {
        surfaceOp: 'append',
        sourceEventSeqs: [3],
      },
    })
    expect(session.events[3]).toMatchObject({
      data: {
        message: {
          content: [{
            content: [{
              text: expect.stringContaining('Start a new session'),
            }],
          }],
        },
      },
    })
  })
})
