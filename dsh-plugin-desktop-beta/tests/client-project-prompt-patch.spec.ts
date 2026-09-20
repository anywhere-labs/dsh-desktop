import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL(
  '../../patches/dsh-client-ui-workspace@0.1.6-alpha.2.patch',
  import.meta.url,
), 'utf8')

describe('alpha.2 workspace client project-prompt patch', () => {
  it('adds the workspace-row command and its editor without touching the other rows', () => {
    for (const marker of [
      'id: "project-prompt",',
      'label: t("projectPrompt"),',
      'IconPersonalizationOutline16',
      'if (id !== "rename" && id !== "delete" && id !== "project-prompt") return;',
      'if (id === "project-prompt") actions.prompt();',
      'else if (id === "rename") actions.rename();',
      'onPromptRequest(group.workspaceId, group.label, group.cwd);',
      'onPromptRequest: (workspaceId, label, cwd) => {',
      'open: promptTarget !== null,',
      'placeholder: t("projectPromptPlaceholder"),',
      'children: t("projectPromptSave")',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('stores the prompt in the DSH settings document, never in the project tree', () => {
    for (const marker of [
      'const PROJECT_PROMPT_NS = "project-prompt";',
      'readProjectPrompt: async (path) => {',
      'writeProjectPrompt: async (path, text) => {',
      'ctx.remote.settings.describe()',
      'ctx.remote.settings.update(PROJECT_PROMPT_NS, { prompts }, view?.revision)',
      'const text = prompts[projectPromptKeyOf(path)];',
      'prompts[projectPromptKeyOf(path)] = text;',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('injects the prompt as the first runtime context through a variable', () => {
    for (const marker of [
      'scope.settings.register(PROJECT_PROMPT_NS, z.object({',
      'scope.systemPrompt.variable(PROJECT_PROMPT_VARIABLE, (context) => {',
      'const cwd = context?.agent?.session?.header?.cwd;',
      'name: "project-prompt",',
      'order: 100,',
      'text: `{{${PROJECT_PROMPT_VARIABLE}}}`',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('bounds the injected block instead of trusting user text with the budget', () => {
    for (const marker of [
      'PROJECT_PROMPT_MAX_BYTES = 32768;',
      'maxBytes: z.number().default(PROJECT_PROMPT_MAX_BYTES),',
      'if (dropped.length > 0) lines.push(',
      'if (clipped !== void 0) lines.push(',
      'return text === "" ? "" : compose([{',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('folds case only for a Windows spelling so POSIX projects stay distinct', () => {
    expect(patch).toContain('WINDOWS_PATH = /^(?:[A-Za-z]:|\\/\\/)/')
    expect(patch).toContain('WINDOWS_PATH.test(normalized) ? normalized.toLowerCase() : normalized;')
    expect(patch).not.toContain('replace(/\\/+$/, "").toLowerCase()')
  })

  it('declares the services and the dependency the patched halves now use', () => {
    for (const marker of [
      '"remote.settings",',
      '"@deepseek-ai/dsh-client-ui-settings",',
      '"@deepseek-ai/schemastery": "^3.18.2"',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('keeps the published type surface in step with the runtime change', () => {
    for (const marker of [
      'projectPromptPlaceholder: string;',
      'projectPromptNoFolder: string;',
      "import type { Context } from '@deepseek-ai/cordis';",
      'export declare function apply(ctx: Context): void;',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('localizes both dictionaries', () => {
    for (const marker of [
      '"projectPrompt": "项目提示词",',
      '"projectPromptNoFolder": "该工作区没有可用的文件夹路径。",',
      '"projectPrompt": "Project prompt",',
      '"projectPromptNoFolder": "This workspace has no folder path.",',
    ]) {
      expect(patch).toContain(marker)
    }
  })
})
