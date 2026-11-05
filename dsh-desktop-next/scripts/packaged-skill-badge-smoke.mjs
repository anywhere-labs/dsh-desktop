/** Load the bundled badge skill from one packaged Next archive through the Host's resolver and check that the directory it announces is physical; no window, no input. */
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.argv[2]
if (!root) throw new Error('packaged-skill-badge-smoke: expected the packaged application root')
const { installSkillBadgeResolution, SKILL_BADGE_PACKAGE } = await import(pathToFileURL(join(root, 'lib', 'host-resolution.js')).href)
if (installSkillBadgeResolution(root) === undefined) throw new Error(`packaged-skill-badge-smoke: ${root} is not an archive`)
// The loader imports the provider by name from the application root; the module must come back physical.
const entry = createRequire(join(root, 'package.json')).resolve(SKILL_BADGE_PACKAGE)
if (!entry.includes('app.asar.unpacked')) throw new Error(`packaged-skill-badge-smoke: ${SKILL_BADGE_PACKAGE} resolved inside the archive: ${entry}`)
// Its skill registry import must stay the archive's copy, the one the Host's own registry is loaded from.
const registry = createRequire(entry).resolve('@deepseek-ai/dsh-skill')
if (registry.includes('app.asar.unpacked')) throw new Error(`packaged-skill-badge-smoke: @deepseek-ai/dsh-skill resolved outside the archive: ${registry}`)
const { apply } = await import(pathToFileURL(entry).href)
let provider
apply({ skills: { registerProvider(factory) { provider = factory() } } })
if (provider === undefined) throw new Error('packaged-skill-badge-smoke: the provider did not register')
const [candidate] = await provider.list()
const directory = candidate?.resourceBase?.kind === 'directory' ? candidate.resourceBase.path : undefined
if (directory === undefined || !directory.includes('app.asar.unpacked')) throw new Error(`packaged-skill-badge-smoke: the skill announces a directory inside the archive: ${String(directory)}`)
// A physical file answers a bigint stat with bigint fields, as the Host's filesystem service requires; an archived entry does not.
const png = statSync(join(directory, 'dsh-badge.png'), { bigint: true })
if (typeof png.size !== 'bigint' || png.size === 0n) throw new Error(`packaged-skill-badge-smoke: dsh-badge.png is not a physical file in ${directory}`)
const skill = await provider.get(candidate)
if (typeof skill.content !== 'string' || !skill.content.includes('dsh-badge.png')) throw new Error('packaged-skill-badge-smoke: the skill body does not name its PNG')
console.log(`Packaged badge skill loaded from ${directory}: ${String(png.size)} byte PNG`)
