/** Windows 10-compatible acrylic backdrop through the native composition API. */

import { createRequire } from 'node:module'
import type { BrowserWindow } from 'electron'

const WCA_ACCENT_POLICY = 19
const ACCENT_DISABLED = 0
const ACCENT_ENABLE_ACRYLICBLURBEHIND = 4
const DARK_ACRYLIC_ABGR = 0xcc202020
const LIGHT_ACRYLIC_ABGR = 0xccf5f5f5

type SetWindowCompositionAttribute = (window: bigint, data: object) => number

interface AcrylicApi {
  readonly accentPolicy: import('koffi').TypeObject
  readonly setWindowCompositionAttribute: SetWindowCompositionAttribute
  readonly castPolicy: (value: object) => unknown
}

let cachedApi: AcrylicApi | undefined

function acrylicApi(): AcrylicApi {
  cachedApi ??= (() => {
    const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi').default
    const user32 = koffi.load('user32.dll')
    const accentPolicy = koffi.struct('DSH_ACCENT_POLICY', {
      AccentState: 'int32',
      AccentFlags: 'uint32',
      GradientColor: 'uint32',
      AnimationId: 'int32',
    })
    koffi.struct('DSH_WINDOWCOMPOSITIONATTRIBDATA', {
      Attrib: 'int32',
      pvData: 'void *',
      cbData: 'size_t',
    })
    const setWindowCompositionAttribute = user32.func(
      'int __stdcall SetWindowCompositionAttribute(void *, DSH_WINDOWCOMPOSITIONATTRIBDATA *)',
    ) as SetWindowCompositionAttribute
    return {
      accentPolicy,
      setWindowCompositionAttribute,
      castPolicy: value => koffi.as(value, koffi.pointer(accentPolicy)),
    }
  })()
  return cachedApi
}

function nativeHandle(window: Pick<BrowserWindow, 'getNativeWindowHandle'>): bigint {
  const value = window.getNativeWindowHandle()
  if (value.byteLength >= 8) return value.readBigUInt64LE(0)
  if (value.byteLength >= 4) return BigInt(value.readUInt32LE(0))
  throw new Error('dsh-plugin-desktop: BrowserWindow returned an invalid native handle')
}

/** Apply or clear the Windows acrylic accent; returns false when DWM rejects it. */
export function setWindowsAcrylic(
  window: Pick<BrowserWindow, 'getNativeWindowHandle'>,
  enabled: boolean,
  dark: boolean,
): boolean {
  if (process.platform !== 'win32') return false
  const api = acrylicApi()
  const policy = {
    AccentState: enabled ? ACCENT_ENABLE_ACRYLICBLURBEHIND : ACCENT_DISABLED,
    AccentFlags: 0,
    GradientColor: dark ? DARK_ACRYLIC_ABGR : LIGHT_ACRYLIC_ABGR,
    AnimationId: 0,
  }
  return api.setWindowCompositionAttribute(nativeHandle(window), {
    Attrib: WCA_ACCENT_POLICY,
    pvData: api.castPolicy(policy),
    cbData: api.accentPolicy.size,
  }) !== 0
}
