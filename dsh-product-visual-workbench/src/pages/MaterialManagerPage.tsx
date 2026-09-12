import { useEffect, useMemo, useState } from "react";
import {
  createProductVisualTask,
  exportProductVisualTask,
  getProductVisualResult,
  getProductVisualRuntime,
  getProductVisualStatus,
  refreshProductVisualTitles,
  retryProductVisualAsset,
  reviewProductVisualTask,
  runProductVisualTask,
  saveProductVisualDraft,
  uploadProductVisualAsset,
} from "../api/client";

const API_BASE = (import.meta as any).env?.VITE_API_BASE || "";
export const productVisualInputSlots = [
  { key: "input_image_1", label: "图一：品牌LOGO", hint: "云水禾 / CLOUD WATER GRAIN 标识" },
  { key: "input_image_2", label: "图二：商品图", hint: "商品平铺或挂拍，锁定款式、颜色、图案" },
  { key: "input_image_3", label: "图三：模特图", hint: "锁定同一位成人女性模特脸型、气质与体态" },
  { key: "input_image_4", label: "图四：细节/尺码参考", hint: "可选：面料细节、尺码表或包装售后参考" },
];
export const requiredProductVisualInputKeys = ["input_image_1", "input_image_2", "input_image_3"];
export const productVisualPlatformOptions = [
  { value: "douyin", label: "抖音" },
  { value: "kuaishou", label: "快手" },
  { value: "xhs", label: "小红书" },
  { value: "shipinhao", label: "视频号" },
];
export const productVisualOutputPlan = [
  "云水禾_主图_01_商品全景LOGO_3比4",
  "云水禾_主图_02_面料卖点_3比4",
  "云水禾_主图_03_产品细节版型_3比4",
  "云水禾_主图_04_场景图_3比4",
  "云水禾_主图_05_尺码表_3比4",
  "云水禾_主图_06_正侧视图_3比4",
  "云水禾_白底图_07_正面_3比4",
  "云水禾_白底图_08_侧面_3比4",
  "云水禾_白底图_09_背面_3比4",
  "云水禾_详情页_01_品牌介绍_9比16",
  "云水禾_详情页_02_面料工艺_9比16",
  "云水禾_详情页_03_商品展示_9比16",
  "云水禾_详情页_04_场景展示_9比16",
  "云水禾_详情页_05_模特多场景图_9比16",
  "云水禾_详情页_06_尺码表_9比16",
  "云水禾_详情页_07_包装展示_9比16",
  "云水禾_详情页_08_物流售后_9比16",
];
export const productVisualReferenceStandards = [
  {
    label: "主图",
    spec: "按目标平台",
    items: ["商品全景LOGO", "面料卖点：织纹/微光泽/刺绣", "产品细节版型：圆领/无袖/盘扣", "场景图：茶室东方雅致", "尺码表", "正侧视图"],
  },
  {
    label: "白底图",
    spec: "3比4",
    items: ["正面白底完整", "侧面白底版型", "背面白底结构"],
  },
  {
    label: "详情页",
    spec: "9比16｜单模特多场景重点",
    items: ["品牌介绍", "面料工艺", "商品展示", "场景展示", "单模特多场景：茶室/通勤/约会/日常出行/旅行拍照", "尺码表", "包装展示", "物流售后"],
  },
];

const stepLabels = ["资料上传", "卖点提炼", "首图策略", "主图生成", "详情页生成", "结果导出"];
const statusText: Record<string, string> = {
  created: "已创建",
  draft_saved: "草稿已保存",
  assets_uploaded: "资料已上传",
  running: "生成中",
  pending_review: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  completed: "已完成",
  failed: "失败",
  exported: "已导出",
};
const PRODUCT_VISUAL_TASK_KEY = "productVisualTaskId";
const EMPTY_PRODUCT_VISUAL_PREVIEW = {
  main_images: [],
  detail_pages: [],
  title_candidates: ["云水禾新中式连衣裙｜桑蚕丝碎花 收腰显瘦", "连衣裙女春夏新款｜无袖中长款 气质通勤", "抖音同款气质连衣裙｜桑蚕丝碎花 春夏通勤"],
  click_strategy_scores: { product_recognition: 86, selling_point_front: 78, thumbnail_readability: 82, competitor_difference: 74 },
  platform_score: { platform: "douyin", platform_label: "抖音", overall: 0, rule_version: "douyin_product_visual_v2", dimensions: {}, group_scores: {}, asset_scores: [], source: "pending" },
  export_options: ["image_zip", "copywriting_package", "json_fields"],
};

function isProductVisualTaskId(taskId?: string | null) {
  return Boolean(taskId && taskId.startsWith("pv_"));
}

function initialProductVisualTaskId(state: any) {
  if (isProductVisualTaskId(state.productVisualTaskId)) return state.productVisualTaskId;
  const params = new URLSearchParams(window.location.search);
  const queryTaskId = params.get("taskId");
  if (isProductVisualTaskId(queryTaskId)) return queryTaskId || "";
  const storedTaskId = window.localStorage.getItem(PRODUCT_VISUAL_TASK_KEY);
  return isProductVisualTaskId(storedTaskId) ? storedTaskId || "" : "";
}

