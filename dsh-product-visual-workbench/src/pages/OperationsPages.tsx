import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

type DashboardData = Record<string, any>;

function useOperationsData(refreshToken = 0) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    api("/api/dashboard/full").then((response) => {
      if (!active) return;
      if (response.status !== "ok") setError(response.message || "工作台数据加载失败");
      else setData(response.data || {});
    }).catch((reason) => active && setError(String(reason)));
    return () => { active = false; };
  }, [refreshToken]);
  return { data, error };
}

function PageState({ error, loading }: { error: string; loading: boolean }) {
  if (error) return <div className="ops-page-state error"><strong>数据加载失败</strong><span>{error}</span></div>;
  if (loading) return <div className="ops-page-state"><span className="ops-spinner" /><strong>正在读取真实运行数据</strong></div>;
  return null;
}

function Status({ value }: { value: string }) {
  const normalized = String(value || "unknown").toLowerCase();
  const tone = /ok|complete|success|ready|export|approved/.test(normalized) ? "ok" : /fail|block|error/.test(normalized) ? "bad" : /run|process|queue/.test(normalized) ? "running" : "muted";
  const labels: Record<string, string> = { completed: "已完成", running: "运行中", failed: "失败", blocked: "阻塞", created: "已创建", exported: "已导出", ok: "正常" };
  return <span className={`ops-status ${tone}`}><i />{labels[normalized] || value || "未知"}</span>;
}

const metricDefinitions = [
  ["task_count", "累计任务", "条真实任务", "⌘"],
  ["liveclip_count", "直播切片", "条切片任务", "✂"],
  ["pending_materials", "素材资产", "份已登记素材", "▣"],
  ["exported_videos", "成片导出", "份视频导出", "↗"],
  ["success_rate", "执行成功率", "基于任务结果", "✓"],
  ["ready_model_routes", "模型路由", "条已就绪路由", "◈"],
];

export function OperationsDashboardPage({ refreshToken = 0, onNavigate }: { refreshToken?: number; onNavigate: (view: string) => void }) {
  const { data, error } = useOperationsData(refreshToken);
  if (!data || error) return <PageState error={error} loading={!data} />;
  const statuses = Object.entries(data.task_status_counts || {});
  const maxStatus = Math.max(1, ...statuses.map(([, count]) => Number(count)));
  return (
    <div className="ops-page ops-dashboard-page">
      <div className="ops-page-head"><div><p>REALTIME OVERVIEW</p><h1>实时运营总览</h1><span>任务、Agent、素材与交付链路的真实运行快照</span></div><button onClick={() => onNavigate("liveclip")} type="button">＋ 创建直播切片任务</button></div>
      <section className="ops-metric-grid">
        {metricDefinitions.map(([key, label, hint, icon]) => {
          const value = key === "success_rate" ? `${Number(data[key] || 0).toFixed(1)}%` : key === "ready_model_routes" ? `${data[key] || 0}/${data.model_route_count || 0}` : data[key] || 0;
          const truthHint = key === "task_count" && data.verification_task_count ? `${data.verification_task_count} 条测试/验收记录已隔离` : hint;
          return <article className="ops-metric-card" key={key}><div><span>{label}</span><strong>{value}</strong><small>{truthHint}</small></div><i>{icon}</i></article>;
        })}
      </section>
      <section className="ops-dashboard-grid">
        <article className="ops-panel ops-status-chart"><div className="ops-panel-head"><div><h2>任务状态分布</h2><p>来自当前数据库任务表</p></div><Status value={data.task_count ? "ok" : "created"} /></div>
          {statuses.length ? <div className="ops-bar-list">{statuses.map(([name, count]) => <div key={name}><span>{name}</span><b><i style={{ width: `${Math.max(4, Number(count) / maxStatus * 100)}%` }} /></b><strong>{String(count)}</strong></div>)}</div> : <div className="ops-empty">尚无任务状态记录</div>}
        </article>
        <article className="ops-panel ops-route-summary"><div className="ops-panel-head"><div><h2>Agent 调用路由</h2><p>模型、能力与 Skill 的绑定关系</p></div><button onClick={() => onNavigate("agents")} type="button">查看全部</button></div>
          <div className="ops-route-list">{(data.model_routes || []).slice(0, 5).map((route: any) => <div key={route.intent}><span className="ops-agent-avatar">{String(route.label || "A").slice(0, 1)}</span><div><strong>{route.label}</strong><small>{route.model} · {route.skill}</small></div><Status value={route.ready ? "ready" : "blocked"} /></div>)}</div>
        </article>
      </section>
      <section className="ops-dashboard-bottom">
        <article className="ops-panel"><div className="ops-panel-head"><div><h2>最近执行任务</h2><p>按更新时间倒序</p></div><button onClick={() => onNavigate("audit")} type="button">日志审计</button></div><TaskTable rows={data.recent_tasks || []} /></article>
        <article className="ops-panel ops-suggestions"><div className="ops-panel-head"><div><h2>下一轮增长建议</h2><p>当前策略库中的行动提示</p></div></div>{(data.weekly_growth_suggestions || []).map((item: string, index: number) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}</article>
      </section>
    </div>
  );
}

function TaskTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <div className="ops-empty">暂无任务记录</div>;
  return <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>任务 ID</th><th>类型 / 工作流</th><th>状态</th><th>审核</th><th>更新时间</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><code>{row.id}</code></td><td><strong>{row.type || "-"}</strong><small>{row.workflow || "未标注工作流"}</small></td><td><Status value={row.status} /></td><td>{row.review_status || "-"}</td><td>{row.updated_at?.replace("T", " ") || "-"}</td></tr>)}</tbody></table></div>;
}

