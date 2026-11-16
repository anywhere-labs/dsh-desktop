/** The recovery assistant's quick-recovery card for the original environment's Host startup limit (#1569). */
import { Timer } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../dsh-plugin-desktop/src/native-ui/components/ui/card.tsx'
import { RecoveryActionLink } from '../../../dsh-plugin-desktop/src/native-ui/shared/RecoveryWindowPrimitives.tsx'
import { DEFAULT_HOST_STARTUP_TIMEOUT, HOST_STARTUP_TIMEOUT_PRESETS, hostStartupLimitTitle, hostStartupTimeoutLabel,
  type DesktopStartupTimeoutFailure, type HostStartupTimeout } from '../host-startup-limit.ts'

/** Recovery action that saves a limit; main.ts writes only the extra preference file. */
export const STARTUP_LIMIT_ACTION = 'host-startup-timeout'

/**
 * @param value - The limit to save.
 * @returns The recovery link that saves it.
 */
export function startupLimitHref(value: HostStartupTimeout): string {
  return `dsh-recovery://${STARTUP_LIMIT_ACTION}?id=${String(value)}`
}

/**
 * The saved limit and the presets that replace it. A start that ran out of time adds what it was still
 * loading; in Safe Mode the card says that it changes the original environment.
 */
export function StartupLimitCard({ locale, value, safeMode, timeout, restart, pluginsTab }: {
  readonly locale: 'zh' | 'en'
  readonly value: HostStartupTimeout | undefined
  readonly safeMode: boolean
  /** The timeout that opened recovery, outside Safe Mode. */
  readonly timeout?: DesktopStartupTimeoutFailure | undefined
  /** The label of the footer action that applies the change. */
  readonly restart: string
  readonly pluginsTab: string
}): JSX.Element {
  const zh = locale === 'zh'
  const t = (cn: string, en: string): string => zh ? cn : en
  const current = value ?? DEFAULT_HOST_STARTUP_TIMEOUT
  const loading = timeout?.pending?.map(entry => entry.id) ?? []
  const named = loading.slice(0, 3).join(zh ? '、' : ', ')
  return <Card data-next-startup-limit="">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Timer className="size-5" />{hostStartupLimitTitle(zh)}</CardTitle>
      <CardDescription>{t('插件服务需在此时间内就绪，否则打开恢复助手。插件较多或电脑较慢时可以延长。更改在下次启动插件服务时生效。',
        'The plugin service must be ready within this time, or the recovery assistant opens. Allow longer when many plugins are installed or the computer is slow. Changes apply the next time the plugin service starts.')}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-2 text-sm">
      {timeout && <p className="text-amber-600 dark:text-amber-400" data-next-startup-timeout="">{t(
        `这次启动在 ${String(timeout.seconds)} 秒内没有就绪${loading.length === 0 ? '' : `，仍在加载 ${named}${loading.length > 3 ? ` 等 ${String(loading.length)} 个插件` : ''}`}。可以延长时限后点击“${restart}”，也可以在“${pluginsTab}”页停用拖慢启动的插件。`,
        `This start was not ready within ${String(timeout.seconds)} seconds${loading.length === 0 ? '' : `; still loading ${named}${loading.length > 3 ? ` and ${String(loading.length - 3)} more` : ''}`}. Allow longer, then choose “${restart}”, or disable the plugins that slow startup on the ${pluginsTab} tab.`)}</p>}
      <p>{t('当前：', 'Current: ')}<span className="font-medium">{hostStartupTimeoutLabel(current, zh)}</span></p>
      {safeMode && <p className="text-xs text-muted-foreground">{t('安全模式固定使用 60 秒；这里修改的是原环境的时限。', 'Safe Mode always allows 60 seconds; this changes the limit of the original environment.')}</p>}
    </CardContent>
    <CardFooter className="flex-wrap gap-2">
      {HOST_STARTUP_TIMEOUT_PRESETS.map(preset => <RecoveryActionLink key={String(preset)} href={startupLimitHref(preset)} variant={preset === current ? 'default' : 'outline'}>{hostStartupTimeoutLabel(preset, zh)}</RecoveryActionLink>)}
    </CardFooter>
  </Card>
}
