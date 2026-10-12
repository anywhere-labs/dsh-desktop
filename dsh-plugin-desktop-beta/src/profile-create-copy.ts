/** Shared copy for the isolated Profile creator and its native owner. */

import type { DesktopLocale } from './runtime.ts'

export interface DesktopProfileCreateCopy {
  readonly title: string
  readonly heading: string
  readonly description: string
  readonly label: string
  readonly placeholder: string
  readonly submit: string
  readonly cancel: string
  readonly empty: string
  readonly failed: string
}

const COPY: Record<DesktopLocale, DesktopProfileCreateCopy> = {
  en: {
    title: 'New Profile',
    heading: 'Create a Profile',
    description: 'Create a Desktop-compatible Profile and select it for the next start.',
    label: 'Profile name',
    placeholder: 'For example: work',
    submit: 'Create Profile',
    cancel: 'Cancel',
    empty: 'Enter a Profile name.',
    failed: 'The Profile could not be created. Check the name and try again.',
  },
  zh: {
    title: '新建 Profile',
    heading: '新建 Profile',
    description: '创建一个支持桌面端的 Profile，并设为下次启动时使用的 Profile。',
    label: 'Profile 名称',
    placeholder: '例如：work',
    submit: '创建 Profile',
    cancel: '取消',
    empty: '请输入 Profile 名称。',
    failed: '无法创建 Profile，请检查名称后重试。',
  },
}

export function desktopProfileCreateCopy(locale: DesktopLocale): DesktopProfileCreateCopy {
  return COPY[locale]
}