function persistProductVisualTaskId(taskId: string) {
  if (!isProductVisualTaskId(taskId)) return;
  window.localStorage.setItem(PRODUCT_VISUAL_TASK_KEY, taskId);
  const url = new URL(window.location.href);
  url.searchParams.set("taskId", taskId);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function assetsByType(uploadedAssets: any[] = []) {
  return uploadedAssets.reduce((current: Record<string, any>, asset: any) => {
    if (asset?.asset_type) current[asset.asset_type] = asset;
    return current;
  }, {});
}

export function mergeProductVisualAssets(uploadedAssets: any[] = []) {
  return assetsByType(uploadedAssets);
}

function versionedAssetUrl(url: string, version = "") {
  const separator = url.includes("?") ? "&" : "?";
  return `${API_BASE}${url}${version ? `${separator}v=${encodeURIComponent(version)}` : ""}`;
}

function emptyProductVisualPreview(blockedReason = "result_missing") {
  return {
    ...EMPTY_PRODUCT_VISUAL_PREVIEW,
    generation_meta: {
      fallback: false,
      generation_mode: "not_generated",
      blocked_reason: blockedReason,
    },
  };
}

export function buildProductVisualPreviewState(currentPreview: any, response: any) {
  if (response?.status === "ok") return response.data || null;
  if (response?.missing_inputs?.includes("result")) return emptyProductVisualPreview("result_missing");
  if (response?.data?.status === "failed") return emptyProductVisualPreview("generation_failed");
  return currentPreview || emptyProductVisualPreview();
}

export function formatProductVisualRunError(message = "") {
  const text = String(message || "");
  if (/401/.test(text) && /invalid api key/i.test(text) && /apimart/i.test(text)) {
    return "APIMart 图片生成认证失败：API Key 无效。请到系统设置更新 APIMart Key 后重新生成。";
  }
  if (/401/.test(text) && /invalid api key/i.test(text)) {
    return "图片生成认证失败：API Key 无效。请到系统设置更新 Key 后重新生成。";
  }
  if (/timeout|context deadline exceeded|task_failed/i.test(text)) {
    return "真实图片生成超时或被服务端中止，未使用本地占位图。请检查 API Key、模型通道和网络后重试。";
  }
  if (/未配置可用 API Key|未生成本地占位图|通道不可用/i.test(text)) {
    return "真实图片生成通道未配置或不可用，未使用本地占位图。请到系统设置检查 API Key 和模型路由。";
  }
  return text || "商业图片生成失败，请检查系统设置中的模型配置与网络通道。";
}

export function formatProductVisualUploadError(response: any = {}) {
  const missing = Array.isArray(response.missing_inputs) ? response.missing_inputs : [];
  const messages: Record<string, string> = {
    image_format: "图片格式不支持，请上传 PNG、JPG、WEBP 或透明 SVG。",
    image_content: "图片内容为空，请重新选择文件。",
    image_size: "图片超过 10MB，请压缩后重新上传。",
    logo_transparency: "品牌 LOGO 必须是透明镂空 PNG 或 SVG。",
    asset_role_locked: "任务已开始生成，不能替换已上传图片。",
  };
  const known = missing.map((key: string) => messages[key]).filter(Boolean);
  return known[0] || response.data?.message || response.message || "商品图上传失败，请重新选择图片。";
}

export function formatProductVisualProviderWarning(meta: any = {}) {
  if (!meta.fallback || meta.fallback_reason !== "commercial_provider_failed") return "";
  const action = formatProductVisualRunError(meta.fallback_error || "");
  return `真实 API 生成失败，已切换本地 fallback。${action}`;
}

export function isProductVisualFallbackPreview(meta: any = {}) {
  return Boolean(meta.fallback && (meta.generation_mode === "local_mock" || meta.fallback_reason));
}

export function formatProductVisualGenerationProgress(progress: any) {
  if (!progress) return "";
  if (progress.display_text) return progress.display_text;
  const completed = Number(progress.completed ?? 0);
  const total = Number(progress.total ?? productVisualOutputPlan.length);
  const phaseLabel = progress.phase_label || (completed < 9 ? "主图生成中" : "详情页生成中");
  return `${phaseLabel} · 已完成 ${completed}/${total}`;
}

export function buildClickStrategyItems(scores: any = {}) {
  return [
    ["product_recognition", "商品识别度", scores.product_recognition],
    ["selling_point_front", "卖点前置", scores.selling_point_front],
    ["thumbnail_readability", "缩略图可读性", scores.thumbnail_readability],
    ["competitor_difference", "竞品差异化", scores.competitor_difference],
  ].map(([key, label, rawScore]: any) => {
    const score = Number.isFinite(Number(rawScore)) ? Number(rawScore) : 0;
    return {
      key,
      label,
      score,
      level: score >= 80 ? "优秀" : score >= 70 ? "良好" : "待优化",
    };
  });
}

export function buildPlatformScoreItems(dimensions: any = {}) {
  return [
    ["exposure_fit", "平台曝光适配", dimensions.exposure_fit],
    ["click", "点击吸引力", dimensions.click],
    ["value_understanding", "商品价值理解", dimensions.value_understanding],
    ["conversion", "购买转化承接", dimensions.conversion],
  ].map(([key, label, rawScore]: any) => {
    const score = Number.isFinite(Number(rawScore)) ? Number(rawScore) : 0;
    return { key, label, score, level: score >= 80 ? "优秀" : score >= 70 ? "良好" : "待优化" };
  });
}

export function formatPlatformScoreSummary(score: any = {}) {
  if (!score || !score.platform || !score.rule_version) return "平台规则评分将在生成结果后显示";
  const platformLabel = score.platform_label || productVisualPlatformOptions.find((item) => item.value === score.platform)?.label || score.platform;
  return `${platformLabel}平台规则评分 ${Number(score.overall || 0)}/100 · 规则 ${score.rule_version}`;
}

export function formatPlatformRuleNotice(rules: any = {}) {
  const logoPercent = Math.round(Number(rules.logo_max_width_ratio || 0) * 100);
  const pending = rules.verification_status === "pending_official_verification" ? " · 平台比例待官方核验" : "";
  return `${rules.platform_label || "目标平台"}主图 ${rules.main_upload_ratio || "待核验"} · 详情页 ${rules.detail_upload_ratio || "待核验"} · LOGO不超过${logoPercent}% · 主图低信息密度${pending}`;
}

export function getMissingProductVisualStartRequirements(form: any = {}, assets: Record<string, any> = {}) {
  const missing = [];
  if (!form.product_name) missing.push("商品名称");
  if (!form.target_platform) missing.push("目标平台");
  for (const slot of productVisualInputSlots.filter((item) => requiredProductVisualInputKeys.includes(item.key))) {
    if (!assets[slot.key]) missing.push(slot.label);
  }
  return missing;
}

export function canStartProductVisualGeneration(form: any = {}, _assets: Record<string, any> = {}) {
  return Boolean(form.product_name && form.target_platform);
}

export function createProductVisualStatusPoller({
  fetchStatus,
  onStatus,
  onError,
  schedule = (callback: () => void, delay: number) => window.setTimeout(callback, delay),
  clearSchedule = (timer: any) => window.clearTimeout(timer),
  baseDelayMs = 2000,
  maxDelayMs = 10000,
}: any) {
  let stopped = false;
  let inFlight = false;
  let failureCount = 0;
  let timer: any = null;

  const pollNow = async () => {
    if (stopped || inFlight) return false;
    inFlight = true;
    try {
      const response = await fetchStatus();
      if (response?.status !== "ok") throw new Error(response?.message || "状态查询失败");
      failureCount = 0;
      onStatus(response.data || {});
    } catch (_error) {
      failureCount += 1;
      onError(`状态查询暂时失败，正在重试（${failureCount}）`);
    } finally {
      inFlight = false;
      if (!stopped) {
        const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** failureCount));
        timer = schedule(pollNow, delay);
      }
    }
    return true;
  };

  return {
    pollNow,
    stop() {
      stopped = true;
      if (timer !== null) clearSchedule(timer);
    },
  };
}

