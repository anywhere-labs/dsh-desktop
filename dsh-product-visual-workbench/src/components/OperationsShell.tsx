import { useState, type ReactNode } from "react";
import { dshHomeUrl } from "../navigation";
import { ProviderConfigModal } from "./ProviderConfigModal";

type Props = {
  activeView: string;
  children: ReactNode;
  modelReady?: boolean;
  onNavigate: (view: string) => void;
  onRefresh?: () => void;
  onConfigSaved?: () => void;
};

const navigation = [
  ["overview", "总览", "⌂"],
  ["brand", "品牌全案", "✦"],
  ["pipeline", "内容生产", "◇"],
  ["material", "素材中心", "▣"],
  ["liveclip", "直播切片", "✂"],
  ["agents", "Agent 管理", "◎"],
  ["workflows", "工作流与 Prompt", "⌘"],
  ["models", "模型路由", "◈"],
  ["audit", "日志审计", "▤"],
];

function activeRoot(view: string) {
  if (["import", "diagnosis", "benchmark", "topic", "script", "edit", "review", "attribution", "hotspot"].includes(view)) return "pipeline";
  if (view === "material-assets") return "material";
  if (view === "settings") return "models";
  return view;
}

export function OperationsShell({ activeView, children, modelReady = false, onNavigate, onRefresh, onConfigSaved }: Props) {
  const selected = activeRoot(activeView);
  const [configOpen, setConfigOpen] = useState(false);
  return (
    <div className="ops-shell">
      <aside className="ops-sidebar" aria-label="主导航">
        <button className="ops-brand" onClick={() => onNavigate("overview")} type="button">
          <span className="ops-brand-mark"><i /><i /><i /></span>
          <span><strong>LiveClip OS</strong><small>智能内容工作台</small></span>
        </button>
        <nav className="ops-nav">
          <p>运营中心</p>
          {navigation.map(([key, label, icon]) => (
            <button className={selected === key ? "active" : ""} key={key} onClick={() => onNavigate(key)} type="button">
              <span className="ops-nav-icon">{icon}</span><span>{label}</span>
              {key === "liveclip" ? <em>核心</em> : null}
            </button>
          ))}
        </nav>
        <div className="ops-sidebar-foot">
          <div className="ops-runtime"><span className={modelReady ? "ready" : ""} /><div><strong>{modelReady ? "模型路由就绪" : "模型路由待检查"}</strong><small>FastAPI · 本地工作区</small></div></div>
          <div className="ops-user"><span>创</span><div><strong>创作团队</strong><small>本地管理员</small></div><b>⌄</b></div>
        </div>
      </aside>
      <section className="ops-stage">
        <header className="ops-topbar">
          <label className="ops-global-search"><span>⌕</span><input aria-label="搜索工作台" placeholder="搜索任务、素材、Agent 或日志" /></label>
          <div className="ops-top-actions">
            <button className="ops-home-button" onClick={() => window.location.assign(dshHomeUrl(window.location.href))} type="button">返回 DSH 首页</button>
            <button className="ops-config-button" onClick={() => setConfigOpen(true)} type="button"><span>⚙</span>配置</button>
            <span className="ops-date">今日 · 实时数据</span>
            <button aria-label="刷新当前页面" className="ops-icon-button" onClick={onRefresh} type="button">↻</button>
            <span className={modelReady ? "ops-health ready" : "ops-health"}><i />{modelReady ? "服务就绪" : "需配置"}</span>
            <button className="ops-notification" aria-label="通知" type="button">♢<b /></button>
          </div>
        </header>
        <main className="ops-content">{children}</main>
      </section>
      {configOpen ? <ProviderConfigModal onClose={() => setConfigOpen(false)} onSaved={onConfigSaved} /> : null}
    </div>
  );
}