export function AgentRegistryPage({ refreshToken = 0, onNavigate }: { refreshToken?: number; onNavigate: (view: string) => void }) {
  const { data, error } = useOperationsData(refreshToken);
  if (!data || error) return <PageState error={error} loading={!data} />;
  return <div className="ops-page"><div className="ops-page-head"><div><p>AGENT REGISTRY</p><h1>Agent 管理</h1><span>每个 Agent 都对应真实模型路由、Skill 与后端能力</span></div><button onClick={() => onNavigate("models")} type="button">配置模型路由</button></div><section className="ops-panel"><div className="ops-agent-table-head"><span>Agent / Skill</span><span>能力</span><span>模型路由</span><span>状态</span></div>{(data.model_routes || []).map((route: any, index: number) => <div className="ops-agent-row" key={route.intent}><span className="ops-agent-avatar">{index + 1}</span><div><strong>{route.label}</strong><small>{route.skill}</small></div><div><strong>{route.capability}</strong><small>{route.intent}</small></div><div><strong>{route.provider}</strong><small>{route.model}</small></div><Status value={route.ready ? "ready" : "blocked"} /></div>)}</section></div>;
}

const workflowNodes = [
  ["import", "账号导入", "建立账号档案"], ["diagnosis", "账号诊断", "拆解增长问题"], ["benchmark", "对标分析", "提炼可学习结构"], ["topic", "选题规划", "生成内容主题池"], ["script", "脚本导演", "口播与分镜决策"], ["material", "素材中心", "素材与商品视觉"], ["edit", "自动剪辑", "生成剪辑计划"], ["liveclip", "直播切片", "长视频病毒片段提取"], ["review", "数据复盘", "导入 7d / 14d 指标"], ["attribution", "归因追踪", "解释成功与失败"], ["hotspot", "爆点优化", "沉淀下一轮规则"],
];

