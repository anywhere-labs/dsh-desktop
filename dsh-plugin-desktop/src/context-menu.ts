/** Native right-click menu for editable content, mirroring the official Desktop. */

import type { BrowserWindow, ContextMenuParams, Menu, MenuItemConstructorOptions, WebContents } from 'electron'

/** Windows labels for the editing roles; macOS and Linux localize native roles themselves. */
export interface EditingContextMenuLabels {
  readonly undo: string
  readonly redo: string
  readonly cut: string
  readonly copy: string
  readonly paste: string
  readonly selectAll: string
}

const LABELS: Readonly<Record<'en' | 'zh', EditingContextMenuLabels>> = {
  en: { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All' },
  zh: { undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选' },
}

/** Resolve the Windows labels from a DSH locale (`zh`, `en`) or a language tag such as `zh-CN`. */
export function editingContextMenuLabels(language: string): EditingContextMenuLabels {
  return /^zh(?:[-_]|$)/iu.test(language) ? LABELS.zh : LABELS.en
}

/** The subset of Chromium's context-menu parameters that decides the editing menu. */
export type EditingContextMenuParams = Pick<ContextMenuParams, 'isEditable' | 'selectionText' | 'editFlags'>

/**
 * Build the official editing template. Editable targets get the full editing
 * set, selected read-only text gets Copy alone, and anything else gets no menu.
 * Availability comes from Chromium's edit flags. Empty accelerators suppress
 * Electron's default shortcut labels for native roles; Windows additionally
 * needs explicit labels because its native roles are not localized.
 */
export function editingContextMenuTemplate(
  params: EditingContextMenuParams,
  platform: NodeJS.Platform,
  labels: EditingContextMenuLabels,
): MenuItemConstructorOptions[] {
  const { isEditable, selectionText, editFlags } = params
  const items: MenuItemConstructorOptions[] = []
  if (isEditable) {
    items.push(
      { role: 'undo', enabled: editFlags.canUndo },
      { role: 'redo', enabled: editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy },
      { role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    )
  } else if (selectionText.length > 0) {
    items.push({ role: 'copy', enabled: editFlags.canCopy })
  }
  return items.map(item => ({
    ...item,
    ...(platform === 'win32' && item.role !== undefined && item.role in labels
      ? { label: labels[item.role as keyof EditingContextMenuLabels] }
      : {}),
    accelerator: '',
  }))
}

export interface EditingContextMenuOptions {
  readonly platform: NodeJS.Platform
  /** Windows labels in the Desktop language current when the menu opens. */
  readonly labels: () => EditingContextMenuLabels
  /**
   * The caller's Electron `Menu`, read only when a menu opens. This module
   * stays free of runtime Electron imports so every Desktop edition can share
   * it under its own Electron copy.
   */
  readonly menu: () => Pick<typeof Menu, 'buildFromTemplate'>
}

/** Pop the editing menu over `window` on every `context-menu` event; returns the listener remover. */
export function installEditingContextMenu(
  webContents: WebContents,
  window: BrowserWindow,
  options: EditingContextMenuOptions,
): () => void {
  const listener = (_event: Electron.Event, params: ContextMenuParams): void => {
    if (window.isDestroyed()) return
    const template = editingContextMenuTemplate(params, options.platform, options.labels())
    if (template.length === 0) return
    options.menu().buildFromTemplate(template).popup({ window })
  }
  webContents.on('context-menu', listener)
  return () => { webContents.off('context-menu', listener) }
}
