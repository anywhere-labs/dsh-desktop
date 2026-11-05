import { describe, expect, it } from 'vitest'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import {
  desktopFilePathPromptSection,
  renderDesktopFilePathGuidance,
} from '../src/desktop-file-path-guidance.ts'

function renderSection(
  section: ReturnType<typeof desktopFilePathPromptSection>,
  cwd?: string,
): string {
  const text = section.text
  if (typeof text !== 'function') throw new Error('Desktop path guidance must be dynamic')
  const context = cwd === undefined ? {} : {
    agent: { session: { header: { cwd } } },
  } as unknown as AssembleContext
  return text(context)
}

describe('Desktop file path output guidance', () => {
  it('instructs absolute output and separate grouping of worktrees and attached roots', () => {
    const text = renderDesktopFilePathGuidance('/work/main', ['/work/z', '/work/a'])
    expect(text).toContain('verified absolute filesystem path')
    expect(text).toContain('group them under their actual directory roots')
    expect(text).toContain('independent Git worktree')
    expect(text).toContain('Files browser selection does not change the Session working directory')
    expect(text).toContain('Session working directory: "/work/main"')
    expect(text).toContain('Attached source directory roots: ["/work/a","/work/z"]')
    expect(text).toContain('not additional filesystem permissions')
  })

  it('reads the current Session and attached roots on every assembly without using selected browser roots', () => {
    const byWorkspace = new Map([
      ['/work/first', ['/work/attached']],
      ['/work/second', ['/work/other']],
    ])
    const section = desktopFilePathPromptSection(10001, {
      attachedRoots: cwd => byWorkspace.get(cwd) ?? [],
    })
    expect(section.name).toBe('desktop:file-path-output')
    expect(section.interpolate).toBe(false)
    expect(renderSection(section, '/work/first')).toContain('"/work/attached"')
    byWorkspace.set('/work/first', ['/work/new-root'])
    const updated = renderSection(section, '/work/first')
    expect(updated).toContain('"/work/new-root"')
    expect(updated).not.toContain('"/work/attached"')
    const other = renderSection(section, '/work/second')
    expect(other).toContain('"/work/other"')
    expect(other).not.toContain('"/work/new-root"')
  })

  it('does not invent roots for diagnostics, relative cwd or inaccessible directories', () => {
    const section = desktopFilePathPromptSection(10001, {
      attachedRoots: () => { throw new Error('workspace missing') },
    })
    expect(renderSection(section)).not.toContain('Session working directory:')
    expect(renderSection(section, 'relative/workspace')).not.toContain('Session working directory:')
    const missing = renderSection(section, '/work/removed')
    expect(missing).toContain('Session working directory: "/work/removed"')
    expect(missing).toContain('Attached source directory roots are unavailable')
  })
})
