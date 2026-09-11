import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { initialWorkspaceState, navigate, openDrawer } from './state.js';
import { Sidebar } from './components/Sidebar.js';
import { TopBar } from './components/TopBar.js';
import { TaskDrawer } from './components/TaskDrawer.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ProductLibraryPage } from './pages/ProductLibraryPage.js';
import { ContentStudioPage } from './pages/ContentStudioPage.js';
import { PublishWorkspacePage } from './pages/PublishWorkspacePage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { AgentRunPage } from './pages/AgentRunPage.js';
const titles = { dashboard: '运营工作台', products: '商品档案', content: '内容生产', publish: '上架任务', analytics: '店铺数据', agent: 'Agent 运行中心' };
export function App() { const [state, setState] = useState(initialWorkspaceState); const [dashboard, setDashboard] = useState(); useEffect(() => { api.dashboard().then(setDashboard).catch(() => undefined); }, []); const go = (id) => setState(current => navigate(current, id)); const content = state.activeModule === 'dashboard' ? _jsx(DashboardPage, { data: dashboard, onNavigate: go }) : state.activeModule === 'products' ? _jsx(ProductLibraryPage, { onCreated: () => undefined }) : state.activeModule === 'content' ? _jsx(ContentStudioPage, { onTask: id => setState(current => openDrawer(current, 'task', id)) }) : state.activeModule === 'publish' ? _jsx(PublishWorkspacePage, {}) : state.activeModule === 'analytics' ? _jsx(AnalyticsPage, {}) : _jsx(AgentRunPage, {}); return _jsxs("div", { className: "xn-app", children: [_jsx(Sidebar, { active: state.activeModule, onNavigate: go }), _jsxs("main", { className: "xn-main", children: [_jsx(TopBar, { title: titles[state.activeModule], onCreate: () => go('content') }), _jsx("div", { className: "xn-content", children: content })] }), _jsx(TaskDrawer, { open: state.drawer === 'task', taskId: state.selectedTaskId, onClose: () => setState(current => ({ ...current, drawer: 'none' })) }), _jsx("nav", { className: "xn-mobile-nav", children: ['dashboard', 'products', 'content', 'agent'].map(id => _jsx("button", { className: state.activeModule === id ? 'is-active' : '', onClick: () => go(id), children: titles[id] }, id)) })] }); }
