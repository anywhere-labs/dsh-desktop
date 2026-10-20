/** Native-owned announcement for the Stable edition's transition to Next. */
import { open } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { DesktopLocale } from './runtime.ts'
import type { DesktopReleaseChannel } from './update-checker.ts'

export const nextTransitionNoticeCopy = {
  zh: {
    title: 'DSH Desktop 版本更新说明',
    message: 'Next 将成为新的稳定版桌面端',
    detail: '下个版本发布后，我们计划用 Next 版取代当前稳定版桌面端。届时，你可以通过“检查更新”获取新版本。感谢你的支持！',
    checkboxLabel: '确认后不再弹出', confirm: '确认',
  },
  en: {
    title: 'DSH Desktop release update',
    message: 'Next will become the new stable desktop app',
    detail: 'After the next release, we plan to replace the current stable desktop app with Next. You will be able to get the new version through Check for Updates. Thank you for your support!',
    checkboxLabel: 'Do not show again after confirming', confirm: 'OK',
  },
} as const

export class NextTransitionNotice {
  private attempted = false
  private pending: Promise<void> | undefined
  constructor(private readonly options: {
    path: string
    show(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
    reportError(cause: unknown): void
  }) {}

  open(locale: DesktopLocale, channel: DesktopReleaseChannel, active: () => boolean): Promise<void> {
    if (channel !== 'stable') return Promise.resolve()
    if (this.pending) return this.pending
    if (this.attempted) return Promise.resolve()
    this.attempted = true
    this.pending = this.perform(locale, active).catch(this.options.reportError)
    return this.pending
  }

  private async perform(locale: DesktopLocale, active: () => boolean): Promise<void> {
    try {
      const file = await open(this.options.path, 'r')
      try {
        const buffer = Buffer.alloc(128)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (buffer.subarray(0, bytesRead).toString('utf8') === 'next-transition-v1:dismissed\n') return
      } finally { await file.close() }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') this.options.reportError(cause)
    }
    if (!active()) return
    const copy = nextTransitionNoticeCopy[locale]
    const result = await this.options.show({
      type: 'info', title: copy.title, message: copy.message, detail: copy.detail,
      checkboxLabel: copy.checkboxLabel, checkboxChecked: false,
      buttons: [copy.confirm], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (result.response === 0 && result.checkboxChecked) {
      await writeFileAtomic(this.options.path, 'next-transition-v1:dismissed\n', { mode: 0o600, dirMode: 0o700 })
    }
  }
}
