import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  editingContextMenuLabels,
  editingContextMenuTemplate,
  installEditingContextMenu,
} from '../src/context-menu.ts'

const editFlags = {
  canUndo: true,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: false,
}

describe('editing context menu', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('resolves Windows labels from a Desktop locale or a language tag', () => {
    expect(editingContextMenuLabels('zh')).toEqual({
      undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    })
    expect(editingContextMenuLabels('zh-CN')).toBe(editingContextMenuLabels('zh'))
    expect(editingContextMenuLabels('zh_Hans_CN')).toBe(editingContextMenuLabels('zh'))
    expect(editingContextMenuLabels('en')).toEqual({
      undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    })
    expect(editingContextMenuLabels('en-US')).toBe(editingContextMenuLabels('en'))
    expect(editingContextMenuLabels('zhx')).toBe(editingContextMenuLabels('en'))
    expect(editingContextMenuLabels('fr-FR')).toBe(editingContextMenuLabels('en'))
  })

  it('builds the official editable template with native roles and no shortcut labels', () => {
    const params = { isEditable: true, selectionText: '', editFlags }

    expect(editingContextMenuTemplate(params, 'darwin', editingContextMenuLabels('zh'))).toEqual([
      { role: 'undo', enabled: true, accelerator: '' },
      { role: 'redo', enabled: false, accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'cut', enabled: true, accelerator: '' },
      { role: 'copy', enabled: true, accelerator: '' },
      { role: 'paste', enabled: true, accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'selectAll', enabled: true, accelerator: '' },
    ])
    expect(editingContextMenuTemplate(params, 'linux', editingContextMenuLabels('zh')))
      .toEqual(editingContextMenuTemplate(params, 'darwin', editingContextMenuLabels('zh')))
    expect(editingContextMenuTemplate(params, 'win32', editingContextMenuLabels('zh'))).toEqual([
      { role: 'undo', enabled: true, label: '撤销', accelerator: '' },
      { role: 'redo', enabled: false, label: '重做', accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'cut', enabled: true, label: '剪切', accelerator: '' },
      { role: 'copy', enabled: true, label: '复制', accelerator: '' },
      { role: 'paste', enabled: true, label: '粘贴', accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'selectAll', enabled: true, label: '全选', accelerator: '' },
    ])
  })

  it('offers Copy alone for selected read-only text and nothing otherwise', () => {
    expect(editingContextMenuTemplate(
      { isEditable: false, selectionText: 'DSH', editFlags },
      'win32',
      editingContextMenuLabels('en'),
    )).toEqual([{ role: 'copy', enabled: true, label: 'Copy', accelerator: '' }])
    expect(editingContextMenuTemplate(
      { isEditable: false, selectionText: 'DSH', editFlags: { ...editFlags, canCopy: false } },
      'darwin',
      editingContextMenuLabels('en'),
    )).toEqual([{ role: 'copy', enabled: false, accelerator: '' }])
    expect(editingContextMenuTemplate(
      { isEditable: false, selectionText: '', editFlags },
      'win32',
      editingContextMenuLabels('en'),
    )).toEqual([])
  })

  it('pops the built menu over the owning window until the listener is removed', () => {
    type Listener = (...args: unknown[]) => void
    const listeners = new Map<string, Listener>()
    const webContents = {
      on: vi.fn((event: string, listener: Listener) => { listeners.set(event, listener) }),
      off: vi.fn((event: string, listener: Listener) => {
        if (listeners.get(event) === listener) listeners.delete(event)
      }),
    }
    const window = { isDestroyed: vi.fn(() => false) }
    const popup = vi.fn()
    const menu = { buildFromTemplate: vi.fn((template: unknown[]) => ({ template, popup })) }
    const labels = vi.fn(() => editingContextMenuLabels('zh'))
    const remove = installEditingContextMenu(
      webContents as unknown as Electron.WebContents,
      window as unknown as Electron.BrowserWindow,
      { platform: 'win32', labels, menu: () => menu as unknown as Pick<typeof Electron.Menu, 'buildFromTemplate'> },
    )
    const listener = listeners.get('context-menu')
    expect(listener).toEqual(expect.any(Function))

    listener?.({}, { isEditable: false, selectionText: 'DSH', editFlags })
    expect(labels).toHaveBeenCalledOnce()
    expect(menu.buildFromTemplate).toHaveBeenCalledWith([
      { role: 'copy', enabled: true, label: '复制', accelerator: '' },
    ])
    expect(popup).toHaveBeenCalledWith({ window })

    listener?.({}, { isEditable: false, selectionText: '', editFlags })
    expect(menu.buildFromTemplate).toHaveBeenCalledOnce()

    window.isDestroyed.mockReturnValue(true)
    listener?.({}, { isEditable: true, selectionText: '', editFlags })
    expect(menu.buildFromTemplate).toHaveBeenCalledOnce()
    expect(popup).toHaveBeenCalledOnce()

    remove()
    expect(webContents.off).toHaveBeenCalledWith('context-menu', listener)
    expect(listeners.has('context-menu')).toBe(false)
  })
})
