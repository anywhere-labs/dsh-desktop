import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ProjectLauncherAction } from './ProjectLauncherAction.tsx'
type Props = PropsRuntime<'sidebar.footer.action'>

export function ProductVisualNavigationAction(props: Props) {
  return <ProjectLauncherAction {...props} id="product-visual-workbench" label="商品视觉" icon="✦" path="/product-visual-workbench/" runtimePath="/api/product-visual/runtime" tone="#f59e0b" />
}
