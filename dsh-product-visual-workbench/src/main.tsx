import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { OperationsShell } from "./components/OperationsShell";
import { ImportPage } from "./pages/ImportPage";
import { AccountDiagnosisPage } from "./pages/AccountDiagnosisPage";
import { BenchmarkAnalysisPage } from "./pages/BenchmarkAnalysisPage";
import { TopicPlannerPage } from "./pages/TopicPlannerPage";
import { ScriptDirectorPage } from "./pages/ScriptDirectorPage";
import { MaterialManagerPage } from "./pages/MaterialManagerPage";
import { AutoEditPage } from "./pages/AutoEditPage";
import { LiveClipPage } from "./pages/LiveClipPage";
import { DataReviewPage } from "./pages/DataReviewPage";
import { AttributionTracePage } from "./pages/AttributionTracePage";
import { HotspotPage } from "./pages/HotspotPage";
import { ApiSettingsPage } from "./pages/ApiSettingsPage";
import { BrandStrategyPage } from "./pages/BrandStrategyPage";
import { AgentRegistryPage, AuditLogPage, OperationsDashboardPage, WorkflowLibraryPage } from "./pages/OperationsPages";
import { api } from "./api/client";
import { ResultCard } from "./components/ResultCard";
import "./style.css";

const pipelineSteps = [
  { key: "import", title: "账号导入", desc: "建立账号档案", component: ImportPage },
  { key: "diagnosis", title: "账号诊断", desc: "拆解增长问题", component: AccountDiagnosisPage },
  { key: "benchmark", title: "对标分析", desc: "学习优质结构", component: BenchmarkAnalysisPage },
  { key: "topic", title: "选题规划", desc: "生成主题池", component: TopicPlannerPage },
  { key: "script", title: "脚本导演", desc: "文案与分镜", component: ScriptDirectorPage },
  { key: "edit", title: "自动剪辑", desc: "剪辑计划与预览", component: AutoEditPage },
  { key: "review", title: "数据复盘", desc: "7d / 14d 指标", component: DataReviewPage },
  { key: "attribution", title: "归因追踪", desc: "解释结果", component: AttributionTracePage },
  { key: "hotspot", title: "爆点优化", desc: "沉淀规则", component: HotspotPage },
];

function requestedView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") || window.location.hash.replace("#", "") || "overview";
}

function PipelinePage({ activeView, navigate, sharedProps }: any) {
  const selected = pipelineSteps.find((item) => item.key === activeView) || pipelineSteps[0];
  const Component = selected.component;
  return <div className="ops-page ops-pipeline-page"><div className="ops-page-head"><div><p>CONTENT PIPELINE</p><h1>内容生产中心</h1><span>账号、选题、脚本、剪辑、复盘和归因的连续工作流</span></div></div><div className="ops-pipeline-tabs">{pipelineSteps.map((item, index) => <button className={selected.key === item.key ? "active" : ""} key={item.key} onClick={() => navigate(item.key)} type="button"><span>{index + 1}</span><div><strong>{item.title}</strong><small>{item.desc}</small></div></button>)}</div><section className="ops-pipeline-workspace"><div className="ops-module-heading"><span>{String(pipelineSteps.indexOf(selected) + 1).padStart(2, "0")}</span><div><h2>{selected.title}</h2><p>{selected.desc} · 所有操作直接连接现有后端接口</p></div></div><Component {...sharedProps} /><ResultCard title={`${selected.title} · Demo 结果`} result={sharedProps.result} /></section></div>;
}

function App() {
  const [state, setState] = useState<any>({});
  const [result, setResult] = useState<any>({});
  const [activeView, setActiveView] = useState(requestedView);
  const [refreshToken, setRefreshToken] = useState(0);
  const [modelReady, setModelReady] = useState(false);

  function navigate(view: string) {
    const target = view === "pipeline" ? "import" : view === "models" ? "settings" : view;
    setActiveView(target);
    const url = new URL(window.location.href);
    url.searchParams.set("view", target);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    api("/api/config/model-provider").then((response) => {
      const routes = response.data?.routes || [];
      setModelReady(routes.length > 0 && routes.some((item: any) => item.ready));
    }).catch(() => setModelReady(false));
  }, [refreshToken]);

  const sharedProps = { state, setState, result, setResult };
  let content: React.ReactNode;
  if (activeView === "overview") content = <OperationsDashboardPage onNavigate={navigate} refreshToken={refreshToken} />;
  else if (activeView === "agents") content = <AgentRegistryPage onNavigate={navigate} refreshToken={refreshToken} />;
  else if (activeView === "workflows") content = <WorkflowLibraryPage onNavigate={navigate} />;
  else if (activeView === "audit") content = <AuditLogPage refreshToken={refreshToken} />;
  else if (activeView === "liveclip") content = <div className="ops-embedded ops-embedded-liveclip"><LiveClipPage {...sharedProps} onNavigate={navigate} /></div>;
  else if (activeView === "material" || activeView === "material-assets") content = <div className="ops-embedded"><MaterialManagerPage {...sharedProps} assetGalleryOnly={activeView === "material-assets"} onNavigate={navigate} /></div>;
  else if (activeView === "settings") content = <div className="ops-embedded ops-embedded-settings"><ApiSettingsPage {...sharedProps} onNavigate={navigate} /></div>;
  else if (activeView === "brand") content = <BrandStrategyPage />;
  else content = <PipelinePage activeView={activeView} navigate={navigate} sharedProps={sharedProps} />;

  return <OperationsShell activeView={activeView} modelReady={modelReady} onNavigate={navigate} onRefresh={() => setRefreshToken((value) => value + 1)} onConfigSaved={() => setRefreshToken((value) => value + 1)}>{content}</OperationsShell>;
}

createRoot(document.getElementById("root")!).render(<App />);
