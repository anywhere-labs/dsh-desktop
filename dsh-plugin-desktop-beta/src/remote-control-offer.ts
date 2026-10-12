/** Native-owned remote-control discovery state and confirmation flow. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DesktopLocale } from './runtime.ts'

export const remoteControlOfferCopy = {
  zh: {
    label: '远程控制', title: '启用远程控制？',
    message: '从其他设备使用这台电脑上的 DeepSeek Harness。',
    detail: '启用并重启后，请从“手机连接”完成连接配置。配置完成后，你可以通过其他联网设备远程使用这台电脑上的 DeepSeek Harness。远程使用时，这台电脑需要保持开机并联网。',
    confirm: '启用并重启', cancel: '暂不开启',
    failed: '未能启用远程控制', retry: '请稍后重试，或前往“桌面设置”开启手机连接。',
  },
  en: {
    label: 'Remote control', title: 'Enable remote control?',
    message: 'Use DeepSeek Harness on this computer from another device.',
    detail: 'After enabling and restarting, open Phone connection to finish setup. You can then use DeepSeek Harness on this computer from other internet-connected devices. This computer must remain on and connected to the internet.',
    confirm: 'Enable and restart', cancel: 'Not now',
    failed: 'Could not enable remote control', retry: 'Try again later, or enable Phone connection in Desktop settings.',
  },
} as const

export interface RemoteControlOfferState { readonly enabled: boolean; readonly seen: boolean }

export class RemoteControlOffer {
  private seen = false
  private pending: Promise<void> | undefined
  constructor(private readonly options: {
    path: string
    readEnabled(): Promise<boolean>
    enable(): Promise<void>
    confirm(copy: typeof remoteControlOfferCopy[DesktopLocale]): Promise<boolean>
    reportError(cause: unknown): void
  }) {}

  async read(): Promise<RemoteControlOfferState> {
    try { this.seen ||= await readFile(this.options.path, 'utf8') === 'seen\n' }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') this.options.reportError(cause) }
    return { enabled: await this.options.readEnabled(), seen: this.seen }
  }

  open(locale: DesktopLocale): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.perform(locale).finally(() => { this.pending = undefined })
    return this.pending
  }

  private async perform(locale: DesktopLocale): Promise<void> {
    this.seen = true
    try {
      await mkdir(dirname(this.options.path), { recursive: true })
      await writeFile(this.options.path, 'seen\n', { mode: 0o600 })
    } catch (cause) { this.options.reportError(cause) }
    if (await this.options.readEnabled()) return
    if (await this.options.confirm(remoteControlOfferCopy[locale])) await this.options.enable()
  }
}