export async function loadProductVisualTaskSnapshot(
  taskId: string,
  fetchStatus = () => getProductVisualStatus(taskId),
  fetchResult = () => getProductVisualResult(taskId),
) {
  const [statusRes, resultRes] = await Promise.all([fetchStatus(), fetchResult()]);
  return { statusRes, resultRes };
}

export function MaterialManagerPage({ state, setState, setResult, onNavigate, assetGalleryOnly = false }: any) {
  const [taskId, setTaskId] = useState(() => initialProductVisualTaskId(state));
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [assets, setAssets] = useState<Record<string, any>>({});
  const [status, setStatus] = useState<any>({ status: "created", progress: 0, steps: [] });
  const [result, setLocalResult] = useState<any>(null);
  const [downloads, setDownloads] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [form, setForm] = useState({
    product_name: "连衣裙",
    target_platform: "douyin",
    core_selling_points: "云水禾,新中式,桑蚕丝,碎花,无袖连衣裙,女,春夏,中长款,收腰显瘦,日常通勤,气质女装",
    price_min: 129,
    price_max: 299,
    reference_product_url: "",
    style_direction: "抖音电商,东方雅致,日常通勤",
    main_image_count: 9,
    detail_page_count: 8,
    title_count: 6,
  });

  const canRun = canStartProductVisualGeneration(form, assets);
  const previews = result || emptyProductVisualPreview();
  const runState = status.status || "created";
  const steps = useMemo(() => status.steps?.length ? status.steps : stepLabels.map((label, index) => ({ label, status: index === 0 ? "completed" : "waiting" })), [status.steps]);

  useEffect(() => {
    let cancelled = false;
    getProductVisualRuntime().then((runtime) => {
      const snapshot = runtime?.data || runtime;
      if (cancelled || snapshot?.state === "READY") return;
      setError(`商品视觉后端未就绪：${snapshot?.error || "请检查 FastAPI Sidecar"}`);
    }).catch(() => {
      if (!cancelled) setError("商品视觉后端未就绪：请重新启动 DSH 或检查 FastAPI Sidecar。");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    loadProductVisualTaskSnapshot(taskId)
      .then(({ statusRes, resultRes }) => {
        if (cancelled) return;
        if (statusRes.status === "ok") {
          setStatus(statusRes.data || {});
          setAssets(mergeProductVisualAssets(statusRes.data?.uploaded_assets || []));
        }
        setResult(resultRes);
        const nextPreview = buildProductVisualPreviewState(null, resultRes);
        setLocalResult(nextPreview);
        if (resultRes.status === "ok") setAssets(mergeProductVisualAssets(resultRes.data?.uploaded_assets || []));
      })
      .catch(() => {
        if (!cancelled) setError("状态查询暂时失败，请检查前端服务后刷新页面。");
      });
    return () => {
      cancelled = true;
    };
  }, [assetGalleryOnly, taskId]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1600);
  }

  function payload() {
    return {
      product_name: form.product_name,
      target_platform: form.target_platform,
      core_selling_points: form.core_selling_points.split(",").map((item) => item.trim()).filter(Boolean),
      price_min: Number(form.price_min),
      price_max: Number(form.price_max),
      reference_product_url: form.reference_product_url,
      style_direction: form.style_direction.split(",").map((item) => item.trim()).filter(Boolean),
      generation_settings: {
        main_image_count: Number(form.main_image_count),
        detail_page_count: Number(form.detail_page_count),
        title_count: Number(form.title_count),
      },
    };
  }

  async function ensureTask() {
    if (taskId) return taskId;
    const res = await createProductVisualTask(payload());
    setResult(res);
    if (res.data?.task_id) {
      setTaskId(res.data.task_id);
      persistProductVisualTaskId(res.data.task_id);
      setState((s: any) => ({ ...s, productVisualTaskId: res.data.task_id, materialId: s.materialId || res.data.task_id }));
      setStatus(res.data);
      return res.data.task_id;
    }
    return "";
  }

  async function uploadAsset(assetType: string, file: File) {
    setBusy(`upload_${assetType}`);
    setError("");
    try {
      const id = await ensureTask();
      if (!id) return;
      const res = await uploadProductVisualAsset(id, assetType, file);
      setResult(res);
      if (res.status !== "ok" || !res.data?.asset_id) {
        const message = formatProductVisualUploadError(res);
        setError(message);
        showToast(message);
        return;
      }
      setAssets((current) => ({ ...current, [assetType]: res.data }));
      showToast(`${productVisualInputSlots.find((item) => item.key === assetType)?.label}已上传`);
      const statusRes = await getProductVisualStatus(id);
      if (statusRes.status === "ok") {
        setStatus(statusRes.data || {});
        setAssets(mergeProductVisualAssets(statusRes.data?.uploaded_assets || []));
      }
    } catch (uploadError) {
      const message = formatProductVisualUploadError({ message: String(uploadError) });
      setError(message);
      showToast(message);
    } finally {
      setBusy("");
    }
  }

  async function saveDraft() {
    setBusy("draft");
    const id = await ensureTask();
    if (id) {
      const res = await saveProductVisualDraft(id, payload());
      setResult(res);
      setStatus(res.data || {});
      showToast("草稿已保存");
    }
    setBusy("");
  }

  async function runTask() {
    const missingRequirements = getMissingProductVisualStartRequirements(form, assets);
    if (missingRequirements.length) {
      showToast(`请先补齐：${missingRequirements.join("、")}`);
      return;
    }
    setBusy("run");
    setError("");
    const id = await ensureTask();
    if (!id) return setBusy("");
    await saveProductVisualDraft(id, payload());
    const statusPoller = createProductVisualStatusPoller({
      fetchStatus: () => getProductVisualStatus(id),
      onStatus: (nextStatus: any) => {
        setStatus(nextStatus);
        setError((current) => current.startsWith("状态查询暂时失败") ? "" : current);
      },
      onError: (message: string) => setError(message),
    });
    await statusPoller.pollNow();
    try {
      const runRes = await runProductVisualTask(id);
      setResult(runRes);
      if (runRes.status === "ok") {
        const statusRes = await getProductVisualStatus(id);
        const resultRes = await getProductVisualResult(id);
        setStatus(statusRes.data || {});
        setLocalResult(resultRes.data || null);
        setResult(resultRes);
        showToast("生成任务已完成，等待审核");
      } else {
        const message = formatProductVisualRunError(runRes.data?.error || runRes.message);
        setError(message);
        setStatus((current: any) => ({ ...current, status: "failed" }));
        setLocalResult(emptyProductVisualPreview("generation_failed"));
        showToast("真实 API 生图失败");
      }
    } finally {
      statusPoller.stop();
      setBusy("");
    }
  }

  async function refreshPreview() {
    if (!taskId) return;
    persistProductVisualTaskId(taskId);
    const res = await getProductVisualResult(taskId);
    setResult(res);
    setLocalResult((current: any) => buildProductVisualPreviewState(current, res));
  }

  async function refreshTitles() {
    if (!taskId) {
      showToast("请先创建或加载商品图任务");
      return;
    }
    setBusy("titles");
    setError("");
    const res = await refreshProductVisualTitles(taskId);
    setResult(res);
    if (res.status === "ok") {
      setLocalResult(res.data);
      showToast("商品标题已换一批");
    } else {
      const message = res.message || (res.missing_inputs?.length ? `缺少：${res.missing_inputs.join(", ")}` : "标题刷新失败");
      setError(message);
      showToast("标题刷新失败");
    }
    setBusy("");
  }

  function showAssetGallery() {
    if (taskId) persistProductVisualTaskId(taskId);
    onNavigate?.("material-assets");
  }

  async function submitReview() {
    if (!taskId) return;
    setBusy("review");
    const res = await reviewProductVisualTask(taskId);
    setResult(res);
    setStatus((current: any) => ({ ...current, status: "pending_review", review_status: res.data?.review_status }));
    showToast("已提交审核");
    setBusy("");
  }

  async function exportContent() {
    if (!taskId) return;
    setBusy("export");
    const res = await exportProductVisualTask(taskId);
    setResult(res);
    setDownloads(res.data?.downloads || []);
    setStatus((current: any) => ({ ...current, status: "exported" }));
    showToast("测试结果已导出");
    setBusy("");
  }

  async function retryProductVisualAssetTask(assetTaskId: string) {
    if (!taskId) return;
    setBusy(`retry_${assetTaskId}`);
    const res = await retryProductVisualAsset(taskId, assetTaskId);
    if (res.status === "ok") {
      const statusRes = await getProductVisualStatus(taskId);
      setStatus(statusRes.data || {});
      const resultRes = await getProductVisualResult(taskId);
      setResult(resultRes);
      setLocalResult((current: any) => buildProductVisualPreviewState(current, resultRes));
      showToast("单项资产已局部重试");
    } else {
      showToast(res.message || "单项资产重试被阻止");
    }
    setBusy("");
  }

  if (assetGalleryOnly) {
    return <ProductAssetGalleryPage downloads={downloads} onBack={() => onNavigate?.("material")} onExport={exportContent} result={previews} taskId={taskId} />;
  }

  return (
    <div className="commerce-shell">
      <ProductTopNavigationBar />
      <div className={sidebarExpanded ? "commerce-body sidebar-expanded" : "commerce-body sidebar-collapsed"}>
        <ProductSidebarNavigation expanded={sidebarExpanded} onExpandedChange={setSidebarExpanded} onNavigate={onNavigate} />
        <main className="live-workbench product-visual-page">
          {toast ? <div className="toast">{toast}</div> : null}
          <ProductVisualPageHeader taskId={taskId} />
          <ProductVisualStepProgress steps={steps} />
          <div className="product-visual-grid">
            <div className="product-left">
              <section className="commerce-card product-material-card">
                <h3>商品资料</h3>
                <div className="product-material-grid">
                  <ProductAssetUploadCard assets={assets} busy={busy} onUpload={uploadAsset} />
                  <ProductInfoForm form={form} setForm={setForm} />
                </div>
              </section>
              <PlatformRuleScoreCard score={previews.platform_score} />
              <ClickVisualStrategyCard scores={previews.click_strategy_scores} />
              <div className="product-bottom-grid">
                <GenerationSettingCard form={form} setForm={setForm} />
                <TaskRunStatusCard assets={assets} assetTasks={status.asset_tasks} busy={busy} generationProgress={status.generation_progress} onRetry={retryProductVisualAssetTask} status={runState} />
              </div>
            </div>
            <aside className="product-right">
              {error ? <div className="provider-note">{error}</div> : null}
              <ResultPreviewPanel onRefresh={refreshPreview} onRetryReal={runTask} onShowAssets={showAssetGallery} result={previews} />
              <ProductTitleCandidatePanelConnected busy={busy} onRefresh={refreshTitles} result={previews} />
              <ExportContentPanel downloads={downloads} onExport={exportContent} />
            </aside>
          </div>
        </main>
      </div>
      <div className="commerce-bottom-bar product-bottom-actions">
        <button disabled={!canRun || Boolean(busy)} onClick={runTask} type="button">{busy === "run" ? "生成中..." : "开始生成"}</button>
        <button disabled={Boolean(busy)} onClick={saveDraft} type="button">保存草稿</button>
        <button disabled={!["pending_review", "completed"].includes(runState)} onClick={submitReview} type="button">提交审核</button>
        <button onClick={() => showToast("批量接口已预留，当前阶段不做自动上架/自动发布")} type="button">批量接口预留</button>
      </div>
    </div>
  );
}

function ProductTopNavigationBar() {
  return <header className="commerce-topbar"><div className="commerce-brand"><span>C</span><strong>电商内容与经营分析智能化系统</strong></div><button className="stage-select" type="button">第一阶段试跑</button><input className="commerce-search" placeholder="搜索功能、报表、内容等" /><div className="commerce-user"><span className="bell">12</span><strong>王小媛</strong></div></header>;
}

function ProductSidebarNavigation({ expanded, onExpandedChange, onNavigate }: any) {
  const items = [["overview", "品牌策略"], ["benchmark", "数据抓取分析"], ["material", "商品图与详情页"], ["liveclip", "直播切片分发"], ["review", "数据分析报告"]];
  return (
    <aside className={expanded ? "commerce-sidebar expanded" : "commerce-sidebar collapsed"} onMouseEnter={() => onExpandedChange?.(true)} onMouseLeave={() => onExpandedChange?.(false)}>
      <button aria-label={expanded ? "收起左侧导航" : "展开左侧导航"} className="sidebar-toggle" onClick={() => onExpandedChange?.(!expanded)} type="button"><span>{expanded ? "‹" : "›"}</span><em>{expanded ? "收起" : "展开"}</em></button>
      {items.map(([key, label]) => <button className={key === "material" ? "active" : ""} key={label} onClick={() => onNavigate?.(key)} title={label} type="button"><span>{key === "material" ? "▣" : "◎"}</span><em>{label}</em></button>)}
      <div className="autosave-card"><strong>自动保存已开启</strong><small>上次保存：今天 10:21</small></div>
      <button className="settings-entry" onClick={() => onNavigate?.("settings")} title="系统设置" type="button"><span>⚙</span><em>系统设置</em></button>
    </aside>
  );
}

function ProductVisualPageHeader({ taskId }: { taskId: string }) {
  return <div className="live-page-header"><div><h1>商品图与详情页工作台</h1><p>根据品牌资料、平铺图与模特图生成商品主图、详情页与商品标题</p></div><button className="ghost" type="button">使用指引</button>{taskId ? <span className="env-pill ok">task_id: {taskId}</span> : null}</div>;
}

function ProductVisualStepProgress({ steps }: any) {
  return <div className="product-step-progress">{steps.map((item: any, index: number) => <div className={item.status === "completed" ? "active" : ""} key={item.key || item.label}><span>{index + 1}</span><strong>{item.label}</strong></div>)}</div>;
}

function ProductAssetUploadCard({ assets, busy, onUpload }: any) {
  return (
    <div className="asset-upload-grid">
      {productVisualInputSlots.map((slot) => {
        const asset = assets[slot.key];
        const isReady = Boolean(asset?.url);
        return (
          <label className={isReady ? "asset-upload ready has-preview" : "asset-upload"} key={slot.key}>
            <input accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" type="file" onChange={(e) => e.target.files?.[0] && onUpload(slot.key, e.target.files[0])} />
            <strong>{slot.label}</strong>
            {isReady ? (
              <img alt={`${slot.label}预览`} src={`${API_BASE}${asset.url}`} title={asset.file_name || slot.label} />
            ) : (
              <span>{busy === `upload_${slot.key}` ? "上传中..." : "点击上传"}</span>
            )}
            <small>{isReady ? asset.file_name : slot.hint}</small>
          </label>
        );
      })}
    </div>
  );
}

function ProductInfoForm({ form, setForm }: any) {
  return <div className="product-info-form"><label>商品名称 *<input maxLength={60} value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} /></label><label>目标平台 *<select value={form.target_platform} onChange={(e) => setForm({ ...form, target_platform: e.target.value })}>{productVisualPlatformOptions.map((platform) => <option key={platform.value} value={platform.value}>{platform.label}</option>)}</select></label><label>核心卖点 *<textarea value={form.core_selling_points} onChange={(e) => setForm({ ...form, core_selling_points: e.target.value })} /></label><label>价格区间<div className="price-row"><input aria-label="最低价" inputMode="numeric" value={form.price_min} onChange={(e) => setForm({ ...form, price_min: e.target.value })} /><span>-</span><input aria-label="最高价" inputMode="numeric" value={form.price_max} onChange={(e) => setForm({ ...form, price_max: e.target.value })} /><em>元</em></div></label><label>对标商品<input value={form.reference_product_url} onChange={(e) => setForm({ ...form, reference_product_url: e.target.value })} /></label><label>风格方向<input value={form.style_direction} onChange={(e) => setForm({ ...form, style_direction: e.target.value })} /></label></div>;
}

