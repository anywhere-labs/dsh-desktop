import type { Dashboard } from '../api.js';
export declare function DashboardPage({ data, onNavigate }: {
    data?: Dashboard;
    onNavigate: (id: 'products' | 'content' | 'agent') => void;
}): import("react").JSX.Element;
