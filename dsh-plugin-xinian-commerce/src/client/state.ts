export type ModuleId = 'dashboard' | 'products' | 'content' | 'publish' | 'analytics' | 'agent'
export type TaskFilter = 'all' | 'running' | 'waiting' | 'delivered' | 'failed'
export type WorkspaceState = { activeModule: ModuleId; selectedProductId?: string; selectedTaskId?: string; taskFilter: TaskFilter; drawer: 'none' | 'task' | 'approval' }
export const initialWorkspaceState: WorkspaceState = { activeModule: 'dashboard', taskFilter: 'all', drawer: 'none' }
export function navigate(state: WorkspaceState, activeModule: ModuleId): WorkspaceState { return { ...state, activeModule } }
export function setTaskFilter(state: WorkspaceState, taskFilter: TaskFilter): WorkspaceState { return { ...state, taskFilter } }
export function openDrawer(state: WorkspaceState, drawer: Exclude<WorkspaceState['drawer'], 'none'>, selectedTaskId?: string): WorkspaceState { return { ...state, drawer, ...(selectedTaskId ? { selectedTaskId } : {}) } }
export function closeDrawer(state: WorkspaceState): WorkspaceState { return { ...state, drawer: 'none' } }