function ClickVisualStrategyCard({ scores }: any) {
  const items = buildClickStrategyItems(scores);
  return <section className="commerce-card strategy-compact-card"><div className="section-head compact"><h3>首图点击策略</h3><small>按当前生成图评估</small></div><div className="strategy-grid">{items.map((item: any) => <div className="strategy-card" key={item.key}><strong>{item.score}%</strong><span>{item.label}</span><small className={item.level === "待优化" ? "warn" : ""}>{item.level}</small></div>)}</div></section>;
}

function PlatformRuleScoreCard({ score }: any) {
  const items = buildPlatformScoreItems(score?.dimensions);
  const isPending = !score || score.source === "pending";
  return <section className="commerce-card strategy-compact-card platform-score-card"><div className="section-head compact"><h3>{score?.platform_label || "目标平台"}规则评分</h3><small>{isPending ? "生成后按出图结果评估" : formatPlatformScoreSummary(score)}</small></div><div className="platform-score-total"><strong>{isPending ? "--" : `${Number(score.overall || 0)}/100`}</strong><span>{isPending ? "等待生成结果" : score.score_type === "predicted_rule_score" ? "规则预测分" : "平台实际数据"}</span></div><div className="strategy-grid">{items.map((item: any) => <div className="strategy-card" key={item.key}><strong>{item.score}</strong><span>{item.label}</span><small className={item.level === "待优化" ? "warn" : ""}>{item.level}</small></div>)}</div>{!isPending && score.asset_scores?.length ? <small className="score-evidence">已完成 {score.asset_scores.length} 张资产规则评估 · 分组评分已生成</small> : null}</section>;
}

