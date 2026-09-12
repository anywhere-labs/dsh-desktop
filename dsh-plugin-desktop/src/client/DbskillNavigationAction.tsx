import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ProjectLauncherAction } from './ProjectLauncherAction.tsx'
type Props = PropsRuntime<'sidebar.footer.action'>

export function DbskillNavigationAction(props: Props) {
  return <ProjectLauncherAction {...props} id="dbskill-workbench" label="商业诊断" icon="◈" path="/dbskill-workbench/" tone="#2f855a" />
}
