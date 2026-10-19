/**
 * 多根工作区（一个项目多文件夹）的补丁契约守卫。
 *
 * 这些补丁不是本仓库源码，而是用 `patch:` resolution 叠加在上游运行时包上的。
 * 一旦某个 resolution 回退成 `file:` 形式、或上游版本升级导致补丁不再应用，
 * 功能会**静默**失效（UI 仍然渲染，但 setRoots 不存在、roots 不授权）。
 * 因此这里把契约钉在测试里：任何一条断裂都让测试失败。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../', packageRoot)

const workspaceManifest = JSON.parse(
  readFileSync(new URL('package.json', workspaceRoot), 'utf8'),
) as { resolutions?: Record<string, string> }

/** 本轮多根能力依赖的上游包，全部必须是 patch 形式。 */
const PATCHED_RUNTIME_PACKAGES = [
  'dsh-workspace',
  'dsh-api-workspace-controller',
  'dsh-api-remotes',
  'dsh-sandbox',
  'dsh-sandbox-policy',
  'dsh-sandbox-local',
  'dsh-client-ui-workspace',
] as const

const RUNTIME_VERSION = '0.2.1-rc.2'

/** 读取一个补丁文件内容。 */
function readPatch(name: string): string {
  return readFileSync(new URL(`patches/${name}@${RUNTIME_VERSION}.patch`, workspaceRoot), 'utf8')
}

describe('multi-root workspace patch contract', () => {
  it.each(PATCHED_RUNTIME_PACKAGES)('resolves %s through its patch file', (name) => {
    const resolutions = workspaceManifest.resolutions ?? {}
    for (const range of [RUNTIME_VERSION, `^${RUNTIME_VERSION}`]) {
      const selector = `@deepseek-ai/${name}@npm:${range}`
      const value = resolutions[selector]
      expect(value, `${selector} must keep a patch resolution`).toBeDefined()
      expect(value, `${selector} must not fall back to a plain tarball`).toContain('patch:@deepseek-ai/')
      expect(value, `${selector} must point at this package's patch file`).toMatch(
        new RegExp(`#\\./patches/${name}@${RUNTIME_VERSION.replace(/\./g, '\\.')}\\.patch$`),
      )
    }
  })

  it('pins every patched package to one upstream runtime version', () => {
    const resolutions = workspaceManifest.resolutions ?? {}
    for (const name of PATCHED_RUNTIME_PACKAGES) {
      for (const range of [RUNTIME_VERSION, `^${RUNTIME_VERSION}`]) {
        const value = resolutions[`@deepseek-ai/${name}@npm:${range}`]
        // 补丁按精确版本制作；版本漂移会让 patch 上下文失配而无法应用。
        expect(value, `${name} ${range}`).toContain(`-${RUNTIME_VERSION}.tgz`)
      }
    }
  })

  it('keeps the workspace record backward compatible', () => {
    const patch = readPatch('dsh-workspace')
    // 旧的单路径记录必须能被投影成 roots，且不需要迁移存储版本。
    expect(patch).toContain('record.roots ?? [record.path]')
    // 至少一个根的守卫必须存在（registry 层）。
    expect(patch).toMatch(/at least one root|a workspace needs at least one root/)
  })

  it('exposes a setRoots verb and projects roots on WorkspaceView', () => {
    for (const name of ['dsh-api-workspace-controller', 'dsh-api-remotes']) {
      const patch = readPatch(name)
      expect(patch, `${name} must declare workspace/setRoots`).toContain('workspace/setRoots')
      expect(patch, `${name} must project roots`).toContain('roots')
    }
  })

  it('lets the sandbox authorize more than one writable root', () => {
    const patch = readPatch('dsh-sandbox')
    expect(patch).toContain('workspaceRoots')
    // 单根时必须与未打补丁行为等价：仍走 policy.workspaceRoot。
    expect(patch).toContain('policy.workspaceRoot')
  })

  it('derives the sandbox policy roots defensively', () => {
    const patch = readPatch('dsh-sandbox-policy')
    // 拿不到 registry 或多根时必须退回单根，不能返回空集合。
    expect(patch).toContain('workspaceRegistry')
    expect(patch).toMatch(/workspaceRoots/)
  })
})
