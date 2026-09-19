/** Verify bundled skill discovery through the real local filesystem backend. */
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { dirname, join } from 'node:path'

export async function verifyBundledSkills(applicationRoot: string): Promise<void> {
  const skillsRoot = join(applicationRoot, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'cordis', 'skills')
  const ctx = new Context()
  try {
    await ctx.plugin(LocalFileSystem, { cwd: applicationRoot })
    for (const path of [dirname(applicationRoot), applicationRoot, skillsRoot]) {
      const target = await ctx.fs.resolve(path)
      const first = await ctx.fs.stat(target)
      const second = await ctx.fs.stat(target)
      if (first?.type !== 'directory' || first.version !== second?.version) {
        throw new Error(`packaged directory has invalid or unstable metadata: ${path}`)
      }
      if ((await ctx.fs.lstat(path))?.type !== 'directory') {
        throw new Error(`packaged directory lstat failed: ${path}`)
      }
      await ctx.fs.listDir(target)
    }
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false, bundledSkillDir: skillsRoot, watch: false,
    })
    const snapshot = await ctx.skills.snapshot()
    if (!snapshot.complete) throw new Error('packaged skill discovery was incomplete')
    for (const name of ['editing-cordis-compositions', 'cordis-plugin-development']) {
      if (!snapshot.skills.some(skill => skill.name === name)
        || !(await ctx.skills.get(name))?.content.trim()) {
        throw new Error(`bundled skill is unavailable: ${name}`)
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
}
