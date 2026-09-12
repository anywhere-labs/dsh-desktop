import { useEffect, useState } from "react";
import {
  getImageProviderConfig,
  probeTextModel,
  saveImageProviderConfig,
  validateImageProviderConfig,
} from "../api/client";

export const PLATFORM_API_REGISTER_URL = "https://www.codox.cc/register?aff=HZLATWKYAP7P";
export const CUSTOM_PROVIDER_API_BASE = "https://codox-xaas.tidescend.com";

const defaultForm = {
  provider: "apimart",
  api_base: "https://api.apimart.ai/v1",
  model: "gpt-image-2",
  text_model: "gpt-4.1-mini",
  vision_model: "gpt-4.1-mini",
  size: "1:1",
  resolution: "2k",
  quality: "medium",
  output_format: "png",
  cfg_scale: "1.0",
  steps: "8",
  seed: "1",
  text_mode: "true",
  api_key: "",
};

const providerPresets: Record<string, Partial<typeof defaultForm>> = {
  apimart: {
    provider: "apimart",
    api_base: "https://api.apimart.ai/v1",
    model: "gpt-image-2",
  },
  openai: {
    provider: "openai",
    api_base: "https://api.openai.com/v1",
    model: "gpt-image-2",
  },
  stepfun: {
    provider: "stepfun",
    api_base: "https://api.stepfun.ai/v1",
    model: "step-image-edit-2",
  },
  codox: {
    provider: "codox",
    api_base: CUSTOM_PROVIDER_API_BASE,
    model: "gpt-image-2",
  },
};

export function buildCustomProviderForm(current: Partial<typeof defaultForm> = {}) {
  return {
    provider: "codox",
    api_base: CUSTOM_PROVIDER_API_BASE,
    model: "gpt-image-2",
    text_model: current.text_model || defaultForm.text_model,
    vision_model: current.vision_model || defaultForm.vision_model,
    api_key: "",
  };
}

export function buildProviderApiBase(provider: string, apiBase: string) {
  const base = String(apiBase || "").replace(/\/$/, "");
  if (provider === "codox" && base === CUSTOM_PROVIDER_API_BASE) return `${base}/v1`;
  return base;
}

function providerDisplayName(provider: string) {
  if (provider === "stepfun") return "StepFun";
  if (provider === "openai") return "OpenAI";
  if (provider === "codox") return "Codox XaaS";
  return "APIMart";
}

