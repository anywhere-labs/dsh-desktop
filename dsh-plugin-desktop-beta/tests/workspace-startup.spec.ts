import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const applicationDirectory = fileURLToPath(new URL('..', import.meta.url))
import { DesktopWorkspaceLaunches, desktopWorkspaceLaunchPaths } from '../src/workspace-startup.ts'

describe('runtime-owned workspace launch queue', () => {
  it('keeps cold-start and onboarding requests until the selected Profile has a document', () => {
    const queue = new DesktopWorkspaceLaunches()
    queue.enqueue('work', ['/frontend', '/backend'])
    expect(queue.take('personal', 'personal-document')).toBeNull()
    expect(queue.take('work', 'work-document')).toEqual({ id: 1, paths: ['/frontend', '/backend'] })
  })

  it('delivers once per document and replays across reload until acknowledged', () => {
    const queue = new DesktopWorkspaceLaunches()
    queue.enqueue('work', ['/one', '/two'])
    expect(queue.take('work', 'old')).toEqual({ id: 1, paths: ['/one', '/two'] })
    expect(queue.take('work', 'old')).toBeNull()
    expect(queue.take('work', 'new')).toEqual({ id: 1, paths: ['/one', '/two'] })
    expect(queue.complete('work', 'old', 1)).toBe(false)
    expect(queue.complete('personal', 'new', 1)).toBe(false)
    expect(queue.complete('work', 'new', 1)).toBe(true)
    expect(queue.take('work', 'newer')).toBeNull()
  })

  it('keeps later launches ordered and snapshots their roots', () => {
    const queue = new DesktopWorkspaceLaunches()
    const roots = ['/first']
    queue.enqueue('work', roots)
    roots.push('/not-selected')
    queue.enqueue('work', ['/second', '/third'])
    expect(queue.take('work', 'document')).toEqual({ id: 1, paths: ['/first'] })
    expect(queue.complete('work', 'document', 1)).toBe(true)
    expect(queue.take('work', 'document')).toEqual({ id: 2, paths: ['/second', '/third'] })
  })
})


it('does not mistake Electron app entries or background Node arguments for a workspace', () => {
  expect(desktopWorkspaceLaunchPaths(['/bin/electron', applicationDirectory], 'linux')).toBeUndefined()
  expect(desktopWorkspaceLaunchPaths(['/bin/electron', '/repo/node/worker.js', '/tmp/output'], 'linux')).toBeUndefined()
  expect(desktopWorkspaceLaunchPaths(['C:\\DSH\\Desktop.exe', 'C:\\repo\\worker.js', 'C:\\output'], 'win32')).toBeUndefined()
})

it('accepts explicit roots from cold and second-instance Electron command lines only', () => {
  const flags = ['--dsh-desktop-workspace=/frontend', '--dsh-desktop-workspace=/backend']
  expect(desktopWorkspaceLaunchPaths(['/bin/electron', applicationDirectory, ...flags], 'linux')).toEqual(['/frontend', '/backend'])
  expect(desktopWorkspaceLaunchPaths(['/bin/electron', ...flags, applicationDirectory], 'linux')).toEqual(['/frontend', '/backend'])
})
