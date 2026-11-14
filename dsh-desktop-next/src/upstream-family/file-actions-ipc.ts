/** IPC channels of the file actions, shared by the main process and the sandboxed preload bundle. */
export const FILE_ACTIONS_IPC = {
  save: 'dsh-desktop:file-save',
  clipboardImageRead: 'dsh-desktop:clipboard-image-read',
} as const
