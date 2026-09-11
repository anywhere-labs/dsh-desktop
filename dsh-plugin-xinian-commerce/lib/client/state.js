export const initialWorkspaceState = { activeModule: 'dashboard', taskFilter: 'all', drawer: 'none' };
export function navigate(state, activeModule) { return { ...state, activeModule }; }
export function setTaskFilter(state, taskFilter) { return { ...state, taskFilter }; }
export function openDrawer(state, drawer, selectedTaskId) { return { ...state, drawer, ...(selectedTaskId ? { selectedTaskId } : {}) }; }
export function closeDrawer(state) { return { ...state, drawer: 'none' }; }
