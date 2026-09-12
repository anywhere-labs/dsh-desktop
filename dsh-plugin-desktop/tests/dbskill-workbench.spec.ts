import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', 'dbskill-workbench')

describe('dbskill workbench artifact', () => {
  it('offers a searchable 24-tool launcher that returns users to DSH', () => {
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    const script = readFileSync(join(root, 'app.js'), 'utf8')

    expect(html).toContain('data-search')
    expect(html).toContain('可评估、可学习，不等于已获商业授权')
    expect(script.match(/\['(?:诊断|内容|系统|行动|学习|决策)',/g)).toHaveLength(24)
    expect(script).toContain('复制指令并返回对话')
    expect(script).toContain('function dshHomeUrl()')
    expect(script).toContain("window.location.assign(dshHomeUrl())")
  })
})
