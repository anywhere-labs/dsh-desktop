import { describe, expect, it } from 'vitest'
import { apply } from '@deepseek-ai/dsh-client-ui-workspace'

/**
 * The workspace picker's host half is patched to own one user-authored prompt
 * per absolute workspace directory. These specs drive the *installed* patched
 * bundle, so a patch that stops applying — or silently loses a clause — fails
 * here instead of in the product.
 */
const mount = apply as unknown as (ctx: unknown) => void

interface RegisteredSchema {
  (value: unknown): { maxBytes: number; prompts: Record<string, string> }
}

interface Harness {
  readonly contexts: readonly { name: string; order: number; text: string }[]
  readonly register: RegisteredSchema
  set(value: unknown): void
  render(cwd: string): string
}

function harness(): Harness {
  let schema: RegisteredSchema | undefined
  let variable: { provider: (context: unknown) => string | undefined } | undefined
  const contexts: { name: string; order: number; text: string }[] = []
  let value: unknown

  const scope = {
    settings: {
      register: (_ns: string, received: RegisteredSchema) => {
        schema = received
        return { get: () => value }
      },
    },
    systemPrompt: {
      variable: (_name: string, provider: (context: unknown) => string | undefined) => {
        variable = { provider }
      },
      context: (entry: { name: string; order: number; text: string }) => {
        contexts.push(entry)
      },
    },
  }

  mount({
    inject: (_names: readonly string[], callback: (scope: unknown) => void) => {
      callback(scope)
    },
  })

  return {
    contexts,
    register: (input) => schema!(input),
    set: (next) => { value = next },
    render: (cwd) => variable!.provider({ agent: { session: { header: { cwd } } } }) ?? '',
  }
}

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

describe('project-prompt host half', () => {
  it('registers one variable-driven runtime context ahead of the policy contexts', () => {
    const subject = harness()
    expect(subject.contexts).toEqual([
      { name: 'project-prompt', order: 100, text: '{{project_prompt_text}}' },
    ])
  })

  it('resolves the documented schema defaults', () => {
    const subject = harness()
    expect(subject.register({ prompts: {} })).toEqual({ maxBytes: 32768, prompts: {} })
  })

  it('renders nothing while no directory prompt is stored', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: {} })
    expect(subject.render('D:/proj')).toBe('')
  })

  it('renders the ancestor chain broad to specific', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: { 'd:/proj': 'ROOT', 'd:/proj/sub': 'CHILD' } })
    const text = subject.render('D:/proj/sub')
    expect(text).toContain('ROOT')
    expect(text).toContain('CHILD')
    expect(text.indexOf('ROOT')).toBeLessThan(text.indexOf('CHILD'))
  })

  it('ignores a blank prompt, so clearing the editor removes it', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: { 'd:/proj': '   ' } })
    expect(subject.render('D:/proj')).toBe('')
  })

  it('tolerates a malformed namespace section', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: null })
    expect(subject.render('D:/proj')).toBe('')
  })

  it('ignores an unrelated working directory', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: { 'd:/proj': 'X' } })
    expect(subject.render('D:/other')).toBe('')
  })

  it('folds case for a Windows spelling, so lowercase keys keep matching', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: { 'd:/desktop/dsh-desktop': 'WIN' } })
    expect(subject.render('D:\\DeskTop\\DSH-Desktop')).toContain('WIN')
  })

  it('carries a prompt containing braces verbatim', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: { 'd:/proj': 'use {{evil}} literally' } })
    expect(subject.render('D:/proj')).toContain('use {{evil}} literally')
  })

  it('keeps the most specific directory and names what the budget dropped', () => {
    const subject = harness()
    const filler = 'b'.repeat(400)
    subject.set({ maxBytes: 700, prompts: { 'd:/p': filler, 'd:/p/sub': filler } })
    const text = subject.render('D:/p/sub')
    expect(text).toContain('### D:\\p\\sub')
    expect(text).not.toContain('### D:\\p\n')
    expect(text).toContain('字节上限')
    expect(text).toContain('D:\\p')
    expect(byteLength(text)).toBeLessThanOrEqual(700)
  })

  it('drops the context entirely when not even the deepest prompt fits', () => {
    const subject = harness()
    subject.set({ maxBytes: 10, prompts: { 'd:/p': 'x'.repeat(100) } })
    expect(subject.render('D:/p')).toBe('')
  })

  // path.resolve() rewrites a POSIX-absolute spelling on win32, so this
  // property is only observable on a POSIX host.
  it.skipIf(process.platform === 'win32')('keeps distinct POSIX directories apart', () => {
    const subject = harness()
    subject.set({ maxBytes: 32768, prompts: { '/srv/App': 'UPPER', '/srv/app': 'lower' } })
    expect(subject.render('/srv/App')).toContain('UPPER')
    expect(subject.render('/srv/app')).toContain('lower')
  })
})
