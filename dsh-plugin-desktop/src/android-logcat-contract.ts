/** Shared HTTP contract for the Desktop Android Logcat feature. */

export const ANDROID_LOGCAT_DEVICES_PATH = '/api/desktop/android-logcat/devices'
export const ANDROID_LOGCAT_PROCESSES_PATH = '/api/desktop/android-logcat/processes'
export const ANDROID_LOGCAT_STREAM_PATH = '/api/desktop/android-logcat/stream'
export const ANDROID_LOGCAT_SCREENSHOT_PATH = '/api/desktop/android-logcat/screenshot'

export interface AndroidLogcatDevice {
  readonly serial: string
  readonly state: string
  readonly model?: string
}

export interface AndroidLogcatDevicesResponse {
  readonly available: boolean
  readonly error?: string
  readonly devices: readonly AndroidLogcatDevice[]
}

export interface AndroidLogcatProcess {
  readonly pid: number
  readonly name: string
}

export interface AndroidLogcatProcessesResponse {
  readonly processes: readonly AndroidLogcatProcess[]
}

export interface AndroidLogcatErrorResponse {
  readonly error: string
  readonly code: string
}
