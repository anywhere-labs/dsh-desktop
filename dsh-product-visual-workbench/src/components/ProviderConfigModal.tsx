import { useEffect, useState } from "react";
import {
  getImageProviderConfig,
  probeTextModel,
  saveImageProviderConfig,
  validateImageProviderConfig,
} from "../api/client";

type Props = { onClose: () => void; onSaved?: () => void };
type Form = Record<string, string>;

const presets: Record<string, Partial<Form>> = {
  apimart: { provider: "apimart", api_base: "https://api.apimart.ai/v1", model: "gpt-image-2" },
  openai: { provider: "openai", api_base: "https://api.openai.com/v1", model: "gpt-image-2" },
  stepfun: { provider: "stepfun", api_base: "https://api.stepfun.ai/v1", model: "step-image-edit-2" },
  custom: { provider: "custom", api_base: "", model: "" },
};

const initialForm: Form = {
  provider: "apimart", api_base: "https://api.apimart.ai/v1", model: "gpt-image-2",
  text_model: "gpt-4.1-mini", vision_model: "gpt-4.1-mini", api_key: "", protocol: "openai-compatible",
};

export function ProviderConfigModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState<Form>(initialForm);
  const [status, setStatus] = useState<any>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getImageProviderConfig().then((res) => {
      const data = res.data || {};
      setForm((current) => ({ ...current, ...data, api_key: "", protocol: data.provider === "stepfun" ? "stepfun-edit" : "openai-compatible" }));
      setStatus(data);
    }).catch(() => setMessage("无法读取本地后端配置"));
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function update(field: string, value: string) { setForm((current) => ({ ...current, [field]: value })); }
  function selectProvider(provider: string) {
    const preset = presets[provider];
    setForm((current) => ({ ...current, ...preset, api_key: "", protocol: provider === "stepfun" ? "stepfun-edit" : "openai-compatible" }));
  }

  async function save() {
    setBusy("save"); setMessage("");
    try {
      const res = await saveImageProviderConfig(form);
      setStatus(res.data || {}); setForm((current) => ({ ...current, ...(res.data || {}), api_key: "" }));
      setMessage(res.status === "ok" ? "配置已保存，重启 DSH 后仍会保留" : res.message || "保存未通过");
      if (res.status === "ok") onSaved?.();
    } catch { setMessage("保存失败，请确认 FastAPI Sidecar 正常运行"); }
    finally { setBusy(""); }
  }

  async function validate() {
    setBusy("validate"); setMessage("");
    try { const res = await validateImageProviderConfig(); setStatus(res.data || {}); setMessage(res.status === "ok" ? "配置验证通过" : `配置未就绪：${(res.missing_inputs || []).join("、")}`); }
    catch { setMessage("验证失败，请确认后端地址可访问"); }
    finally { setBusy(""); }
  }

  async function probe() {
    setBusy("probe"); setMessage("");
    try { const res = await probeTextModel(form.text_model); setMessage(res.status === "ok" ? `文本模型连接成功 · ${res.data?.latency_ms ?? "-"} ms` : res.data?.error || "文本模型连接未通过"); }
    catch { setMessage("连接测试失败"); }
    finally { setBusy(""); }
  }

  return <div className="provider-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-label="模型路由配置" className="provider-modal" role="dialog">
      <header><div><p>DSH HARNESS · LOCAL CONFIG</p><h2>后端联动配置</h2><span>配置保存到本地 FastAPI，不会随 DSH 重启重置</span></div><button aria-label="关闭配置" onClick={onClose} type="button">×</button></header>
      <div className="provider-modal-body">
        <div className="provider-modal-grid">
          <label>协议<select value={form.protocol} onChange={(e) => update("protocol", e.target.value)}><option value="openai-compatible">OpenAI Compatible</option><option value="stepfun-edit">StepFun 图片编辑</option></select></label>
          <label>Provider<select value={form.provider} onChange={(e) => selectProvider(e.target.value)}><option value="apimart">APIMart</option><option value="openai">OpenAI</option><option value="stepfun">StepFun</option><option value="custom">自定义</option></select></label>
        </div>
        <label>API Base URL<input value={form.api_base} onChange={(e) => update("api_base", e.target.value)} placeholder="https://your-provider.example/v1" /></label>
        <div className="provider-modal-grid"><label>图片模型<input value={form.model} onChange={(e) => update("model", e.target.value)} /></label><label>文本/分析模型<input value={form.text_model} onChange={(e) => update("text_model", e.target.value)} /></label></div>
        <label>API Key<input autoComplete="new-password" placeholder={status.has_api_key ? `已保存：${status.api_key_masked}，留空不覆盖` : "仅在本机输入，保存后只显示掩码"} type="password" value={form.api_key} onChange={(e) => update("api_key", e.target.value)} /></label>
        <div className="provider-route-preview"><strong>实际联动路由</strong><span>图片：{form.api_base.replace(/\/$/, "")}/{form.provider === "stepfun" ? "images/edits" : "images/generations"}</span><span>文本：{form.api_base.replace(/\/$/, "")}/chat/completions</span><em className={status.has_api_key ? "ready" : ""}>{status.has_api_key ? "Key 已保存" : "待配置 Key"}</em></div>
        {message ? <div className={message.includes("通过") || message.includes("成功") || message.includes("保存") ? "provider-modal-message ok" : "provider-modal-message"}>{message}</div> : null}
      </div>
      <footer><button className="provider-modal-secondary" disabled={Boolean(busy)} onClick={validate} type="button">{busy === "validate" ? "验证中…" : "验证配置"}</button><button className="provider-modal-secondary" disabled={Boolean(busy)} onClick={probe} type="button">{busy === "probe" ? "测试中…" : "测试文本模型"}</button><button className="provider-modal-primary" disabled={Boolean(busy)} onClick={save} type="button">{busy === "save" ? "保存中…" : "保存并应用"}</button></footer>
    </section>
  </div>;
}
