/** Plugin detail configuration; the existing Node /client API stays available through the node export condition. */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Panel } from './panel.js'
import { styles } from './official-styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'acp-bridge': 'title' | 'language' }
}
export const inject = ['slots', 'locale']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('acp-bridge', { zh: { title: 'ACP Bridge', language: 'zh' }, en: { title: 'ACP Bridge', language: 'en' } }), 'acp labels')
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = styles; document.head.append(style)
    return () => style.remove()
  }, 'acp panel styles')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config',
    key: '@agents-anywhere/dsh-acp-bridge', locale: 'acp-bridge' }, Section))
  function Section({ t }: PropsLocale<'acp-bridge'>) {
    return <Panel language={t('language')} />
  }
}
