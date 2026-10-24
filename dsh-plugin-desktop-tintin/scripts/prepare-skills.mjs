// 打包前把内置的 openfilm 技能(SKILL.md)复制进频道包资源 —— 随 extraResources
// 落到 resources\skills\openfilm\, 供影片智能体 home 同步与聊天原生技能清单读取。
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', 'dsh-tintin-bundle', 'resources', 'skills', 'openfilm', 'SKILL.md')
const target = join(here, 'resources', 'skills', 'openfilm', 'SKILL.md')
mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log('prepare-skills: openfilm SKILL.md -> resources/skills/openfilm/')
