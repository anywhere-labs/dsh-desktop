/** The recovery assistant's quick-recovery card for a Host port that another program holds. */
import { Network } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../dsh-plugin-desktop/src/native-ui/components/ui/card.tsx'
import { RecoveryActionLink } from '../../../dsh-plugin-desktop/src/native-ui/shared/RecoveryWindowPrimitives.tsx'
import type { DesktopPortConflict } from '../port-conflict.ts'

/** Recovery action that lets the Host choose a free port at each start; main.ts writes the Desktop preferences. */
export const AUTOMATIC_PORT_ACTION = 'automatic-port'

/**
 * Explain which address another program holds and how to free it. The port is the one fixed in the desktop
 * settings, which can be switched to automatic from here outside Safe Mode, whose settings are fixed.
 */
export function PortConflictCard({ locale, conflict, safeMode, restart }: {
  readonly locale: 'zh' | 'en'
  readonly conflict: DesktopPortConflict
  readonly safeMode: boolean
  /** The label of the footer action that restarts the plugin service. */
  readonly restart: string
}): JSX.Element {
  const zh = locale === 'zh'
  const t = (cn: string, en: string): string => zh ? cn : en
  return <Card data-next-port-conflict="">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><Network className="size-5" />{t('插件服务（Host）端口被占用', 'Plugin service (Host) port in use')}</CardTitle>
      <CardDescription>{t(`插件服务无法监听 ${conflict.address}：这个端口已被另一个程序占用，常见的是另一个正在运行的 DSH。退出占用它的程序后，点击“${restart}”。`,
        `The plugin service could not listen on ${conflict.address} because another program holds it, often another running DSH. Quit that program, then choose “${restart}”.`)}</CardDescription>
    </CardHeader>
    {!safeMode && <CardContent className="text-sm"><p>{t(
      `端口 ${String(conflict.port)} 是在桌面设置里固定的。改为自动分配后，插件服务每次启动都会选一个空闲端口，浏览器访问的地址也会随之变化。`,
      `Port ${String(conflict.port)} is fixed in the desktop settings. With an automatic port, the plugin service picks a free one at each start, and the browser access address changes with it.`)}</p></CardContent>}
    {!safeMode && <CardFooter className="flex-wrap gap-2">
      <RecoveryActionLink href={`dsh-recovery://${AUTOMATIC_PORT_ACTION}`} variant="default">{t('改用自动端口', 'Use an automatic port')}</RecoveryActionLink>
    </CardFooter>}
  </Card>
}
