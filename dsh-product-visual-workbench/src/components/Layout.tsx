import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>短视频增长 Agent OS</h1>
          <p>真人出镜 IP 日更工作台：选题 → 脚本 → 剪辑 → 复盘 → 归因</p>
        </div>
        <div className="topbar-status">
          <span>Launcher</span>
          <strong>127.0.0.1:3018 /api</strong>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
