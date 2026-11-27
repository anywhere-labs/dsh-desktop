import { expect, it } from 'vitest'
import { localizeInstalledDialog } from '../../scripts/upstream-family/localize-install.ts'

it('resolves the installed subject in the current language without replacing its technical identity', () => {
  const subject = { spec: 'link:/local/plugin', name: '@example/plugin', description: 'Manifest description' }
  const install = { phase: 'done', installed: '@example/plugin', subject }
  const packages = [{ name: '@example/plugin', installed: true, meta: {
    title: { zh: '插件', en: 'Plugin' }, description: { zh: '中文说明', en: 'English description' },
  } }]
  for (const language of ['zh', 'en'] as const) {
    const result = localizeInstalledDialog(install, packages, text => (text as Record<string, string>)[language]!)
    expect(result.subject).toMatchObject({ ...subject, displayTitle: packages[0]!.meta.title[language], description: packages[0]!.meta.description[language] })
    expect(result.installed).toBe(install.installed)
  }
  expect(install.subject).toBe(subject)
  expect(install.subject.description).toBe('Manifest description')
  expect(localizeInstalledDialog(install, [], () => '')).toBe(install)
  const pending = { ...install, phase: 'running' }
  expect(localizeInstalledDialog(pending, packages, () => '')).toBe(pending)
})

it('the patched official dialog uses localized metadata for a confirmed install', async () => {
  const { createRequire } = await import('node:module')
  const { readFileSync } = await import('node:fs')
  const ts = await import('typescript')
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-plugin-manager/client'), 'utf8')
  const parsed = ts.createSourceFile('client.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const functions = new Map<string, string>()
  const visit = (node: import('typescript').Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(parsed))
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  const localize = new Function(`return (${functions.get('localizeInstalledDialog')})`)() as typeof localizeInstalledDialog
  const render = new Function('react_jsx_runtime', 'SubjectBlock', 'SUBJECT_KIND_KEYS', `return (${functions.get('SubjectCard')})`)(
    { jsx: (_component: unknown, props: unknown) => props }, 'subject', {},
  )
  const state = localize({ phase: 'done', installed: 'fixture', subject: { spec: 'link:/fixture', name: 'fixture', description: 'English manifest' } },
    [{ name: 'fixture', installed: true, meta: { title: 'local-title', description: 'local-description' } }],
    text => text === 'local-title' ? '本地化名称' : '本地化说明')
  const result = render({ subject: state.subject, confirmed: { title: 'Original title', version: '1.0' }, t: (key: string) => key })
  expect(result.lines).toMatchObject({ spec: 'link:/fixture', title: '本地化名称', description: '本地化说明', version: '1.0' })
  expect(source).toContain('install:localizeInstalledDialog(state.install,state.packages,resolveText)')
})
