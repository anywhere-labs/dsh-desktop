import { describe, expect, it } from 'vitest'
import {
  DESKTOP_OPEN_WORKSPACE_GLOBAL,
  DESKTOP_PENDING_WORKSPACE_GLOBAL,
  desktopOpenWorkspaceScript,
} from '../src/launch-workspace-contract.ts'

/** Evaluate the delivery script against one stand-in page object. */
function run(path: string, page: Record<string, unknown>): unknown {
  return new Function('window', `return ${desktopOpenWorkspaceScript(path)}`)(page) as unknown
}

describe('Desktop open workspace script', () => {
  it('names both page seams', () => {
    expect(DESKTOP_OPEN_WORKSPACE_GLOBAL).toBe('__DSH_DESKTOP_OPEN_WORKSPACE__')
    expect(DESKTOP_PENDING_WORKSPACE_GLOBAL).toBe('__DSH_DESKTOP_PENDING_WORKSPACE__')
    const source = desktopOpenWorkspaceScript('C:\\Work')
    expect(source).toContain(DESKTOP_OPEN_WORKSPACE_GLOBAL)
    expect(source).toContain(DESKTOP_PENDING_WORKSPACE_GLOBAL)
  })

  it('calls the installed seam and reports the delivery', () => {
    const taken: string[] = []
    const page = { [DESKTOP_OPEN_WORKSPACE_GLOBAL]: (path: string) => { taken.push(path) } }
    expect(run('C:\\Work\\repo', page)).toBe('delivered')
    expect(taken).toEqual(['C:\\Work\\repo'])
    expect(page).not.toHaveProperty(DESKTOP_PENDING_WORKSPACE_GLOBAL)
  })

  it('parks the folder when the seam is not installed yet', () => {
    const page: Record<string, unknown> = {}
    expect(run('/home/anna/work', page)).toBe('pending')
    expect(page[DESKTOP_PENDING_WORKSPACE_GLOBAL]).toBe('/home/anna/work')
  })

  it('encodes every path through JSON so nothing can escape the string', () => {
    for (const path of [
      'C:\\Work\\repo',
      'C:\\a"quote\\repo',
      "/home/anna/it's here",
      '/home/anna/line\nbreak',
      '/home/anna/</script><script>x=1</script>',
      '/home/anna/back\\slash',
    ]) {
      const page: Record<string, unknown> = {}
      expect(run(path, page)).toBe('pending')
      expect(page[DESKTOP_PENDING_WORKSPACE_GLOBAL]).toBe(path)
    }
  })
})
