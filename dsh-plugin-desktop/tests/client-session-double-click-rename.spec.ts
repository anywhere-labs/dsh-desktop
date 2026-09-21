import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL(
  '../../patches/dsh-client-ui-workspace@0.1.5-rc.2.patch',
  import.meta.url,
), 'utf8')

const installedClient = readFileSync(new URL(
  '../node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
  import.meta.url,
), 'utf8')

describe('RC2 workspace client double-click rename patch', () => {
  it('routes a session-row double-click into the existing rename callback', () => {
    for (const marker of [
      'onDoubleClick: () => {',
      'if (row.blank) return;',
      'onRename(node.id, row.title);',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('keeps the rename entry point identical to the ellipsis-menu row', () => {
    expect(patch).toContain('onOpen(node.id);')
    expect(installedClient).toContain('if (id === "rename") onRename(node.id, row.title);')
  })

  it('leaves single-click open, right-click menu, and drag behavior untouched', () => {
    expect(patch).not.toContain('onContextMenu')
    expect(patch).not.toContain('closeOnPointerLeave')
  })
})
