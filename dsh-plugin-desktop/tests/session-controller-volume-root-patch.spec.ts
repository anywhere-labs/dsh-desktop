import { readFileSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parse } from 'node:path'
import { describe, expect, it } from 'vitest'

// Derived, not hand-written: the channel's pinned core is the single source of truth
// for the patch filename, so a core bump does not strand this spec on a deleted patch.
const runtimeVersion = String(JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).dependencies['@deepseek-ai/dsh'])
const patch = readFileSync(new URL(
  `../../patches/dsh-api-session-controller@${runtimeVersion}.patch`,
  import.meta.url,
), 'utf8')
const guard = 'if (!await stat(cwd).then((info) => info.isDirectory(), () => false)) {'
const failure = 'throw new Error(`failed to ensure project directory "${cwd}": ${String(error)}`, { cause: error });'

describe('session controller volume-root project directory patch', () => {
  it('accepts an existing project directory that mkdir rejected and keeps every other failure', () => {
    expect(patch).toContain('+import { mkdir, stat } from "node:fs/promises";')
    expect(patch).toContain(`+\t\t\t${guard}`)
    expect(patch).toContain(`-\t\t\t${failure}`)
    expect(patch).toContain(`+\t\t\t\t${failure}`)
  })

  it('reaches the session controller this channel resolves', () => {
    const entry = createRequire(new URL('../package.json', import.meta.url)).resolve('@deepseek-ai/dsh-api-session-controller')
    const installed = readFileSync(entry, 'utf8')
    expect(installed).toContain('import { mkdir, stat } from "node:fs/promises";')
    expect(installed).toContain(guard)
  })

  // The platform behaviour the patch exists for. If Node or Windows ever reports EEXIST
  // here, the patch is no longer needed for volume roots.
  it.runIf(process.platform === 'win32')('sees Windows reject mkdir on an existing volume root that is a directory', async () => {
    const root = parse(process.cwd()).root
    await expect(mkdir(root, { recursive: true })).rejects.toMatchObject({ code: 'EPERM' })
    expect((await stat(root)).isDirectory()).toBe(true)
  })
})
