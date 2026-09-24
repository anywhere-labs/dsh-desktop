/** Native microphone access alongside the official voice bundle's enable switch. */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { DesktopPermissionsButton } from './permissions.tsx'

const VOICE_BUNDLE = '@deepseek-ai/dsh-experimental-voice-input-bundle'

export function registerVoicePermissions(ctx: Context): void {
  ctx.slots.inject('plugins.bundle.actions', () => ctx.slots.register({
    name: 'plugins.bundle.actions', key: VOICE_BUNDLE, locale: 'desktop-next',
  }, VoicePermissionsAction))
  ctx.slots.inject('plugins.detail.actions', () => ctx.slots.register({
    name: 'plugins.detail.actions', id: 'desktop-next-voice-permissions', locale: 'desktop-next',
  }, VoicePermissionsAction))
}

export function VoicePermissionsAction({ t, subject }: PropsLocale<'desktop-next'> & PropsRuntime<'plugins.detail.actions'>) {
  if (subject.kind !== 'bundle' || subject.pkg.name !== VOICE_BUNDLE || !window.desktopNext?.permissions) return null
  const zh = t('language') === 'zh'
  return <DesktopPermissionsButton service={window.desktopNext.permissions} language={zh ? 'zh' : 'en'}
    permission="microphone" label={zh ? '权限设置' : 'Permission settings'} />
}
