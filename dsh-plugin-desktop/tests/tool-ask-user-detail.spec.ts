import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { apply as applyAskUserTool } from '@deepseek-ai/dsh-tool-ask-user'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../', packageRoot)
const runtimeVersion = '0.1.5-rc.2'
const patchPath = `./patches/dsh-tool-ask-user@${runtimeVersion}.patch`
const patchResolution =
  `patch:@deepseek-ai/dsh-tool-ask-user@file%3Avendor/dsh-runtime/${runtimeVersion}` +
  `/deepseek-ai-dsh-tool-ask-user-${runtimeVersion}.tgz#${patchPath}`

const workspaceManifest = JSON.parse(readFileSync(new URL('package.json', workspaceRoot), 'utf8')) as {
  resolutions?: Record<string, unknown>
}
const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
const workspaceRequire = createRequire(new URL('package.json', packageRoot))
const installedRuntime = readFileSync(join(
  dirname(workspaceRequire.resolve('@deepseek-ai/dsh-tool-ask-user/package.json')),
  'lib/index.js',
), 'utf8')

interface SchemaProperty {
  type?: string
  description?: string
}

interface RegisteredAskUserTool {
  name: string
  parameters: {
    properties: {
      questions: {
        items: { properties: Record<string, SchemaProperty> }
      }
    }
  }
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

interface AskedQuestion extends Record<string, unknown> {
  id: string
}

/**
 * Registers the installed `ask_user_question` tool against a stub context and
 * records both the registered tool and the request it forwards to
 * `ctx.userQuestions`. Exercising the installed module proves the patched
 * runtime itself carries the contract, not merely that a patch file exists.
 */
function mountTool(): { tool: RegisteredAskUserTool; askedQuestions: () => AskedQuestion[] } {
  let tool: RegisteredAskUserTool | undefined
  let asked: AskedQuestion[] = []
  const ctx = {
    tools: {
      register(candidate: RegisteredAskUserTool): void {
        tool = candidate
      },
    },
    userQuestions: {
      async ask(request: { questions: AskedQuestion[] }): Promise<unknown> {
        asked = request.questions
        return { answers: request.questions.map((question) => ({ id: question.id, selected: [] })) }
      },
    },
  }
  applyAskUserTool(ctx as unknown as Parameters<typeof applyAskUserTool>[0])
  if (tool === undefined) throw new Error('ask_user_question was never registered')
  const registered = tool
  return { tool: registered, askedQuestions: () => asked }
}

const questionProperties = (tool: RegisteredAskUserTool): Record<string, SchemaProperty> =>
  tool.parameters.properties.questions.items.properties

describe('ask_user_question detail support', () => {
  it('resolves the vendored package through the desktop patch', () => {
    expect(workspaceManifest.resolutions).toMatchObject({
      [`@deepseek-ai/dsh-tool-ask-user@npm:${runtimeVersion}`]: patchResolution,
      [`@deepseek-ai/dsh-tool-ask-user@npm:^${runtimeVersion}`]: patchResolution,
    })
    expect(lockfile).toContain(`@deepseek-ai/dsh-tool-ask-user@patch:@deepseek-ai/dsh-tool-ask-user@file%3Avendor/dsh-runtime/${runtimeVersion}`)
    expect(installedRuntime).toContain('...question.detail !== void 0 ? { detail: question.detail } : {}')
  })

  it('exposes detail on the installed model-facing schema', () => {
    const { tool } = mountTool()

    expect(tool.name).toBe('ask_user_question')
    expect(Object.keys(questionProperties(tool))).toContain('detail')
    expect(questionProperties(tool).detail?.type).toBe('string')
  })

  it('forwards detail through the installed execute path', async () => {
    const { tool, askedQuestions } = mountTool()
    const detail = 'The **recommended** approach preserves `backward compatibility`.'

    await tool.execute({
      questions: [{
        id: 'choice',
        question: 'Which approach should I use?',
        detail,
        options: [{ label: 'Keep the contract', description: 'No migration needed.' }],
      }],
    }, {})

    expect(askedQuestions()).toHaveLength(1)
    expect(askedQuestions()[0]).toMatchObject({
      id: 'choice',
      question: 'Which approach should I use?',
      detail,
    })
  })

  it('omits detail when the model does not supply it', async () => {
    const { tool, askedQuestions } = mountTool()

    await tool.execute({
      questions: [{ id: 'choice', question: 'Which approach should I use?' }],
    }, {})

    const [forwarded] = askedQuestions() as [AskedQuestion]
    expect(Object.keys(forwarded)).not.toContain('detail')
  })

  it('marks question and option fields as plain text and detail as Markdown-capable', () => {
    const { tool } = mountTool()
    const properties = questionProperties(tool)

    expect(properties.question?.description).toContain('plain text')
    expect(properties.question?.description).toContain('Markdown is not rendered here')
    expect(properties.detail?.description).toContain('Markdown is allowed')
    expect(installedRuntime).toContain('description: "Optional short plain-text heading for the question')
    expect(installedRuntime).toContain('description: "Short plain-text user-facing option label."')
    expect(installedRuntime).toContain('description: "One sentence of plain text explaining the tradeoff or impact."')
  })
})
