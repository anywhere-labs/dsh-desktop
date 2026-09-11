export type ModuleId = 'dashboard' | 'products' | 'content' | 'publish' | 'analytics' | 'agent';
export type TaskFilter = 'all' | 'running' | 'waiting' | 'delivered' | 'failed';
export type WorkspaceState = {
    activeModule: ModuleId;
    selectedProductId?: string;
    selectedTaskId?: string;
    taskFilter: TaskFilter;
    drawer: 'none' | 'task' | 'approval';
};
export declare const initialWorkspaceState: WorkspaceState;
export declare function navigate(state: WorkspaceState, activeModule: ModuleId): WorkspaceState;
export declare function setTaskFilter(state: WorkspaceState, taskFilter: TaskFilter): WorkspaceState;
export declare function openDrawer(state: WorkspaceState, drawer: Exclude<WorkspaceState['drawer'], 'none'>, selectedTaskId?: string): WorkspaceState;
export declare function closeDrawer(state: WorkspaceState): WorkspaceState;
