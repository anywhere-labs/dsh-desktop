/** Channel for the native save-file dialog the renderer may open via the preload bridge. */

/** Preload-to-main channel carrying one save-file picker request. */
export const DESKTOP_SAVE_FILE_PICKER_CHANNEL = 'dsh-desktop:save-file-picker'

/** Parameters accepted by the native save dialog (Electron SaveDialogOptions subset). */
export interface DesktopSaveFilePickerRequest {
  readonly title?: string
  readonly defaultPath?: string
  readonly filters?: ReadonlyArray<{ readonly name: string; readonly extensions: readonly string[] }>
}
