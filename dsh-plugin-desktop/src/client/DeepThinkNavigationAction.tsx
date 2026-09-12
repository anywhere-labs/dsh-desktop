import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ProjectLauncherAction } from './ProjectLauncherAction.tsx'
type Props = PropsRuntime<'sidebar.footer.action'>

export function DeepThinkNavigationAction(props: Props) {
  return <ProjectLauncherAction {...props} id="deepthink-workbench" label="DeepThink" icon="⌁" path="/deepthink/" runtimePath="/deepthink/runtime" tone="#38bdf8" />
}