const promptRegistry = [
  ["增长诊断 Prompt", "账号诊断 / 对标分析", "v1"], ["选题规划 Prompt", "一周主题池", "v1"], ["脚本导演 Prompt", "口播文案 / 分镜 / 素材", "v1"], ["直播切片决策 Prompt", "片段评分 / 标题 / 文案", "v1.2"], ["编导介入 Prompt", "意义判断 / 动效 / 因果归因", "v1"],
];

export function WorkflowLibraryPage({ onNavigate }: { onNavigate: (view: string) => void }) {
  const [tab, setTab] = useState<"workflow" | "prompt">("workflow");
  return <div className="ops-page"><div className="ops-page-head"><div><p>WORKFLOW STUDIO</p><h1>工作流与 Prompt</h1><span>从内容输入到交付与复盘的可追踪闭环</span></div><div className="ops-tabs"><button className={tab === "workflow" ? "active" : ""} onClick={() => setTab("workflow")} type="button">工作流编排</button><button className={tab === "prompt" ? "active" : ""} onClick={() => setTab("prompt")} type="button">Prompt 注册表</button></div></div>{tab === "workflow" ? <section className="ops-workflow-canvas"><div className="ops-workflow-line" />{workflowNodes.map(([key, name, desc], index) => <button className={key === "liveclip" ? "ops-workflow-node featured" : "ops-workflow-node"} key={key} onClick={() => onNavigate(key)} type="button"><span>{index + 1}</span><div><strong>{name}</strong><small>{desc}</small></div><em>打开 ↗</em></button>)}</section> : <section className="ops-panel"><div className="ops-prompt-list">{promptRegistry.map(([name, consumer, version], index) => <div key={name}><span>0{index + 1}</span><div><strong>{name}</strong><small>消费模块：{consumer}</small></div><b>{version}</b><Status value="ready" /></div>)}</div><p className="ops-truth-note">Prompt 页面展示的是当前项目内置注册信息；后端尚无独立版本数据库，因此不虚构更新人和调用次数。</p></section>}</div>;
}

export function AuditLogPage({ refreshToken = 0 }: { refreshToken?: number }) {
  const { data, error } = useOperationsData(refreshToken);
  const [filter, setFilter] = useState("all");
  const entries = useMemo(() => {
    const traces = (data?.recent_traces || []).map((item: any) => ({ ...item, kind: "Trace", time: item.created_at, name: item.agent_name || item.stage }));
    const tasks = (data?.recent_tasks || []).map((item: any) => ({ ...item, kind: "Task", time: item.updated_at, name: item.type || item.workflow }));
    return [...traces, ...tasks].filter((item) => filter === "all" || (filter === "failed" ? /fail|block|error/i.test(item.status) : /run|process|queue/i.test(item.status))).sort((a, b) => String(b.time).localeCompare(String(a.time)));
  }, [data, filter]);
  if (!data || error) return <PageState error={error} loading={!data} />;
  return <div className="ops-page"><div className="ops-page-head"><div><p>AUDIT & TRACE</p><h1>日志审计</h1><span>任务状态与 Agent Trace 的统一时间线</span></div><div className="ops-tabs">{[["all", "全部"], ["failed", "失败 / 阻塞"], ["running", "运行中"]].map(([key, label]) => <button className={filter === key ? "active" : ""} key={key} onClick={() => setFilter(key)} type="button">{label}</button>)}</div></div><section className="ops-panel ops-audit-list">{entries.length ? entries.map((item, index) => <div key={`${item.kind}-${item.id}-${index}`}><span className="ops-audit-kind">{item.kind}</span><i /><div><strong>{item.name || "未命名事件"}</strong><small>{item.stage || item.workflow || item.id}</small>{item.error ? <em>{item.error}</em> : null}</div><span>{item.model_name || item.review_status || "-"}</span><b>{item.duration_ms ? `${item.duration_ms} ms` : ""}</b><Status value={item.status} /><time>{String(item.time || "").replace("T", " ")}</time></div>) : <div className="ops-empty">当前筛选下暂无日志</div>}</section></div>;
}