export function ApiSettingsPage({ onNavigate, setResult }: any) {
  const [form, setForm] = useState(defaultForm);
  const [status, setStatus] = useState<any>({});
  const [busy, setBusy] = useState("");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  useEffect(() => {
    getImageProviderConfig().then((res) => {
      const data = res.data || {};
      setForm((current) => ({ ...current, ...data, api_key: "" }));
      setStatus(data);
    });
  }, []);

  async function save() {
    setBusy("save");
    try {
      const res = await saveImageProviderConfig(form);
      setResult?.(res);
      if (res.data) {
        setStatus(res.data);
        setForm((current) => ({ ...current, ...res.data, api_key: "" }));
      }
    } finally {
      setBusy("");
    }
  }

  async function validate() {
    setBusy("validate");
    try {
      const res = await validateImageProviderConfig();
      setResult?.(res);
      setStatus(res.data || {});
    } finally {
      setBusy("");
    }
  }

  async function probeModel() {
    setBusy("probe");
    try {
      const saved = await saveImageProviderConfig(form);
      if (saved.data) setStatus(saved.data);
      const res = await probeTextModel(form.text_model);
      setResult?.(res);
      setStatus((current: any) => ({ ...current, text_probe: res.data, text_probe_status: res.status }));
    } finally {
      setBusy("");
    }
  }

  function selectProvider(provider: string) {
    setForm((current) => ({ ...current, ...(provider === "codox" ? buildCustomProviderForm(current) : providerPresets[provider]), api_key: "" }));
  }

  const isStepFun = form.provider === "stepfun";
  const baseUrl = buildProviderApiBase(form.provider, form.api_base);
  const imageEndpoint = `${baseUrl}${isStepFun ? "/images/edits" : "/images/generations"}`;
  const platformName = providerDisplayName(form.provider);

  return (
    <div className="commerce-shell api-settings-shell">
      <header className="commerce-topbar">
        <div className="commerce-brand"><span>C</span><strong>电商内容与经营分析智能化系统</strong></div>
        <button className="stage-select" type="button">系统设置</button>
        <input className="commerce-search" placeholder="搜索功能、报表、内容等" />
        <div className="commerce-user"><span className="bell">12</span><strong>王小媛</strong></div>
      </header>

      <div className={sidebarExpanded ? "commerce-body sidebar-expanded" : "commerce-body sidebar-collapsed"}>
        <aside className={sidebarExpanded ? "commerce-sidebar expanded" : "commerce-sidebar collapsed"} onMouseEnter={() => setSidebarExpanded(true)} onMouseLeave={() => setSidebarExpanded(false)}>
          <button aria-label={sidebarExpanded ? "收起左侧导航" : "展开左侧导航"} className="sidebar-toggle" onClick={() => setSidebarExpanded(!sidebarExpanded)} type="button"><span>{sidebarExpanded ? "‹" : "›"}</span><em>{sidebarExpanded ? "收起" : "展开"}</em></button>
          <button type="button" title="商品图与详情页" onClick={() => onNavigate?.("material")}><span>◎</span><em>商品图与详情页</em></button>
          <button type="button" title="直播切片分发" onClick={() => onNavigate?.("liveclip")}><span>◎</span><em>直播切片分发</em></button>
          <button className="active" title="系统设置" type="button"><span>⚙</span><em>系统设置</em></button>
          <div className="autosave-card api-key-state">
            <strong>{status.has_api_key ? "API Key 已保存" : "API Key 未配置"}</strong>
            <small>{status.api_key_masked || "页面不会显示完整 Key"}</small>
          </div>
        </aside>

        <main className="api-settings-main">
          <div className="api-settings-head">
            <p>CURRENT MODULE</p>
            <h1>系统设置</h1>
            <span>/api/config/model-provider</span>
          </div>

          <section className="api-settings-card">
            <div className="api-settings-title">
              <div>
                <h2>API 设置</h2>
                <p>统一管理模型平台、模型和 Key。商品图、品牌策略、数据抓取、直播切片和数据报告统一从这里读取配置。</p>
              </div>
              <button disabled={Boolean(busy)} onClick={save} type="button">
                {busy === "save" ? "保存中..." : "保存"}
              </button>
            </div>

            <div className="api-settings-layout">
              <aside className="provider-list">
                <button className={form.provider === "apimart" ? "active" : ""} onClick={() => selectProvider("apimart")} type="button">
                  APIMart<br /><small>https://api.apimart.ai/v1</small>
                </button>
                <button className={form.provider === "openai" ? "active" : ""} onClick={() => selectProvider("openai")} type="button">
                  OpenAI 兼容<br /><small>/v1/images/generations</small>
                </button>
                <button className={isStepFun ? "active" : ""} onClick={() => selectProvider("stepfun")} type="button">
                  StepFun<br /><small>/v1/images/edits</small>
                </button>
                <button className={form.provider === "codox" ? "active" : ""} onClick={() => selectProvider("codox")} type="button">
                  ＋ 新增平台<br /><small>{CUSTOM_PROVIDER_API_BASE}</small>
                </button>
                <a href={PLATFORM_API_REGISTER_URL} rel="noreferrer" target="_blank">获取平台 API</a>
              </aside>

              <div className="provider-form">
                <h3>{platformName} / {form.model}</h3>
                <p>
                  {isStepFun
                    ? "原生图片编辑接入：提交真实参考图与提示词，返回图片并保存为本地资产。"
                    : "提交图片生成任务，获取结果并下载图片到本地。"}
                </p>
                <label>平台名称<input value={platformName} readOnly /></label>
                <label>平台 ID<input value={form.provider} readOnly /></label>
                <label>请求地址<input value={form.api_base} onChange={(e) => setForm({ ...form, api_base: e.target.value })} /></label>

                <div className="api-hints">
                  <span>{isStepFun ? "图片编辑" : "图片生成"}：{imageEndpoint}</span>
                  {!isStepFun && <span>任务轮询：{baseUrl}/tasks/{"{task_id}"}</span>}
                  <span>文本/分析：{baseUrl}/chat/completions</span>
                </div>

                <label>{isStepFun ? "图片编辑模型" : "图片生成模型"}<input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
                <div className="settings-row">
                  <label>文本分析模型<input list="text-model-presets" value={form.text_model} onChange={(e) => setForm({ ...form, text_model: e.target.value })} /><datalist id="text-model-presets"><option value="deepseek-v3" /><option value="deepseek-r1" /><option value="gpt-4.1-mini" /></datalist></label>
                  <label>视觉分析模型<input value={form.vision_model} onChange={(e) => setForm({ ...form, vision_model: e.target.value })} /></label>
                </div>
                <div className="model-preset-row">
                  <span>编导 / 分析模型快捷选择</span>
                  <button className={form.text_model === "deepseek-v3" ? "active" : ""} onClick={() => setForm({ ...form, text_model: "deepseek-v3" })} type="button">DeepSeek V3</button>
                  <button className={form.text_model === "deepseek-r1" ? "active" : ""} onClick={() => setForm({ ...form, text_model: "deepseek-r1" })} type="button">DeepSeek R1</button>
                  <button className={form.text_model === "gpt-4.1-mini" ? "active" : ""} onClick={() => setForm({ ...form, text_model: "gpt-4.1-mini" })} type="button">GPT-4.1 mini</button>
                </div>

                <div className="settings-row">
                  <label>尺寸<select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}><option>1:1</option><option>4:3</option><option>3:4</option><option>16:9</option><option>9:16</option></select></label>
                  <label>清晰度<select value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })}><option>1k</option><option>2k</option><option>4k</option></select></label>
                  <label>格式<select value={form.output_format} onChange={(e) => setForm({ ...form, output_format: e.target.value })}><option>png</option><option>jpg</option><option>webp</option></select></label>
                </div>

                {isStepFun && (
                  <div className="settings-row">
                    <label>CFG Scale<input value={form.cfg_scale} onChange={(e) => setForm({ ...form, cfg_scale: e.target.value })} /></label>
                    <label>Steps<input value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} /></label>
                    <label>Seed<input value={form.seed} onChange={(e) => setForm({ ...form, seed: e.target.value })} /></label>
                    <label>文字渲染<select value={form.text_mode} onChange={(e) => setForm({ ...form, text_mode: e.target.value })}><option value="true">开启</option><option value="false">关闭</option></select></label>
                  </div>
                )}

                <label>API Key<input placeholder={status.has_api_key ? "已保存，留空则不覆盖" : "输入 API Key"} type="password" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} /></label>
                <div className="settings-actions">
                  <button disabled={Boolean(busy)} onClick={validate} type="button">{busy === "validate" ? "验证中..." : "验证配置"}</button>
                  <button disabled={Boolean(busy)} onClick={probeModel} type="button">{busy === "probe" ? "连接中..." : "测试文本模型"}</button>
                  <button disabled={Boolean(busy)} onClick={save} type="button">保存到后端</button>
                </div>
                <div className={status.has_api_key ? "settings-status ok" : "settings-status"}>
                  当前状态：{status.has_api_key ? `Key 已保存（${status.api_key_masked}）` : "缺少 API Key"}
                </div>
                <div className="settings-status ok">
                  StepFun 当前能力边界：商品视觉参考图编辑。其他模块继续使用各自兼容模型路由。
                </div>
                {status.text_probe ? <div className={status.text_probe_status === "ok" ? "settings-status ok" : "settings-status"}>文本模型实测：{status.text_probe.model} · {status.text_probe.verified ? `连接成功，${status.text_probe.latency_ms} ms` : status.text_probe.error || "连接未通过"}</div> : null}
                <div className="route-grid">
                  {(status.routes || []).map((route: any) => (
                    <div className={route.ready ? "route-card ready" : "route-card"} key={route.intent}>
                      <strong>{route.label}</strong>
                      <span>{route.capability}</span>
                      <small>{route.model}</small>
                      <em>{route.ready ? "可调用" : "待配置"}</em>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
