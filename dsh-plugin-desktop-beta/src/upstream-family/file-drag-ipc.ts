/** IPC channels of the native file drag, shared by the main process and the sandboxed preload bundle. */
export const FILE_DRAG_IPC = {
  prepare: 'dsh-desktop:file-drag-prepare',
  cancel: 'dsh-desktop:file-drag-cancel',
  start: 'dsh-desktop:file-drag-start',
  release: 'dsh-desktop:file-drag-release',
} as const
