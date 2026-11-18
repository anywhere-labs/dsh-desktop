/** The recovery assistant's quick-recovery card when only the main window failed and the Host kept running (#1690). */
import { MonitorX } from 'lucide-react'
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../dsh-plugin-desktop/src/native-ui/components/ui/card.tsx'
import { RecoveryActionLink } from '../../../dsh-plugin-desktop/src/native-ui/shared/RecoveryWindowPrimitives.tsx'

/** Recovery action that leaves recovery and opens the main window again over the running Host. */
export const REOPEN_MAIN_ACTION = 'reopen-main'

/**
 * Offer the way back that keeps running tasks: the main window reopens without restarting the Host, and
 * a conversation that kept crashing the window does not open on its own again.
 */
export function RendererRecoveryCard({ locale }: { readonly locale: 'zh' | 'en' }): JSX.Element {
  const t = (cn: string, en: string): string => locale === 'zh' ? cn : en
  return <Card data-next-renderer-recovery="">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><MonitorX className="size-5" />{t('插件服务（Host）仍在运行', 'Plugin service (Host) still running')}</CardTitle>
      <CardDescription>{t('崩溃的只是主窗口界面，插件服务没有停止，进行中的任务不受影响。重新打开主窗口时，反复导致崩溃的会话不会自动打开。',
        'Only the main window crashed. The plugin service kept running, so tasks in progress continue. When the main window reopens, a conversation that kept crashing it does not open on its own.')}</CardDescription>
    </CardHeader>
    <CardFooter className="justify-end">
      <RecoveryActionLink href={`dsh-recovery://${REOPEN_MAIN_ACTION}`} variant="default">{t('重新打开主窗口', 'Reopen the main window')}</RecoveryActionLink>
    </CardFooter>
  </Card>
}