function GenerationSettingCard({ form, setForm }: any) {
  return (
    <section className="commerce-card generation-compact-card">
      <h3>生成任务设置</h3>
      <div className="setting-options">
        <label>主图/白底<strong>9</strong><small>目标平台主图比例 / 白底 3比4</small></label>
        <label>详情页<strong>8</strong><small>移动端 9比16</small></label>
        <label>商品标题<input type="number" value={form.title_count} onChange={(e) => setForm({ ...form, title_count: e.target.value })} /><small>组</small></label>
      </div>
      <p className="agent-line">Agent：cloud_water_grain_visual_agent　Skill：cloud_water_grain_womenswear_visual　生成通道：gpt-image-2</p>
      <p className="platform-rule-line">{formatPlatformRuleNotice({ platform_label: productVisualPlatformOptions.find((item) => item.value === form.target_platform)?.label || form.target_platform, main_upload_ratio: form.target_platform === "douyin" ? "3:4" : "待核验", detail_upload_ratio: "9:16", logo_max_width_ratio: 0.1, verification_status: form.target_platform === "douyin" ? "confirmed_from_reference" : "pending_official_verification" })}</p>
      <div className="fixed-output-plan" aria-label="产出参考标准">
        {productVisualReferenceStandards.map((group) => (
          <div key={group.label}>
            <strong>{group.label} {group.spec}</strong>
            <span>{group.items.join(" / ")}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskRunStatusCard({ assets, assetTasks = [], busy, generationProgress, onRetry, status }: any) {
  const uploaded = Object.keys(assets).length;
  const progressText = formatProductVisualGenerationProgress(generationProgress);
  const retryable = assetTasks.filter((item: any) => ["failed", "repair_required", "fallback_generated"].includes(item.status));
  return <section className="commerce-card"><h3>运行状态</h3><ul className="run-status"><li>已上传 <strong>{uploaded}/4</strong></li><li>资产任务 <strong>{assetTasks.length || 17}</strong></li><li>生成中 <strong>{["running"].includes(status) ? 1 : 0}</strong></li><li>待审核 <strong>{status === "pending_review" ? 1 : 0}</strong></li><li>已完成 <strong>{status === "exported" ? 1 : 0}</strong></li></ul><p>当前状态：{progressText || statusText[status] || status}</p>{retryable.length ? <div className="asset-retry-list"><small>可局部重试：{retryable.length} 项</small>{retryable.slice(0, 3).map((item: any) => <button disabled={Boolean(busy)} key={item.asset_task_id} onClick={() => onRetry?.(item.asset_task_id)} type="button">重试 {item.asset_name}</button>)}</div> : null}</section>;
}

function ResultPreviewPanel({ onRefresh, onRetryReal, onShowAssets, result }: any) {
  const images = [...(result.main_images || []), ...(result.detail_pages || [])].slice(0, 4);
  const meta = result.generation_meta || {};
  const hasGenerated = Boolean(meta.generated_at || images.length);
  const isCommercial = hasGenerated && ["apimart", "openai", "stepfun"].includes(meta.active_provider) && !meta.fallback;
  const isFallback = hasGenerated && meta.fallback;
  const fallbackPreview = isProductVisualFallbackPreview(meta);
  const channelText = isCommercial
    ? `${meta.active_provider} ${meta.model || ""}｜真实 API 生成`
    : isFallback
      ? `本地 fallback${meta.fallback_reason ? `｜${meta.fallback_reason}` : ""}`
      : "尚未生成真实资产";
  const providerWarning = formatProductVisualProviderWarning(meta);
  return <section className="commerce-card"><div className="section-head"><h3>结果预览</h3><button className="ghost" onClick={onRefresh} type="button">刷新预览</button></div><div className={isCommercial ? "provider-note ok" : "provider-note"}>生成通道：{channelText}<br />Agent：{meta.agent || "cloud_water_grain_visual_agent"}　Skill：{meta.skill || "cloud_water_grain_womenswear_visual"}{providerWarning ? <><br />{providerWarning}</> : null}{fallbackPreview ? <div className="fallback-preview-note"><strong>当前展示的是本地模板/降级占位图，不是真实商业出图。</strong><button className="ghost" disabled={!onRetryReal} onClick={() => onRetryReal?.()} type="button">重新使用真实 API 生成</button></div> : null}</div><div className="result-preview-grid">{images.length ? images.map((item: any) => <div key={`${item.id}-${meta.generated_at || ""}`}><strong>{item.name}</strong><img alt={item.name} src={versionedAssetUrl(item.url, meta.generated_at)} /></div>) : productVisualOutputPlan.slice(0, 4).map((item) => <div className="empty-preview" key={item}><strong>{item}</strong><span>等待生成</span></div>)}</div><button className="ghost" onClick={onShowAssets} type="button">查看更多预览 / 资产</button></section>;
}

function ProductAssetGalleryPage({ downloads, onBack, onExport, result, taskId }: any) {
  const assets = result.assets || [...(result.main_images || []), ...(result.detail_pages || [])];
  const meta = result.generation_meta || {};
  return (
    <div className="commerce-shell">
      <ProductTopNavigationBar />
      <div className="commerce-body">
        <ProductSidebarNavigation expanded={false} onNavigate={(view: string) => view === "material" ? onBack() : null} />
        <main className="live-workbench product-assets-page">
          <div className="live-page-header">
            <div>
              <h1>生成资产总览</h1>
              <p>当前任务按固定顺序管理 6 张主图、3 张白底图和 8 屏详情页。</p>
            </div>
            <button className="ghost" onClick={onBack} type="button">返回工作台</button>
            {taskId ? <span className="env-pill ok">task_id: {taskId}</span> : null}
          </div>
          <section className="commerce-card">
            <div className="section-head">
              <h3>资产生成通道</h3>
              <button onClick={onExport} type="button">导出资产包</button>
            </div>
            <div className={meta.fallback ? "provider-note" : "provider-note ok"}>
              {meta.fallback ? `本地 fallback｜${meta.fallback_reason || ""}` : `${meta.active_provider || "apimart"} ${meta.model || "gpt-image-2"}｜真实 API 生成`}
              <br />Agent：{meta.agent || "cloud_water_grain_visual_agent"}　Skill：{meta.skill || "cloud_water_grain_womenswear_visual"}
            </div>
            <div className="asset-gallery-grid">
              {assets.length ? assets.map((item: any) => (
                <article key={`${item.id}-${meta.generated_at || ""}`}>
                  <img alt={item.name} src={versionedAssetUrl(item.url, meta.generated_at)} />
                  <strong>{item.name}</strong>
                  <span>{item.category || "资产"} / {item.asset_type || item.id}</span>
                  <a href={versionedAssetUrl(item.url, meta.generated_at)} target="_blank">打开原图</a>
                </article>
              )) : <div className="empty-preview"><strong>暂无资产</strong><span>请先返回工作台生成</span></div>}
            </div>
            {downloads.length ? <ul className="asset-downloads">{downloads.map((item: any) => <li key={item.type}><a href={`${API_BASE}${item.url}`} target="_blank">{item.name}</a></li>)}</ul> : null}
          </section>
        </main>
      </div>
    </div>
  );
}

function ProductTitleCandidatePanelConnected({ busy, onRefresh, result }: any) {
  async function copyTitle(item: string) {
    await navigator.clipboard?.writeText(item);
  }

  return (
    <section className="commerce-card">
      <div className="section-head">
        <h3>商品标题候选</h3>
        <button className="ghost" disabled={busy === "titles"} onClick={onRefresh} type="button">
          {busy === "titles" ? "生成中..." : "换一批"}
        </button>
      </div>
      <ol className="title-candidates">
        {(result.title_candidates || []).map((item: string, index: number) => (
          <li key={`${item}-${index}`}>
            <span>{index + 1}</span>
            {item}
            <button className="ghost" onClick={() => copyTitle(item)} type="button">复制</button>
          </li>
        ))}
      </ol>
      {result.title_refresh_meta ? <p className="agent-meta">Agent: {result.title_refresh_meta.agent} Skill: {result.title_refresh_meta.skill}</p> : null}
    </section>
  );
}

function ProductTitleCandidatePanel({ result }: any) {
  return <section className="commerce-card"><div className="section-head"><h3>商品标题候选</h3><button className="ghost" type="button">换一批</button></div><ol className="title-candidates">{(result.title_candidates || []).map((item: string, index: number) => <li key={`${item}-${index}`}><span>{index + 1}</span>{item}<button className="ghost" type="button">复制</button></li>)}</ol></section>;
}

function ExportContentPanel({ downloads, onExport }: any) {
  return <section className="commerce-card export-content"><h3>导出内容</h3><div><button onClick={onExport} type="button">图片包<br /><small>ZIP 格式</small></button><button onClick={onExport} type="button">文案包<br /><small>TXT/WORD</small></button><button onClick={onExport} type="button">JSON字段<br /><small>结构化数据</small></button></div>{downloads.length ? <ul>{downloads.map((item) => <li key={item.type}><a href={`${API_BASE}${item.url}`} target="_blank">{item.name}</a></li>)}</ul> : null}</section>;
}
