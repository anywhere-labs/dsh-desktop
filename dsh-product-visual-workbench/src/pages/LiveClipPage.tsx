import { useEffect, useMemo, useRef, useState } from "react";
import {
  activateLiveClipVariant,
  approveLiveClipJob,
  checkFfmpeg,
  createLiveClipTask,
  createLiveClipDeliveryPackage,
  exportLiveClipTask,
  getLiveClipDeliveryPackageDownloadUrl,
  getLiveClipSourceThumbnailUrl,
  getLiveClipResult,
  getLiveClipStatus,
  getLiveClipTemplates,
  reviewLiveClipTask,
  runLiveClipTask,
  uploadLiveClipTaskSubtitle,
  uploadLiveClipTaskVideo,
  uploadLiveClipCustomerVideo,
  startLiveClipCustomerTask,
  getLiveClipCustomerStatus,
  getLiveClipCustomerResult,
  getLiveClipCustomerSubtitle,
  getLiveClipCustomerCopywriting,
  getLiveClipCustomerQa,
  getLiveClipCustomerRepairSummary,
  repairLiveClipCustomerIssue,
  restoreLiveClipCustomerPrevious,
  activateLiveClipCustomerVersion,
  approveLiveClipCustomerTask,
  exportLiveClipCustomerPackage,
  preflightLiveClipCustomerVideo,
} from "../api/client";
import { TranscriptWorkspace } from "../components/TranscriptWorkspace";
import { BatchStageProgress } from "../components/BatchStageProgress";
import { LiveClipVariantComparePanel } from "../components/LiveClipVariantComparePanel";
import { TemplateRegistryPanel } from "../components/TemplateRegistryPanel";

const platforms = ["抖音", "快手", "视频号", "小红书"];
const platformValueMap: Record<string, string> = {
  "抖音": "douyin",
  "快手": "kuaishou",
  "视频号": "wechat_video",
  "小红书": "xiaohongshu",
};
const steps = ["视频上传", "自动识别", "切片评分", "成片输出"];
const processSteps = ["转写字幕", "镜头识别", "爆点提取", "切片推荐", "成片输出"];
export const LIVE_CLIP_VIDEO_ACCEPT = ".mp4,.mov,.flv,.ts,video/mp4,video/quicktime,video/x-flv,video/mp2t";
export const DEFAULT_LIVE_CLIP_CAPTION_STYLE = "douyin_apparel_detail_conversion_v1";
export const LIVE_CLIP_TEMPLATE_ITEMS = [
  {
    id: "douyin_apparel_detail_conversion_v1",
    name: "抖音女装细节转化 V1",
    version: "1.2.0",
    description: "细节先行的女装高转化包装模板。",
    duration_range: [30, 45],
    overlay_count_range: [4, 6],
    sfx_count_range: [3, 5],
    hook_within_seconds: 3,
    benefit_conclusion_required: true,
  },
  {
    id: "douyin_apparel_fabric_detail_v1",
    name: "抖音女装面料细节 V1",
    version: "1.2.0",
    description: "强调面料质感和细节卖点的包装模板。",
    duration_range: [25, 40],
    overlay_count_range: [4, 6],
    sfx_count_range: [2, 4],
    hook_within_seconds: 3,
    benefit_conclusion_required: true,
  },
  {
    id: "douyin_apparel_compare_review_v1",
    name: "抖音女装对比测评 V1",
    version: "1.2.0",
    description: "适合对比款式、版型和上身差异的测评模板。",
    duration_range: [35, 50],
    overlay_count_range: [5, 7],
    sfx_count_range: [3, 5],
    hook_within_seconds: 3,
    benefit_conclusion_required: true,
  },
  {
    id: "douyin_live_conversion_clip_v1",
    name: "抖音直播转化切片 V1",
    version: "1.2.0",
    description: "适合直播转单、利益点和行动指令明确的转化模板。",
    duration_range: [35, 55],
    overlay_count_range: [3, 5],
    sfx_count_range: [2, 4],
    hook_within_seconds: 3,
    benefit_conclusion_required: true,
  },
];
export const LIVE_CLIP_CAPTION_STYLE_OPTIONS = LIVE_CLIP_TEMPLATE_ITEMS.map((item) => ({
  value: item.id,
  label: item.name,
}));
const LIVE_CLIP_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".flv", ".ts"]);
const LIVE_CLIP_MAX_VIDEO_BYTES = 10 * 1024 * 1024 * 1024;
export const LIVE_CLIP_PREVIEW_LIMIT = 10;
const exportFormats = [
  { label: "MP4", type: "final_clips_zip" },
  { label: "MOV", type: "final_clips_zip" },
  { label: "字幕SRT", type: "srt_zip" },
  { label: "时间线文件", type: "exchange_package_zip" },
  { label: "剪映交换包/复建包", type: "jianying_project_zip" },
];

const jianyingChecks = ["jianying_project_exists", "jianying_manifest_exists", "jianying_timeline_exists", "jianying_zip_exists"];
const liveClipMojibakePatterns = [
  /璋冪敤/,
  /璇峰厛/,
  /鍏堜慨/,
  /涓婁紶/,
  /鐪熷疄/,
  /妫€鏌/,
  /鎵ц/,
  /澶辫触/,
  /鏈/,
  /鍒囩墖/,
  /闃舵/,
  /鏃堕棿杞/,
];
const liveClipMissingInputLabels: Record<string, string> = {
  video: "视频素材",
  real_rendered_mp4: "真实成片 MP4",
  speech_transcription_provider: "真实字幕/SRT",
  qa_pass: "QA 通过",
  batch_resume: "继续执行",
  batch_retry: "任务重试",
  task_id: "任务 ID",
  slice_segments: "切片结果",
  valid_clip_plans: "有效切片规划",
};
const liveClipNextActionFallbacks: Record<string, string> = {
  video: "请先上传直播视频素材。",
  real_rendered_mp4: "请检查 FFmpeg 与真实成片渲染状态。",
  speech_transcription_provider: "请补齐真实字幕或上传 SRT 后再继续。",
  qa_pass: "请先修复 QA 未通过项，再重新导出成片。",
  batch_resume: "请点击继续恢复任务。",
  batch_retry: "请先重试当前任务。",
  task_id: "请先创建或选择一个直播切片任务。",
  slice_segments: "请先生成切片结果。",
};
const liveClipQaCheckLabels: Record<string, string> = {
  video_playable: "视频可播放",
  duration_under_60s: "时长不超过 60 秒",
  has_hook_first_3s: "前 3 秒有 Hook",
  subtitle_readable: "字幕可读",
  audio_present: "音频存在",
  no_black_screen: "无黑屏",
  subject_visible: "主体清晰可见",
  aspect_ratio_correct: "画幅比例正确",
  title_under_40_chars: "标题不超过 40 字",
  has_cta: "含行动引导",
  keyword_in_title_or_caption: "标题或文案含关键词",
  final_video_exists: "最终视频已生成",
  srt_exists: "字幕文件已生成",
  cover_exists: "封面已生成",
  clip_report_exists: "切片报告已生成",
  trace_exists: "执行链路已生成",
  jianying_project_exists: "剪映交换目录已生成",
  jianying_manifest_exists: "剪映 manifest 已生成",
  jianying_timeline_exists: "剪映时间线已生成",
  jianying_zip_exists: "剪映交换包/复建包已生成",
};
const liveClipStatusLabels: Record<string, string> = {
  idle: "待开始",
  waiting: "等待中",
  processing: "处理中",
  running: "运行中",
  ok: "正常",
  blocked: "阻塞",
  partial: "部分完成",
  failed: "失败",
  passed: "通过",
  draft: "草稿",
  approved: "已通过",
  pending_review: "待审核",
  not_submitted: "未提交",
};

export function isLikelyLiveClipMojibake(value: unknown) {
  return typeof value === "string" && liveClipMojibakePatterns.some((pattern) => pattern.test(value));
}

export function sanitizeLiveClipText(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return isLikelyLiveClipMojibake(trimmed) ? fallback : trimmed;
}

export function formatLiveClipMissingInput(key: string) {
  return liveClipMissingInputLabels[key] || key;
}

export function formatLiveClipQaCheckLabel(key: string) {
  return liveClipQaCheckLabels[key] || key;
}

export function formatLiveClipQaCheckValue(value: unknown) {
  return value ? "通过" : "未通过";
}

export function formatLiveClipStatus(status: unknown, fallback = "-") {
  if (typeof status !== "string" || !status) return fallback;
  return liveClipStatusLabels[status] || status;
}

export function formatLiveClipLogMessage(item: any) {
  if (item?.agent_name === "LiveClipTranscriptAgent" && item?.status === "blocked") {
    return "真实语音转写不可用。";
  }
  const fallback = item?.status === "ok" ? "调用完成。" : "调用未完成或被阻塞。";
  const cleanMessage = sanitizeLiveClipText(item?.message, "");
  if (cleanMessage) return cleanMessage;
  const cleanProvider = sanitizeLiveClipText(item?.provider, "");
  if (!item?.agent_name && cleanProvider) return cleanProvider;
  return fallback;
}

function isStartedLiveClipStatus(status: unknown) {
  return ["running", "processing", "completed", "ok", "blocked", "failed", "partial", "passed"].includes(String(status || "").toLowerCase());
}

export function deriveLiveClipActiveStep(result: any, state: any) {
  if (result?.slice_segments?.length) return 4;
  const progressSteps = Array.isArray(result?.progress_steps) ? result.progress_steps : [];
  if (progressSteps.length) {
    const stageGroups = [
      ["LiveClipTranscriptAgent"],
      ["LiveClipShotDetectAgent", "LiveClipHotspotAgent"],
      ["LiveClipSegmentPlannerAgent.select"],
      ["LiveClipRenderSkill.basic_ffmpeg"],
    ];
    for (let index = stageGroups.length - 1; index >= 0; index -= 1) {
      const group = stageGroups[index];
      if (group.some((key) => progressSteps.some((item: any) => item?.key === key && isStartedLiveClipStatus(item?.status)))) {
        return index + 1;
      }
    }
  }
  if (state.liveClipTaskId) return 1;
  if (state.liveClipMaterialId) return 1;
  return 0;
}

export function shouldHideLiveClipCompletedResults(result: any, response: any) {
  const batchStatus = String(
    result?.batch_state?.status
    || response?.live_clip_status?.batch_state?.status
    || response?.data?.batch_state?.status
    || "",
  ).toLowerCase();
  const taskStatus = String(response?.status || result?.status || "").toLowerCase();
  const activeBatchStatuses = ["queued", "running", "pausing", "paused"];
  if (!activeBatchStatuses.includes(batchStatus) || taskStatus !== "running") return false;
  return Boolean(
    (result?.slice_segments || []).length
    || result?.qa_result
    || result?.has_real_render
    || (result?.logs?.agent_logs || []).length
    || (result?.logs?.skill_logs || []).length,
  );
}

export function getVisibleLiveClipSegments(result: any, response: any) {
  return shouldHideLiveClipCompletedResults(result, response)
    ? []
    : (result?.slice_segments?.length ? result.slice_segments : []);
}

export function getVisibleLiveClipSelectedClip(result: any, response: any, selectedId = "") {
  const clips = getVisibleLiveClipSegments(result, response);
  return clips.find((item: any) => item?.clip_id === selectedId) || clips[0];
}

export function shouldDisableLiveClipExports(result: any, response: any) {
  return shouldHideLiveClipCompletedResults(result, response);
}

export function getLiveClipBottomBarState({
  activeStep = 0,
  busy,
  canExportFinal,
  qaPassed,
  qaRetryRequired,
  rerunActive,
}: any) {
  return {
    startLabel: busy === "run" || rerunActive ? "切片中..." : activeStep >= 4 ? "重新切片" : "开始切片",
    startDisabled: Boolean(busy) || Boolean(rerunActive),
    refreshDisabled: false,
    reviewDisabled: Boolean(rerunActive) || activeStep < 4 || !qaPassed,
    retryDisabled: Boolean(rerunActive) || Boolean(busy) || !qaRetryRequired,
    approveDisabled: Boolean(rerunActive) || activeStep < 4 || !qaPassed,
    exportDisabled: Boolean(rerunActive) || !canExportFinal,
  };
}

function formatLiveClipWarning(item: any) {
  const clean = sanitizeLiveClipText(item, "");
  if (!clean) return "";
  if (clean.includes("Real speech transcription failed:")) {
    return clean
      .replace("Real speech transcription failed:", "真实语音转写失败：")
      .replace("No module named 'soundfile'", "缺少 soundfile 依赖")
      .replace("No module named 'funasr'", "缺少 funasr 依赖")
      .replace("No module named 'faster_whisper'", "缺少 faster-whisper 依赖")
      .replace("No module named 'ctranslate2'", "缺少 ctranslate2 依赖");
  }
  return clean;
}

export function formatLiveClipWarnings(items: any[] = []) {
  return items.map(formatLiveClipWarning).filter(Boolean);
}

export function getLiveClipUploadFailureMessage(response: any, fallback = "视频上传失败，请检查网络后重试。") {
  const warnings = formatLiveClipWarnings(
    Array.isArray(response?.warnings)
      ? response.warnings
      : Array.isArray(response?.data?.warnings)
        ? response.data.warnings
        : [],
  );
  if (warnings[0]) return warnings[0];
  const message = sanitizeLiveClipText(response?.message, "");
  if (message) return message;
  return fallback;
}

export function formatLiveClipNextActions(items: any[] = [], missingInputs: string[] = []) {
  const normalized: string[] = [];
  items.forEach((item) => {
    const clean = sanitizeLiveClipText(item, "");
    if (clean && !normalized.includes(clean)) normalized.push(clean);
  });
  missingInputs.forEach((key) => {
    const fallback = liveClipNextActionFallbacks[key];
    if (fallback && !normalized.includes(fallback)) normalized.push(fallback);
  });
  return normalized;
}

function toLiveClipTextItems(value: unknown) {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value.trim() ? [value] : [];
}

function isInternalLiveClipBlockedMessage(value: unknown) {
  const text = String(value || "");
  return text.includes("missing_inputs") || text.includes("请按 missing_inputs 补齐");
}

export function normalizeCustomerQaResponse(response: any) {
  const missingInputs = Array.isArray(response?.missing_inputs) ? response.missing_inputs : [];
  const safeActions = toLiveClipTextItems(response?.next_action)
    .filter((item) => !isInternalLiveClipBlockedMessage(item));
  const nextAction = formatLiveClipNextActions(safeActions, missingInputs);
  const safeSummary = toLiveClipTextItems(response?.summary)
    .map((item) => sanitizeLiveClipText(item, ""))
    .filter((item) => item && !isInternalLiveClipBlockedMessage(item));
  return {
    status: response?.status || "",
    summary: safeSummary.length ? safeSummary : nextAction,
    issues: Array.isArray(response?.issues) ? response.issues : [],
    review_status: response?.review_status || "not_submitted",
    missing_inputs: missingInputs,
    next_action: nextAction,
  };
}

function formatLiveClipFailureReason(qa: any) {
  const clean = sanitizeLiveClipText(qa?.qa_failure_reason, "");
  if (clean) return clean;
  const firstFailed = qa?.qa_failed_items?.[0];
  return firstFailed ? `${formatLiveClipQaCheckLabel(firstFailed)}未通过` : "-";
}

function getQaResult(result: any, clips: any[] = []) {
  if (result?.qa_result) return result.qa_result;
  if (clips.length) {
    const checks: Record<string, boolean> = {};
    clips.forEach((clip: any) => {
      Object.entries(clip.qa_checks || clip.qa?.qa_checks || {}).forEach(([key, value]) => {
        checks[key] = key in checks ? checks[key] && Boolean(value) : Boolean(value);
      });
    });
    const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
    return {
      qa_status: failed.length ? "failed" : "passed",
      qa_score: Object.keys(checks).length ? Math.round(((Object.keys(checks).length - failed.length) / Object.keys(checks).length) * 100) : 0,
      qa_pass: failed.length === 0,
      qa_checks: checks,
      qa_failed_items: failed,
      qa_warnings: clips.flatMap((clip: any) => clip.qa_warnings || clip.qa?.qa_warnings || []),
      qa_retry_required: failed.length > 0,
      qa_failure_owner_agent: clips.find((clip: any) => clip.qa_failure_owner_agent)?.qa_failure_owner_agent || "",
      qa_failure_owner_skill: clips.find((clip: any) => clip.qa_failure_owner_skill)?.qa_failure_owner_skill || "",
      qa_failure_reason: failed[0] ? `${formatLiveClipQaCheckLabel(failed[0])}未通过` : "",
    };
  }
  return null;
}

export function canExportFinalByQa(qa: any) {
  const checks = qa?.qa_checks || {};
  return Boolean(checks.final_video_exists && qa?.qa_status === "passed");
}

function canExportJianyingByQa(qa: any) {
  const checks = qa?.qa_checks || {};
  return jianyingChecks.every((key) => checks[key]);
}

function apiPath(path?: string) {
  return path ? `/${path}` : "";
}

function previewPath(clip: any) {
  if (clip?.render?.download_url) return clip.render.download_url;
  if (!clip?.files?.final_clip) return "";
  return `/api/live-clips/clips/${clip.clip_id}/preview`;
}

function normalizeLiveClipResponse(response: any) {
  if (!response) return response;
  const direct = response.data || {};
  const legacyResult = direct.result || {};
  const legacyTask = direct.task || {};
  const payload = legacyResult.slice_segments?.length || legacyResult.task_id ? legacyResult : direct;
  const mergedData = {
    ...payload,
    status: payload.status || response.status || legacyTask.status,
    task_id: payload.task_id || legacyTask.task_id,
    project_id: payload.project_id || legacyTask.account_id,
    review_status: payload.review_status || legacyTask.review_status,
    missing_inputs: payload.missing_inputs || response.missing_inputs || [],
    warnings: payload.warnings || response.warnings || [],
    next_action: payload.next_action || response.next_action || [],
    causal_traces: direct.causal_traces || payload.causal_traces,
  };
  const missingInputs = mergedData.missing_inputs || [];
  const warnings = formatLiveClipWarnings(mergedData.warnings || []);
  const nextAction = formatLiveClipNextActions(mergedData.next_action || [], missingInputs);
  const logs = mergedData.logs ? {
    ...mergedData.logs,
    agent_logs: (mergedData.logs.agent_logs || []).map((item: any) => ({
      ...item,
      message: formatLiveClipLogMessage(item),
    })),
    skill_logs: (mergedData.logs.skill_logs || []).map((item: any) => ({
      ...item,
      next_action: formatLiveClipNextActions(item.next_action || [], item.missing_inputs || []),
    })),
  } : mergedData.logs;
  return {
    ...response,
    status: response.status || mergedData.status,
    data: {
      ...mergedData,
      warnings,
      next_action: nextAction,
      logs,
    },
    missing_inputs: response.missing_inputs || missingInputs || [],
    warnings,
    next_action: nextAction,
  };
}

export function isMissingLiveClipTask(response: any) {
  const missingInputs = response?.missing_inputs || response?.data?.missing_inputs || [];
  return missingInputs.includes("task_id");
}

export function clearInvalidLiveClipTask(setState: any, browser: any = window) {
  browser.localStorage.removeItem("liveClipTaskId");
  const url = new URL(browser.location.href);
  url.searchParams.delete("taskId");
  browser.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  setState((current: any) => ({ ...current, liveClipTaskId: "" }));
}

export function shouldMountTranscriptWorkspace(taskId: unknown) {
  return typeof taskId === "string" && taskId.length > 0;
}

export function validateLiveClipVideoFile(file: Pick<File, "name" | "size">) {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!LIVE_CLIP_VIDEO_EXTENSIONS.has(extension)) {
    return { valid: false, message: "仅支持 MP4、MOV、FLV 或 TS 视频。" };
  }
  if (file.size > LIVE_CLIP_MAX_VIDEO_BYTES) {
    return { valid: false, message: "视频文件不能超过 10GB。" };
  }
  return { valid: true, message: "" };
}

type ObjectUrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

export function releaseLiveClipObjectUrl(current: string, urlApi: ObjectUrlApi = URL) {
  if (current.startsWith("blob:")) urlApi.revokeObjectURL(current);
}

export function replaceLiveClipObjectUrl(current: string, file: Blob, urlApi: ObjectUrlApi = URL) {
  releaseLiveClipObjectUrl(current, urlApi);
  return urlApi.createObjectURL(file);
}

export async function withLiveClipUploadBusy<T>(
  setBusy: (state: string) => void,
  operation: () => Promise<T>,
) {
  setBusy("upload");
  try {
    return await operation();
  } finally {
    setBusy("");
  }
}

type CustomerClip = {
  clip_id: string;
  url: string;
  duration: number;
  title: string;
  subtitle: string;
  qa_status: "passed" | "failed";
  selection_reason?: string;
  selling_points?: string[];
  evidence?: Array<{ claim: string; text: string; time_range: { start?: number; end?: number } }>;
};

type CustomerPreflight = {
  status: string;
  message?: string;
  next_action?: string;
  warnings?: string[];
  checks?: Record<string, any>;
};

type LiveClipLang = "zh" | "en";

export const liveClipI18n = {
  zh: {
    eyebrow: "LiveClip OS",
    heroTitle: "把直播长视频生成可交付短视频",
    heroDesc: "上传商品讲解或直播口播视频，生成短视频、字幕、标题文案、质检摘要和交付包。",
    chooseVideo: "请先选择视频。",
    uploadFailed: "上传失败。",
    generationFailed: "生成失败，请更换视频后重试。",
    resultsReady: "结果已生成，可以查看和下载。",
    generationStarted: "已开始生成，正在等待结果。",
    generationAlreadyRunning: "当前任务正在生成，请等待本轮结果完成。",
    packageReady: "交付包已准备好。",
    packageUnavailable: "交付包暂不可用，请确认结果已通过。",
    approveReady: "结果已确认，可以下载交付包。",
    approveFailed: "当前结果暂不能确认，请先处理提示问题。",
    selectedClipFallback: "选择一条短视频查看详情",
    generate: "▶ 生成视频",
    generating: "生成中...",
    uploadVideo: "上传视频",
    uploadHint: "拖拽或点击上传清晰的商品口播视频",
    readyToGenerate: "已选择，可开始生成",
    titlePlaceholder: "直播主题",
    productPlaceholder: "主推商品",
    directionPlaceholder: "内容方向",
    sourceSubtitleLabel: "原视频已经带字幕",
    sourceSubtitleHint: "开启后保留原字幕，不再叠加第二层系统字幕。",
    resultsEyebrow: "结果",
    generatedClips: "生成的短视频",
    previewCount: "已生成 {count} / 10 条预览",
    emptyResults: "视频结果会显示在这里。",
    selectedClip: "当前短视频",
    details: "查看详情",
    download: "下载",
    copyTitle: "复制标题",
    subtitlesReady: "字幕已生成",
    noSubtitles: "暂无字幕",
    qualityPassed: "质检通过",
    needsReview: "需要复查",
    subtitles: "字幕",
    selectClipSubtitle: "选择短视频后查看字幕。",
    noSubtitleYet: "暂无字幕",
    downloadSrt: "下载 SRT",
    titlesCopy: "标题文案",
    noCaptionYet: "暂无文案",
    copyCaption: "复制文案",
    refreshTitles: "换一批标题",
    quality: "质检",
    readyToDeliver: "可以交付",
    needsAnotherPass: "需要重新处理",
    reviewRequired: "需要复查",
    delivery: "交付",
    deliveryTitle: "下载完整交付包",
    deliveryDesc: "包含成片视频、字幕、标题文案和交付摘要。",
    confirmResult: "确认结果可用",
    confirming: "确认中...",
    downloadAllZip: "下载全部 ZIP",
    openZip: "打开 ZIP",
    downloadSubtitles: "下载字幕",
    statusUploadBegin: "上传视频后开始",
    statusUploading: "正在上传视频",
    statusPreparing: "正在准备结果",
    statusCaptions: "正在生成字幕",
    statusClips: "正在生成短视频",
    statusReady: "可下载",
    statusAttention: "生成需要处理",
    pollFailed: "暂时无法获取任务进度，请检查服务后点击刷新。",
    preflightRunning: "正在检查视频是否适合生成",
    preflightPassed: "视频预检通过",
    preflightFailed: "视频预检未通过",
    preflightAudio: "音轨",
    preflightVoice: "人声",
    preflightDuration: "时长",
    preflightResolution: "分辨率",
    selectionReason: "入选理由",
    sellingPointEvidence: "卖点与口播证据",
    noEvidence: "当前没有可展示的卖点证据。",
    localRetry: "按质检建议局部重做",
    retrying: "局部重做中...",
    issueTime: "问题位置",
    versionHistory: "修改版本",
    restorePrevious: "恢复上一版本",
    restoring: "恢复中...",
    currentVersion: "当前版本",
    videoVersions: "成片版本",
    currentMainVersion: "当前主版本",
    setMainVersion: "设为主版本",
  },
  en: {
    eyebrow: "LiveClip OS",
    heroTitle: "Generate polished short videos from livestream footage.",
    heroDesc: "Upload a product talk video. Get preview clips, captions, titles, quality summary, and a ready-to-share delivery package.",
    chooseVideo: "Choose a video first.",
    uploadFailed: "Upload failed.",
    generationFailed: "Generation failed. Try another video.",
    resultsReady: "Results are ready for review and download.",
    generationStarted: "Generation started. Waiting for results.",
    generationAlreadyRunning: "This task is already generating. Please wait for the current run.",
    packageReady: "Delivery package is ready.",
    packageUnavailable: "Delivery package is not available yet.",
    approveReady: "Results confirmed. You can download the delivery package.",
    approveFailed: "Results cannot be confirmed yet. Follow the next action first.",
    selectedClipFallback: "Select a clip to inspect details",
    generate: "▶ Generate Video",
    generating: "Generating...",
    uploadVideo: "Upload Video",
    uploadHint: "Drag and drop a clear product talk video",
    readyToGenerate: "ready to generate",
    titlePlaceholder: "Live topic",
    productPlaceholder: "Main product",
    directionPlaceholder: "Content direction",
    sourceSubtitleLabel: "The source video already has captions",
    sourceSubtitleHint: "Keep the original captions and do not burn a second caption layer.",
    resultsEyebrow: "Results",
    generatedClips: "Generated Clips",
    previewCount: "{count} / 10 previews generated",
    emptyResults: "Your video results will appear here.",
    selectedClip: "Selected clip",
    details: "View details",
    download: "Download",
    copyTitle: "Copy title",
    subtitlesReady: "Subtitles ready",
    noSubtitles: "No subtitles",
    qualityPassed: "Quality passed",
    needsReview: "Needs review",
    subtitles: "Subtitles",
    selectClipSubtitle: "Select a clip to view subtitles.",
    noSubtitleYet: "No subtitles yet",
    downloadSrt: "Download SRT",
    titlesCopy: "Titles & Copy",
    noCaptionYet: "No caption yet",
    copyCaption: "Copy caption",
    refreshTitles: "Refresh titles",
    quality: "Quality",
    readyToDeliver: "Ready to deliver",
    needsAnotherPass: "Needs another pass",
    reviewRequired: "Review required",
    delivery: "Delivery",
    deliveryTitle: "Download everything in one package.",
    deliveryDesc: "Includes final videos, subtitles, title copy, and delivery summary.",
    confirmResult: "Confirm Results",
    confirming: "Confirming...",
    downloadAllZip: "Download All ZIP",
    openZip: "Open ZIP",
    downloadSubtitles: "Download Subtitles",
    statusUploadBegin: "Upload a video to begin",
    statusUploading: "Uploading video",
    statusPreparing: "Preparing results",
    statusCaptions: "Preparing captions",
    statusClips: "Generating clips",
    statusReady: "Ready for download",
    statusAttention: "Generation needs attention",
    pollFailed: "Task progress is temporarily unavailable. Check the service and refresh.",
    preflightRunning: "Checking video readiness",
    preflightPassed: "Video preflight passed",
    preflightFailed: "Video preflight failed",
    preflightAudio: "Audio",
    preflightVoice: "Voice",
    preflightDuration: "Duration",
    preflightResolution: "Resolution",
    selectionReason: "Why this clip was selected",
    sellingPointEvidence: "Selling points and evidence",
    noEvidence: "No customer-facing evidence is available yet.",
    localRetry: "Redo this issue only",
    retrying: "Redoing...",
    issueTime: "Issue location",
    versionHistory: "Versions",
    restorePrevious: "Restore previous version",
    restoring: "Restoring...",
    currentVersion: "Current version",
    videoVersions: "Video versions",
    currentMainVersion: "Current main version",
    setMainVersion: "Set as main version",
  },
};

export function getCustomerDeliveryState({ taskId, clipCount, qaStatus, confirmed, busy, packageReady }: any) {
  const idle = !busy;
  const ready = Boolean(taskId) && Number(clipCount || 0) > 0 && qaStatus === "passed";
  return {
    canApprove: idle && ready && !confirmed,
    canExport: idle && ready && Boolean(confirmed),
    canDownload: Boolean(packageReady),
  };
}

const LIVE_CLIP_RUNNING_STATUSES = new Set(["queued", "processing", "running", "pausing", "paused"]);

export function shortLiveClipTaskId(taskId: unknown) {
  const value = typeof taskId === "string" ? taskId.trim() : "";
  return value ? value.slice(0, 8) : "";
}

export function shouldBlockLiveClipGeneration({ busy, batchStatus }: { busy?: string; batchStatus?: string }) {
  return busy === "generate" || LIVE_CLIP_RUNNING_STATUSES.has(String(batchStatus || "").toLowerCase());
}

export function shouldShowLiveClipResults(status: unknown, clipCount: unknown) {
  return String(status || "").toLowerCase() === "completed" && Number(clipCount || 0) > 0;
}

export function getLiveClipGenerationMessage({
  status,
  clipCount,
  startedStatus,
  t,
}: {
  status?: string;
  clipCount?: number;
  startedStatus?: string;
  t: { resultsReady: string; generationStarted: string };
}) {
  if (shouldShowLiveClipResults(status, clipCount)) return t.resultsReady;
  if (String(startedStatus || "").toLowerCase() === "processing" || String(status || "").toLowerCase() === "processing") {
    return t.generationStarted;
  }
  return "";
}

function formatCustomerTime(value: number) {
  const seconds = Math.max(0, Math.round(Number(value || 0)));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function LiveClipCustomerPage() {
  const [lang, setLang] = useState<LiveClipLang>("zh");
  const t = liveClipI18n[lang];
  const [taskId, setTaskId] = useState(() => initialLiveClipTaskId());
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: "",
    product: "",
    direction: "",
    platform: "抖音",
    sourceHasBurnedSubtitles: false,
  });
  const [status, setStatus] = useState(t.statusUploadBegin);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(t.statusUploadBegin);
  const [clips, setClips] = useState<CustomerClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<CustomerClip | null>(null);
  const [subtitle, setSubtitle] = useState({ srt: "", ass: "" });
  const [copywriting, setCopywriting] = useState({ titles: [] as string[], caption: "", tags: [] as string[] });
  const [qa, setQa] = useState<any>({ status: "", summary: [] as string[], issues: [] });
  const [repairSummary, setRepairSummary] = useState<any>({ current_version: 1, versions: [], can_restore_previous: false });
  const [planVersions, setPlanVersions] = useState<any[]>([]);
  const [exportData, setExportData] = useState<any>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [preflight, setPreflight] = useState<CustomerPreflight | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [batchStatus, setBatchStatus] = useState("");
  const previousTaskIdRef = useRef(taskId);
  const taskScopeRef = useRef(taskId);

  function clearCustomerTaskState() {
    setMessage("");
    setClips([]);
    setSelectedClip(null);
    setSubtitle({ srt: "", ass: "" });
    setCopywriting({ titles: [], caption: "", tags: [] });
    setQa({ status: "", summary: [], issues: [] });
    setRepairSummary({ current_version: 1, versions: [], can_restore_previous: false });
    setPlanVersions([]);
    setExportData(null);
    setReviewConfirmed(false);
    setProgress(0);
    setBatchStatus("");
  }

  taskScopeRef.current = taskId;

  useEffect(() => {
    if (previousTaskIdRef.current !== taskId) clearCustomerTaskState();
    previousTaskIdRef.current = taskId;
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: number | undefined;
    let transportFailures = 0;

    async function pollTask() {
      try {
        const snapshot = await refreshAll(taskId);
        transportFailures = 0;
        if (!cancelled && shouldShowLiveClipResults(snapshot?.status, snapshot?.clipCount)) {
          setMessage(t.resultsReady);
        }
        if (!cancelled && shouldPollLiveClipCustomerTask(snapshot?.status)) {
          timer = window.setTimeout(pollTask, 3000);
        }
      } catch {
        transportFailures += 1;
        if (cancelled) return;
        setStatus(t.statusAttention);
        setStep(t.statusAttention);
        if (shouldRetryLiveClipCustomerPoll(transportFailures)) {
          timer = window.setTimeout(pollTask, 3000);
        } else {
          setMessage(t.pollFailed);
        }
      }
    }

    pollTask();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [taskId, lang]);

  useEffect(() => {
    if (!file) {
      setPreflight(null);
      return;
    }
    let cancelled = false;
    setPreflight({ status: "checking", message: t.preflightRunning });
    preflightLiveClipCustomerVideo(file)
      .then((res) => {
        if (!cancelled) setPreflight(res);
      })
      .catch(() => {
        if (!cancelled) {
          setPreflight({
            status: "blocked",
            message: t.preflightFailed,
            next_action: lang === "zh" ? "请更换或重新导出视频后再上传。" : "Use another exported video and try again.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file, lang]);

  async function refreshAll(currentTaskId = taskId) {
    if (!currentTaskId) return;
    const [statusRes, resultRes, qaRes, repairRes] = await Promise.all([
      getLiveClipCustomerStatus(currentTaskId),
      getLiveClipCustomerResult(currentTaskId),
      getLiveClipCustomerQa(currentTaskId),
      getLiveClipCustomerRepairSummary(currentTaskId),
    ]);
    const nextClips = Array.isArray(resultRes.clips) ? resultRes.clips : [];
    if (taskScopeRef.current && taskScopeRef.current !== currentTaskId) {
      return { status: "stale", clipCount: 0, batchStatus: "" };
    }
    setStatus(customerStatusText(statusRes.status, statusRes.step, lang));
    setProgress(Number(statusRes.progress || 0));
    setStep(customerStatusText(statusRes.status, statusRes.step, lang));
    setBatchStatus(String(statusRes.status || ""));
    setClips(nextClips);
    setPlanVersions(Array.isArray(resultRes.versions) ? resultRes.versions : []);
    setQa(normalizeCustomerQaResponse(qaRes));
    setRepairSummary(repairRes.status === "ok" ? repairRes : { current_version: 1, versions: [], can_restore_previous: false });
    setReviewConfirmed(["pass", "approved"].includes(qaRes.review_status));
    if (nextClips[0]) await selectClip(nextClips[0], currentTaskId);
    return { ...statusRes, clipCount: nextClips.length, batchStatus: String(statusRes.status || "") };
  }

  async function selectClip(clip: CustomerClip, currentTaskId = taskId) {
    setSelectedClip(clip);
    const [subtitleRes, copywritingRes] = await Promise.all([
      getLiveClipCustomerSubtitle(currentTaskId, clip.clip_id),
      getLiveClipCustomerCopywriting(currentTaskId, clip.clip_id),
    ]);
    setSubtitle({ srt: subtitleRes.srt || "", ass: subtitleRes.ass || "" });
    setCopywriting({
      titles: copywritingRes.titles || [],
      caption: copywritingRes.caption || "",
      tags: copywritingRes.tags || [],
    });
  }

  async function uploadSelectedVideo() {
    if (!file) {
      throw new Error(t.chooseVideo);
    }
    clearCustomerTaskState();
    setStatus(t.statusUploading);
    setStep(t.statusUploading);
    setProgress(12);
    const res = await uploadLiveClipCustomerVideo({ file, ...form });
    if (!res.task_id || res.status === "failed") {
      throw new Error(res.message || t.uploadFailed);
    }
    setTaskId(res.task_id);
    setExportData(null);
    setReviewConfirmed(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "liveclip");
    url.searchParams.set("taskId", res.task_id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return res.task_id;
  }

  async function generate() {
    if (shouldBlockLiveClipGeneration({ busy, batchStatus })) {
      setMessage(t.generationAlreadyRunning);
      return;
    }
    if (!file && !taskId) {
      setMessage(t.chooseVideo);
      return;
    }
    if (file && preflight?.status === "blocked") {
      setMessage(preflight.next_action || preflight.message || t.preflightFailed);
      return;
    }
    setBusy("generate");
    setMessage("");
    setStatus(t.statusClips);
    setProgress(35);
    setStep(t.statusClips);
    try {
      const currentTaskId = file ? await uploadSelectedVideo() : taskId;
      setStatus(t.statusClips);
      setStep(t.statusClips);
      setProgress(45);
      const started = await startLiveClipCustomerTask(currentTaskId);
      if (!["processing", "completed", "ok"].includes(started.status)) {
        const nextAction = Array.isArray(started.next_action) ? started.next_action[0] : started.next_action;
        throw new Error(nextAction || started.message || t.generationFailed);
      }
      const snapshot = await refreshAll(currentTaskId);
      setReviewConfirmed(false);
      const generationMessage = getLiveClipGenerationMessage({
        status: snapshot?.status,
        clipCount: snapshot?.clipCount,
        startedStatus: started.status,
        t,
      });
      if (generationMessage) setMessage(generationMessage);
    } catch (error: any) {
      setStatus(t.statusAttention);
      setStep(t.statusAttention);
      setMessage(error?.message || t.generationFailed);
    } finally {
      setBusy("");
    }
  }

  async function approveResult() {
    if (!taskId) return;
    setBusy("approve");
    try {
      const res = await approveLiveClipCustomerTask(taskId);
      if (res.status === "approved" || res.status === "ok") {
        setReviewConfirmed(true);
        setMessage(res.message || t.approveReady);
      } else {
        const nextAction = Array.isArray(res.next_action) ? res.next_action[0] : res.next_action;
        setReviewConfirmed(false);
        setMessage(nextAction || res.message || t.approveFailed);
      }
    } finally {
      setBusy("");
    }
  }

  async function exportPackage() {
    if (!taskId) return;
    setBusy("export");
    try {
      const res = await exportLiveClipCustomerPackage(taskId);
      setExportData(res);
      const nextAction = Array.isArray(res.next_action) ? res.next_action[0] : res.next_action;
      setMessage(res.zip_url ? t.packageReady : (nextAction || res.message || t.packageUnavailable));
    } finally {
      setBusy("");
    }
  }

  async function retryQaIssue(issue: any) {
    if (!taskId || !issue?.clip_id || !issue?.issue_id) return;
    setBusy("repair");
    try {
      const response = await repairLiveClipCustomerIssue(taskId, issue.clip_id, issue.issue_id);
      const nextAction = Array.isArray(response.next_action) ? response.next_action[0] : response.next_action;
      setMessage(response.message || nextAction || "局部重做已返回结果。");
      setReviewConfirmed(false);
      await refreshAll(taskId);
    } finally {
      setBusy("");
    }
  }

  async function restorePreviousVersion() {
    if (!taskId || !selectedClip?.clip_id) return;
    setBusy("restore");
    try {
      const response = await restoreLiveClipCustomerPrevious(taskId, selectedClip.clip_id);
      setMessage(response.message || "已恢复上一版本。");
      setReviewConfirmed(false);
      await refreshAll(taskId);
    } finally {
      setBusy("");
    }
  }

  async function activatePlanVersion(versionId: string) {
    if (!taskId || !versionId) return;
    setBusy("version");
    try {
      const response = await activateLiveClipCustomerVersion(taskId, versionId);
      setMessage(response.message || "已设为当前主版本。");
      setReviewConfirmed(false);
      await refreshAll(taskId);
    } finally {
      setBusy("");
    }
  }

  const primaryDisabled = Boolean(busy) || shouldBlockLiveClipGeneration({ busy, batchStatus }) || (!file && !taskId);
  const selectedTitle = selectedClip?.title || t.selectedClipFallback;
  const visibleProgressText = progress >= 100
    ? t.statusReady
    : busy
      ? t.statusClips
      : progress > 0
        ? customerStatusText(status, step, lang)
        : t.statusUploadBegin;
  const deliveryState = getCustomerDeliveryState({
    taskId,
    clipCount: clips.length,
    qaStatus: qa.status,
    confirmed: reviewConfirmed,
    busy,
    packageReady: Boolean(exportData?.zip_url),
  });

  return (
    <main className="liveclip-customer-page" data-liveclip-page="customer-delivery">
      <section className="liveclip-hero-input" data-liveclip-module="hero-input-layer">
        <LanguageToggle lang={lang} setLang={setLang} />
        <div className="liveclip-hero-copy">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{t.heroTitle}</h1>
          <p>{t.heroDesc}</p>
        </div>
        <UploadPanel file={file} form={form} preflight={preflight} setFile={setFile} setForm={setForm} t={t} />
        <PrimaryActionButton disabled={primaryDisabled} busy={busy} onClick={generate} t={t} />
      </section>
      {message && <div className="liveclip-customer-message">{message}</div>}
      {taskId && <div className="liveclip-customer-task-id" data-liveclip-task-id>任务 {shortLiveClipTaskId(taskId)}</div>}
      <ProgressIndicator status={visibleProgressText} progress={progress} step={visibleProgressText} />
      <ClipList clips={clips} selectedId={selectedClip?.clip_id || ""} onSelect={selectClip} t={t} />
      <section className="liveclip-detail-layer">
        <div>
          <p className="eyebrow">{t.selectedClip}</p>
          <h2>{selectedTitle}</h2>
        </div>
        <SubtitlePanel subtitle={subtitle} clip={selectedClip} t={t} />
        <CopywritingPanel copywriting={copywriting} reload={() => selectedClip && selectClip(selectedClip, taskId)} t={t} />
        <CustomerEvidencePanel clip={selectedClip} t={t} />
      </section>
      <CustomerQAResultPanel qa={qa} busy={busy} onRetry={retryQaIssue} t={t} />
      <CustomerPlanVersionPanel versions={planVersions} busy={busy} onActivate={activatePlanVersion} t={t} />
      <CustomerVersionPanel summary={repairSummary} busy={busy} onRestore={restorePreviousVersion} t={t} />
      <DeliveryPanel
        busy={busy}
        confirmed={reviewConfirmed}
        exportData={exportData}
        clips={clips}
        canApprove={deliveryState.canApprove}
        canExport={deliveryState.canExport}
        canDownload={deliveryState.canDownload}
        onApprove={approveResult}
        onExport={exportPackage}
        t={t}
      />
    </main>
  );
}

function customerStatusText(status: string, step: string | undefined, lang: LiveClipLang) {
  const t = liveClipI18n[lang];
  const joined = `${status || ""} ${step || ""}`;
  if (/failed|失败|attention/i.test(joined)) return t.statusAttention;
  if (/completed|完成|交付|导出|download/i.test(joined)) return t.statusReady;
  if (/字幕|caption|subtitle/i.test(joined)) return t.statusCaptions;
  if (/短视频|clip|成片|生成/i.test(joined)) return t.statusClips;
  if (/upload|上传/i.test(joined)) return t.statusUploading;
  if (/processing|处理|running/i.test(joined)) return t.statusPreparing;
  return t.statusUploadBegin;
}

export function shouldPollLiveClipCustomerTask(status: string | undefined) {
  return !["completed", "failed", "blocked"].includes(String(status || "").toLowerCase());
}

export function isLiveClipTaskId(taskId: unknown) {
  const value = typeof taskId === "string" ? taskId.trim() : "";
  return Boolean(value && !value.startsWith("pv_"));
}

export function initialLiveClipTaskId(browser: any = window) {
  const queryTaskId = new URLSearchParams(browser.location.search).get("taskId");
  const storedTaskId = browser.localStorage?.getItem("liveClipTaskId");
  return [queryTaskId, storedTaskId].find(isLiveClipTaskId) || "";
}

export const LIVE_CLIP_CUSTOMER_POLL_MAX_FAILURES = 3;

export function shouldRetryLiveClipCustomerPoll(failureCount: number) {
  return Number(failureCount || 0) < LIVE_CLIP_CUSTOMER_POLL_MAX_FAILURES;
}

function formatFileSize(value = 0) {
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function LanguageToggle({ lang, setLang }: { lang: LiveClipLang; setLang: (lang: LiveClipLang) => void }) {
  return (
    <div className="language-toggle" aria-label="language switcher" data-liveclip-module="language-toggle">
      <button className={lang === "zh" ? "active" : ""} type="button" onClick={() => setLang("zh")}>中文</button>
      <button className={lang === "en" ? "active" : ""} type="button" onClick={() => setLang("en")}>EN</button>
    </div>
  );
}

function UploadPanel({ file, form, preflight, setFile, setForm, t }: any) {
  function update(key: string, value: any) {
    setForm((current: any) => ({ ...current, [key]: value }));
  }
  return (
    <section className="customer-card upload-panel" data-liveclip-module="upload-panel">
      <UploadZone file={file} preflight={preflight} setFile={setFile} t={t} />
      <div className="customer-form-grid" data-liveclip-module="basic-input-form">
        <input data-liveclip-field="title" placeholder={t.titlePlaceholder} value={form.title} onChange={(event) => update("title", event.target.value)} />
        <input data-liveclip-field="product" placeholder={t.productPlaceholder} value={form.product} onChange={(event) => update("product", event.target.value)} />
        <input data-liveclip-field="direction" placeholder={t.directionPlaceholder} value={form.direction} onChange={(event) => update("direction", event.target.value)} />
        <select data-liveclip-field="platform" value={form.platform} onChange={(event) => update("platform", event.target.value)}>
          {platforms.map((item) => <option key={item}>{item}</option>)}
        </select>
        <label className="customer-checkbox-field">
          <input
            checked={Boolean(form.sourceHasBurnedSubtitles)}
            data-liveclip-field="source-has-burned-subtitles"
            type="checkbox"
            onChange={(event) => update("sourceHasBurnedSubtitles", event.target.checked)}
          />
          <span><strong>{t.sourceSubtitleLabel}</strong><small>{t.sourceSubtitleHint}</small></span>
        </label>
      </div>
    </section>
  );
}

function UploadZone({ file, preflight, setFile, t }: any) {
  const checks = preflight?.checks || {};
  return (
    <label className="customer-drop-zone" data-liveclip-module="upload-zone" data-liveclip-action="select-video">
      <input
        accept={LIVE_CLIP_VIDEO_ACCEPT}
        type="file"
        onChange={(event) => setFile(event.target.files?.[0] || null)}
      />
      <span>{file ? file.name : t.uploadVideo}</span>
      <small>{file ? `${formatFileSize(file.size)} · ${t.readyToGenerate}` : t.uploadHint}</small>
      {preflight && (
        <div className={`customer-preflight ${preflight.status === "ok" ? "passed" : preflight.status === "checking" ? "checking" : "failed"}`} data-liveclip-module="upload-preflight">
          <strong>{preflight.status === "ok" ? t.preflightPassed : preflight.status === "checking" ? t.preflightRunning : t.preflightFailed}</strong>
          {preflight.message && <span>{preflight.message}</span>}
          <ul>
            <li>{t.preflightAudio}：{checks.has_audio ? "OK" : "-"}</li>
            <li>{t.preflightVoice}：{checks.human_voice_likely ? "OK" : "-"}</li>
            <li>{t.preflightDuration}：{checks.duration_seconds ? `${Number(checks.duration_seconds).toFixed(1)}s` : "-"}</li>
            <li>{t.preflightResolution}：{checks.width && checks.height ? `${checks.width}×${checks.height}` : "-"}</li>
          </ul>
          {preflight.next_action && <span>{preflight.next_action}</span>}
        </div>
      )}
      <div className="upload-progress"><span style={{ width: file ? "100%" : "0%" }} /></div>
    </label>
  );
}

function PrimaryActionButton({ disabled, busy, onClick, t }: any) {
  return (
    <button className="customer-primary-button" data-liveclip-action="generate-video" type="button" disabled={disabled} onClick={onClick}>
      {busy ? t.generating : t.generate}
    </button>
  );
}

function ProgressIndicator({ status, progress, step }: any) {
  const normalized = Math.max(0, Math.min(100, progress));
  return (
    <section className="processing-layer" data-liveclip-module="progress-panel">
      <div className="customer-progress-meta">
        <strong>{step || status}</strong>
        <span>{normalized}%</span>
      </div>
      <div className="customer-progress-bar"><span style={{ width: `${normalized}%` }} /></div>
    </section>
  );
}

function ClipList({ clips, selectedId, onSelect, t }: { clips: CustomerClip[]; selectedId: string; onSelect: (clip: CustomerClip) => void; t: any }) {
  return (
    <section className="result-layer" data-liveclip-module="clip-list">
      <div className="section-heading">
        <p className="eyebrow">{t.resultsEyebrow}</p>
        <h2>{t.generatedClips}</h2><span className="result-count" data-liveclip-preview-count>{t.previewCount.replace("{count}", String(clips.length))}</span>
      </div>
      {!clips.length && <p className="customer-empty">{t.emptyResults}</p>}
      <div className="customer-clip-list">
        {clips.map((clip) => <div key={clip.clip_id}><ClipCard clip={clip} active={clip.clip_id === selectedId} onSelect={() => onSelect(clip)} t={t} /></div>)}
      </div>
    </section>
  );
}

function ClipCard({ clip, active, onSelect, t }: { clip: CustomerClip; active: boolean; onSelect: () => void; t: any }) {
  return (
    <article className={`customer-clip-card ${active ? "active" : ""}`} data-liveclip-module="clip-card">
      <video controls src={clip.url} />
      <div className="clip-card-body">
        <h3>{clip.title}</h3>
        <div className="clip-meta">
          <span>{clip.duration.toFixed(2)}s</span>
          <span>{clip.subtitle ? t.subtitlesReady : t.noSubtitles}</span>
          <span>{clip.qa_status === "passed" ? t.qualityPassed : t.needsReview}</span>
        </div>
        <div className="customer-actions">
          <button data-liveclip-action="view-clip-details" type="button" onClick={onSelect}>{t.details}</button>
          <a data-liveclip-action="download-clip" href={clip.url} download>{t.download}</a>
          <button data-liveclip-action="copy-title" type="button" onClick={() => navigator.clipboard?.writeText(clip.title)}>{t.copyTitle}</button>
        </div>
      </div>
    </article>
  );
}

function SubtitlePanel({ subtitle, clip, t }: any) {
  const srtHref = `data:text/plain;charset=utf-8,${encodeURIComponent(subtitle.srt || "")}`;
  return (
    <section className="customer-card" data-liveclip-module="subtitle-panel">
      <h3>{t.subtitles}</h3>
      <p>{clip ? `${clip.title}` : t.selectClipSubtitle}</p>
      <pre className="customer-text-box">{subtitle.srt || t.noSubtitleYet}</pre>
      <div className="customer-actions"><a data-liveclip-action="download-subtitle" href={srtHref} download={`${clip?.clip_id || "subtitle"}.srt`}>{t.downloadSrt}</a></div>
    </section>
  );
}

export function buildCopywritingTitleItems(titles: unknown[] = []) {
  const occurrences = new Map<string, number>();
  return titles.map((value) => {
    const title = String(value);
    const occurrence = (occurrences.get(title) || 0) + 1;
    occurrences.set(title, occurrence);
    return { key: `${title}::${occurrence}`, title };
  });
}

function CopywritingPanel({ copywriting, reload, t }: any) {
  return (
    <section className="customer-card" data-liveclip-module="copywriting-panel">
      <h3>{t.titlesCopy}</h3>
      <div className="customer-title-list">
        {buildCopywritingTitleItems(copywriting.titles || []).map(({ key, title }) => (
          <button data-liveclip-action="copy-title-candidate" key={key} type="button" onClick={() => navigator.clipboard?.writeText(title)}>{title}</button>
        ))}
      </div>
      <textarea readOnly value={copywriting.caption || t.noCaptionYet} />
      <p>{(copywriting.tags || []).join(" ")}</p>
      <div className="customer-actions">
        <button data-liveclip-action="copy-caption" type="button" onClick={() => navigator.clipboard?.writeText(copywriting.caption || "")}>{t.copyCaption}</button>
        <button data-liveclip-action="refresh-titles" type="button" onClick={reload}>{t.refreshTitles}</button>
      </div>
    </section>
  );
}

function CustomerEvidencePanel({ clip, t }: any) {
  const evidence = clip?.evidence || [];
  return (
    <section className="customer-card" data-liveclip-module="evidence-panel">
      <h3>{t.sellingPointEvidence}</h3>
      {clip?.selection_reason && <p><strong>{t.selectionReason}：</strong>{clip.selection_reason}</p>}
      {(clip?.selling_points || []).length > 0 && <p>{clip.selling_points.join(" · ")}</p>}
      {evidence.length ? evidence.map((item: any, index: number) => (
        <blockquote key={`${item.claim}-${index}`}>
          <strong>{item.claim}</strong>
          <span>{item.text}</span>
          {Number(item.time_range?.end || 0) > 0 && <small>{formatCustomerTime(item.time_range.start)}–{formatCustomerTime(item.time_range.end)}</small>}
        </blockquote>
      )) : <p>{t.noEvidence}</p>}
    </section>
  );
}

export function CustomerQAResultPanel({ qa, busy, onRetry, t }: any) {
  const passed = qa.status === "passed";
  return (
    <section className="customer-card qa-summary-card" data-liveclip-module="qa-result-panel">
      <p className="eyebrow">{t.quality}</p>
      <h2>{passed ? t.readyToDeliver : t.needsAnotherPass}</h2>
      <div className={passed ? "customer-qa passed" : "customer-qa failed"}>{passed ? t.qualityPassed : t.reviewRequired}</div>
      <ul>{(qa.summary || []).map((item: string) => <li key={item}>{passed ? "✔" : "⚠"} {item}</li>)}</ul>
      <div className="customer-qa-issues">
        {(qa.issues || []).map((issue: any) => (
          <article key={issue.issue_id} data-liveclip-module="qa-issue">
            <strong>{issue.problem}</strong>
            <p>{issue.reason}</p>
            <small>{t.issueTime}：{formatCustomerTime(issue.time_range?.start)}–{formatCustomerTime(issue.time_range?.end)}</small>
            <button
              data-liveclip-action="retry-qa-issue"
              disabled={!issue.can_retry || Boolean(busy)}
              onClick={() => onRetry(issue)}
              type="button"
            >{busy === "repair" ? t.retrying : t.localRetry}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CustomerVersionPanel({ summary, busy, onRestore, t }: any) {
  if (!(summary?.versions || []).length) return null;
  return (
    <section className="customer-card" data-liveclip-module="version-panel">
      <p className="eyebrow">{t.versionHistory}</p>
      <h2>{t.currentVersion} {summary.current_version}</h2>
      <ul>{summary.versions.map((item: any) => <li key={item.version}>{item.change} · {item.status}{item.is_current ? " · 当前" : ""}</li>)}</ul>
      {summary.can_restore_previous && <button data-liveclip-action="restore-previous-version" disabled={Boolean(busy)} onClick={onRestore} type="button">{busy === "restore" ? t.restoring : t.restorePrevious}</button>}
    </section>
  );
}

export function CustomerPlanVersionPanel({ versions, busy, onActivate, t }: any) {
  if (!(versions || []).length) return null;
  return (
    <section className="customer-card" data-liveclip-module="plan-version-panel">
      <p className="eyebrow">{t.videoVersions}</p>
      <div className="customer-version-grid">
        {versions.map((item: any) => (
          <article key={item.version_id}>
            <strong>{item.name}</strong>
            <p>{item.reason}</p>
            <span>{item.qa_status === "passed" ? t.qualityPassed : t.needsReview}</span>
            {item.is_current
              ? <button disabled type="button">{t.currentMainVersion}</button>
              : <button data-liveclip-action="activate-main-version" disabled={item.qa_status !== "passed" || Boolean(busy)} onClick={() => onActivate(item.version_id)} type="button">{t.setMainVersion}</button>}
          </article>
        ))}
      </div>
    </section>
  );
}

function DeliveryPanel({ busy, confirmed, exportData, clips, canApprove, canExport, canDownload, onApprove, onExport, t }: any) {
  return (
    <section className="delivery-layer" data-liveclip-module="export-panel">
      <div>
        <p className="eyebrow">{t.delivery}</p>
        <h2>{t.deliveryTitle}</h2>
        <p>{t.deliveryDesc}</p>
      </div>
      <div className="delivery-actions">
        <button className="customer-delivery-button secondary" data-liveclip-action="confirm-review" type="button" disabled={!canApprove || confirmed} onClick={onApprove}>
          {busy === "approve" ? t.confirming : t.confirmResult}
        </button>
        <button className="customer-delivery-button primary" data-liveclip-action="export-delivery-zip" type="button" disabled={!canExport || !confirmed} onClick={onExport}>{t.downloadAllZip}</button>
        {canDownload && exportData?.zip_url && <a className="customer-delivery-button primary" data-liveclip-action="open-delivery-zip" href={exportData.zip_url}>{t.openZip}</a>}
        {clips.map((clip: CustomerClip) => <a className="customer-delivery-button secondary" data-liveclip-action="download-final-clip" key={clip.clip_id} href={clip.url} download>{clip.title}</a>)}
        {exportData?.files?.subtitles?.[0] && <a className="customer-delivery-button secondary" data-liveclip-action="download-subtitles-package" href={`/${exportData.files.subtitles[0]}`}>{t.downloadSubtitles}</a>}
      </div>
    </section>
  );
}

export function LiveClipPage({ state, setState, setResult, onNavigate }: any) {
  return <LiveClipCustomerPage />;

  const [fileName, setFileName] = useState(() => window.localStorage.getItem("liveClipFileName") || "");
  const [subtitleName, setSubtitleName] = useState(() => window.localStorage.getItem("liveClipSubtitleName") || "");
  const [busy, setBusy] = useState("");
  const [ffmpeg, setFfmpeg] = useState<any>(null);
  const [localResult, setLocalResult] = useState<any>(null);
  const [selectedId, setSelectedId] = useState("");
  const [reviewStatus, setReviewStatus] = useState("draft");
  const [toast, setToast] = useState("");
  const [sourcePreviewSrc, setSourcePreviewSrc] = useState("");
  const [sourcePreviewIsVideo, setSourcePreviewIsVideo] = useState(false);
  const [templateItems, setTemplateItems] = useState(LIVE_CLIP_TEMPLATE_ITEMS);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [deliveryPackage, setDeliveryPackage] = useState<any>(null);
  const localSourcePreviewRef = useRef("");
  const [form, setForm] = useState({
    topic: "",
    product: "",
    direction: "",
    selectedPlatforms: ["抖音"],
    subtitle: true,
    captionStyle: DEFAULT_LIVE_CLIP_CAPTION_STYLE,
    templateItems: LIVE_CLIP_TEMPLATE_ITEMS,
  });

  const result = localResult?.data || {};
  const visibleRerunContentHidden = shouldHideLiveClipCompletedResults(result, localResult);
  const clips = getVisibleLiveClipSegments(result, localResult);
  const renderVariants = Array.isArray(result?.render_variants) ? result.render_variants : [];
  const activeVariantId = result?.active_variant_id || "";
  const qaResult = visibleRerunContentHidden ? null : getQaResult(result, clips);
  const qaPassed = qaResult?.qa_status === "passed";
  const canExportFinal = visibleRerunContentHidden ? false : canExportFinalByQa(qaResult);
  const canExportJianying = visibleRerunContentHidden ? false : canExportJianyingByQa(qaResult);
  const selected = getVisibleLiveClipSelectedClip(result, localResult, selectedId);
  const previewSrc = previewPath(selected);
  const deliveryDownloadUrl = deliveryPackage?.download_url || deliveryPackage?.manifest?.download_url || "";
  const activeStep = useMemo(
    () => deriveLiveClipActiveStep(result, state),
    [result, state],
  );

  useEffect(() => {
    checkFfmpeg().then(setFfmpeg).catch(() => setFfmpeg({ status: "blocked" }));
    getLiveClipTemplates()
      .then((res) => {
        const items = res?.data?.items;
        if (Array.isArray(items) && items.length) {
          setTemplateItems(items);
          setForm((current: any) => ({ ...current, templateItems: items }));
        }
      })
      .catch(() => undefined);
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get("taskId") || window.localStorage.getItem("liveClipTaskId") || state.liveClipTaskId;
    if (taskId) {
      setState((s: any) => ({ ...s, liveClipTaskId: taskId }));
      getLiveClipResult(taskId).then((res) => {
        const normalized = applyLiveClipResponse(res);
        if (isMissingLiveClipTask(normalized)) {
          clearInvalidLiveClipTask(setState);
        }
        const thumbnailUrl = normalized.data?.source_video?.thumbnail_url;
        if (thumbnailUrl) {
          setSourcePreviewSrc(thumbnailUrl);
          setSourcePreviewIsVideo(false);
        }
      }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    return () => releaseLiveClipObjectUrl(localSourcePreviewRef.current);
  }, []);

  function showFeedback(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function persistTask(taskId: string) {
    if (!taskId) return;
    window.localStorage.setItem("liveClipTaskId", taskId);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "liveclip");
    url.searchParams.set("taskId", taskId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function applyLiveClipResponse(response: any) {
    const normalized = normalizeLiveClipResponse(response);
    setLocalResult(normalized);
    setResult(normalized);
    const first = normalized.data?.slice_segments?.[0]?.clip_id;
    if (first) setSelectedId(first);
    if (normalized.data?.review_status) setReviewStatus(normalized.data.review_status);
    return normalized;
  }

  async function activateVariant(variantId: string) {
    if (!state.liveClipTaskId || !variantId) return;
    setBusy("variant");
    try {
      const response = await activateLiveClipVariant(state.liveClipTaskId, variantId);
      const normalized = applyLiveClipResponse(response);
      showFeedback(normalized.message || "已切换主版本");
    } catch (error: any) {
      showFeedback(error?.message || "主版本切换失败");
    } finally {
      setBusy("");
    }
  }

  async function handleUpload(file: File) {
    const validation = validateLiveClipVideoFile(file);
    if (!validation.valid) {
      showFeedback(validation.message);
      return;
    }
    const localPreview = replaceLiveClipObjectUrl(localSourcePreviewRef.current, file);
    localSourcePreviewRef.current = localPreview;
    setSourcePreviewSrc(localPreview);
    setSourcePreviewIsVideo(true);
    setFileName(file.name);
    window.localStorage.setItem("liveClipFileName", file.name);
    const accountId = state.accountId || "live_clip_demo";
    try {
      await withLiveClipUploadBusy(setBusy, async () => {
        const taskId = state.liveClipTaskId || await saveTask();
        if (!taskId) throw new Error("任务创建失败，暂时无法上传视频。");
        setBusy("upload");
        const res = await uploadLiveClipTaskVideo(taskId, accountId, file);
        setResult(res);
        if (!res.data?.material?.material_id) {
          throw new Error(getLiveClipUploadFailureMessage(res, "视频上传失败。"));
        }
        releaseLiveClipObjectUrl(localSourcePreviewRef.current);
        localSourcePreviewRef.current = "";
        setSourcePreviewSrc(res.data?.source_video?.thumbnail_url || getLiveClipSourceThumbnailUrl(taskId));
        setSourcePreviewIsVideo(false);
        persistTask(taskId);
        showFeedback("视频上传成功，已绑定直播切片任务。");
        setState((s: any) => ({ ...s, accountId, liveClipTaskId: taskId, liveClipMaterialId: res.data.material.material_id, materialId: s.materialId || res.data.material.material_id }));
      });
    } catch (error: any) {
      showFeedback(error?.message || "视频上传失败，请检查网络后重试。");
    }
  }

  async function handleSubtitleUpload(file: File) {
    setBusy("subtitle");
    setSubtitleName(file.name);
    window.localStorage.setItem("liveClipSubtitleName", file.name);
    const taskId = state.liveClipTaskId || await saveTask();
    if (!taskId) {
      setBusy("");
      return;
    }
    const res = await uploadLiveClipTaskSubtitle(taskId, file);
    setBusy("");
    setResult(res);
    if (res.status === "ok") {
      persistTask(taskId);
      showFeedback("SRT 字幕上传成功，后续将按真实字幕时间轴切片。");
    } else {
      setLocalResult(res);
      showFeedback(res.message || "SRT 上传失败。");
    }
  }

  async function saveTask() {
    if (state.liveClipTaskId) {
      return state.liveClipTaskId;
    }
    setBusy("save");
    const res = await createLiveClipTask({
      account_id: state.accountId || "live_clip_demo",
      topic: form.topic,
      product: form.product,
      content_direction: form.direction,
      platform: platformValueMap[form.selectedPlatforms[0]] || "douyin",
      target_platforms: form.selectedPlatforms,
      transcription_engine: "funasr",
      enable_subtitle_generation: form.subtitle,
      enable_flycut_caption: true,
      caption_style: form.captionStyle,
      enable_subtitle_burn: true,
      enable_vertical_reframe: true,
      top_n: LIVE_CLIP_PREVIEW_LIMIT,
      max_clip_duration_seconds: 60,
    });
    setBusy("");
    setResult(res);
    if (res.data?.task_id) {
      persistTask(res.data.task_id);
      setState((s: any) => ({ ...s, liveClipTaskId: res.data.task_id, liveClipStatus: "created" }));
      showFeedback("任务已创建。");
      return res.data.task_id;
    }
    return "";
  }

  async function startRun() {
    const taskId = state.liveClipTaskId || await saveTask();
    if (!taskId) return;
    setBusy("run");
    try {
      const res = await runLiveClipTask(taskId);
      const normalized = applyLiveClipResponse(res);
      showFeedback(normalized.message || "切片流程已返回结果。");
    } catch (error: any) {
      const failed = { status: "failed", message: error?.message || "开始切片失败", data: {}, missing_inputs: [], warnings: [], next_action: ["查看后端服务是否启动。"] };
      setLocalResult(failed);
      setResult(failed);
    } finally {
      setBusy("");
    }
  }

  async function refreshResult() {
    if (!state.liveClipTaskId) return;
    setBusy("status");
    const statusRes = await getLiveClipStatus(state.liveClipTaskId);
    const res = normalizeLiveClipResponse(await getLiveClipResult(state.liveClipTaskId));
    setBusy("");
    const merged = res.status === "blocked" && !res.data?.slice_segments?.length
      ? { ...res, data: { ...(res.data || {}), progress: statusRes.data?.progress, progress_steps: statusRes.data?.steps } }
      : res;
    applyLiveClipResponse({ ...merged, live_clip_status: statusRes.data });
    showFeedback("进度已刷新。");
  }

  async function submitReview() {
    if (state.liveClipTaskId) {
      setBusy("review");
      const res = await reviewLiveClipTask(state.liveClipTaskId);
      setBusy("");
      setLocalResult(res);
      setResult(res);
      setReviewStatus(res.status === "ok" || res.status === "partial" ? "pending_review" : reviewStatus);
      showFeedback(res.message || "审核提交已返回。");
      return;
    }
    const blocked = { status: "blocked", message: "缺少任务，无法提交审核", data: {}, missing_inputs: ["task_id"], warnings: [], next_action: ["先上传视频并开始切片。"] };
    setLocalResult(blocked);
    setResult(blocked);
  }

  async function handleExport(type = "final_clips_zip") {
    if (!state.liveClipTaskId) {
      const blocked = { status: "blocked", message: "缺少任务，无法导出交付包", data: {}, missing_inputs: ["task_id"], warnings: [], next_action: ["先生成 slice_segments。"] };
      setLocalResult(blocked);
      setResult(blocked);
      return;
    }
    if (type === "delivery_package") {
      setBusy(type);
      const res = await createLiveClipDeliveryPackage(state.liveClipTaskId);
      setBusy("");
      setResult(res);
      if (res.status === "ok") {
        setDeliveryPackage(res.data);
        showFeedback(res.message || "交付包已生成。");
      } else {
        setLocalResult(res.data?.slice_segments ? res : localResult || res);
        showFeedback(res.message || "交付包暂不可导出。");
      }
      return;
    }
    setBusy(type);
    const res = await exportLiveClipTask(state.liveClipTaskId, type);
    setBusy("");
    setLocalResult(res.data?.slice_segments ? res : localResult);
    setResult(res);
    if (res.data?.download_url) window.open(res.data.download_url, "_blank");
    showFeedback(res.message || "导出接口已返回。");
  }

  async function approveCurrentTask() {
    if (!state.liveClipTaskId) {
      const blocked = { status: "blocked", message: "缺少任务，无法通过审核", data: {}, missing_inputs: ["task_id"], warnings: [], next_action: ["先生成切片结果。"] };
      setLocalResult(blocked);
      setResult(blocked);
      return;
    }
    setBusy("approve");
    const res = await approveLiveClipJob(state.liveClipTaskId, { reviewer: "客户审核", comment: "客户版 UI 通过审核。" });
    setBusy("");
    const normalized = applyLiveClipResponse(res);
    setReviewStatus(res.status === "ok" || res.status === "partial" ? "approved" : reviewStatus);
    showFeedback(normalized.message || "审核接口已返回。");
  }

  function downloadDeliveryPackage() {
    const packageId = deliveryPackage?.package_id || deliveryPackage?.manifest?.package_id;
    const url = deliveryDownloadUrl || (packageId ? getLiveClipDeliveryPackageDownloadUrl(packageId) : "");
    if (!url) {
      showFeedback("请先导出交付包。");
      return;
    }
    window.open(url, "_blank");
  }

  return (
    <div className="commerce-shell">
      <TopNavigationBar />
      <div className={sidebarExpanded ? "commerce-body sidebar-expanded" : "commerce-body sidebar-collapsed"}>
        <SidebarNavigation active="liveclip" sidebarExpanded={sidebarExpanded} setSidebarExpanded={setSidebarExpanded} onNavigate={onNavigate} />
        <main className="live-workbench">
          <LiveClipPageHeader ffmpeg={ffmpeg} />
          <WorkflowStepTabs activeStep={activeStep} />
          <section className="live-main-grid">
            <div className="live-left-stack">
              <LiveVideoInputCard busy={busy} fileName={fileName} form={form} materialReady={Boolean(state.liveClipMaterialId)} onChange={setForm} onSubtitleUpload={handleSubtitleUpload} onUpload={handleUpload} sourcePreviewIsVideo={sourcePreviewIsVideo} sourcePreviewSrc={sourcePreviewSrc} subtitleName={subtitleName} templateItems={templateItems} />
              <ClipProcessProgress activeStep={activeStep} />
              <LiveClipResultPanel qaResult={qaResult} result={result} response={localResult} selectedId={selected?.clip_id} showAdvanced={showAdvanced} />
              {showAdvanced ? (
                <section className="commerce-card live-advanced-panel">
                  <h3>高级信息</h3>
                  {shouldMountTranscriptWorkspace(state.liveClipTaskId) ? <BatchStageProgress taskId={state.liveClipTaskId} /> : null}
                  <CandidateClipTable clips={clips} onSelect={setSelectedId} rerunActive={visibleRerunContentHidden} selectedId={selected?.clip_id} />
                  <ClipTimelinePreview clips={clips} selectedId={selected?.clip_id} />
                  {shouldMountTranscriptWorkspace(state.liveClipTaskId) ? (
                    <TranscriptWorkspace
                      activeTemplateId={form.captionStyle}
                      onRerendered={(response) => {
                        const normalized = applyLiveClipResponse(response);
                        showFeedback(normalized.message || "多模板包装已刷新");
                      }}
                      rerunActive={visibleRerunContentHidden}
                      taskId={state.liveClipTaskId}
                      templateIds={(templateItems || LIVE_CLIP_TEMPLATE_ITEMS).map((item: any) => item.id)}
                    />
                  ) : null}
                </section>
              ) : null}
            </div>
            <aside className="live-right-stack">
              {showAdvanced ? (
                <LiveClipVariantComparePanel
                  activeVariantId={activeVariantId}
                  busy={busy === "variant"}
                  items={templateItems || LIVE_CLIP_TEMPLATE_ITEMS}
                  onActivate={activateVariant}
                  onFallback={activateVariant}
                  rerunActive={visibleRerunContentHidden}
                  variantHistory={result?.variant_history || []}
                  variants={renderVariants}
                />
              ) : null}
              <ShortVideoPreviewPanel clip={selected} previewSrc={previewSrc} rerunActive={visibleRerunContentHidden} />
              <ClipCopywritingPanel clip={selected} rerunActive={visibleRerunContentHidden} />
              <ExportFormatPanel canExportFinal={canExportFinal} canExportJianying={canExportJianying} deliveryPackage={deliveryPackage} onDownload={downloadDeliveryPackage} onExport={handleExport} rerunActive={visibleRerunContentHidden} showAdvanced={showAdvanced} />
            </aside>
          </section>
        </main>
      </div>
      {toast ? <div className="live-toast">{toast}</div> : null}
      <BottomActionBar activeStep={activeStep} busy={busy} canExportFinal={canExportFinal} deliveryReady={Boolean(deliveryDownloadUrl)} onAdvanced={() => setShowAdvanced((value) => !value)} onDownload={downloadDeliveryPackage} onExport={() => handleExport("delivery_package")} onPreview={refreshResult} onReview={submitReview} onRetry={startRun} onStart={startRun} onApprove={approveCurrentTask} qaPassed={qaPassed} qaRetryRequired={Boolean(qaResult?.qa_retry_required)} rerunActive={visibleRerunContentHidden} showAdvanced={showAdvanced} />
    </div>
  );
}

function TopNavigationBar() {
  return (
    <header className="commerce-topbar">
      <div className="commerce-brand"><span>C</span><strong>电商内容与经营分析智能化系统</strong></div>
      <button className="stage-select" type="button">第一阶段试跑</button>
      <input className="commerce-search" placeholder="搜索功能、报表、内容等" />
      <div className="commerce-user"><span className="bell">12</span><strong>王小美</strong></div>
    </header>
  );
}

function SidebarNavigation({ active, sidebarExpanded, setSidebarExpanded, onNavigate }: any) {
  const targetView: Record<string, string> = {
    brand: "overview",
    data: "benchmark",
    product: "material",
    report: "review",
    settings: "settings",
  };
  const items = [
    ["brand", "品牌策略"],
    ["data", "数据抓取分析"],
    ["product", "商品图与详情页"],
    ["liveclip", "直播切片分发"],
    ["report", "数据分析报告"],
    ["settings", "系统设置"],
  ];
  return (
    <aside className={sidebarExpanded ? "commerce-sidebar expanded" : "commerce-sidebar collapsed"} onMouseEnter={() => setSidebarExpanded(true)} onMouseLeave={() => setSidebarExpanded(false)}>
      <button aria-label={sidebarExpanded ? "收起左侧导航" : "展开左侧导航"} className="sidebar-toggle" onClick={() => setSidebarExpanded?.(!sidebarExpanded)} type="button"><span>{sidebarExpanded ? "‹" : "›"}</span><em>{sidebarExpanded ? "收起" : "展开"}</em></button>
      {items.map(([key, label]) => <button className={active === key ? "active" : ""} key={key} title={label} type="button" onClick={() => key === "liveclip" ? undefined : onNavigate?.(targetView[key] || "overview")}><span>{key === "liveclip" ? "▶" : "◎"}</span><em>{label}</em></button>)}
      <div className="autosave-card"><strong>自动保存已开启</strong><small>上次保存：今天 10:21</small></div>
    </aside>
  );
}

function LiveClipPageHeader({ ffmpeg }: any) {
  return (
    <div className="live-page-header">
      <div><h1>直播切片分发工作台</h1><p>将直播长视频拆分为多条短视频，输出切片样片、标题与文案建议</p></div>
      <span className="env-pill ok">客户交付版</span>
    </div>
  );
}

function WorkflowStepTabs({ activeStep }: { activeStep: number }) {
  return <div className="step-tabs">{steps.map((item, index) => <div className={activeStep >= index + 1 ? "active" : ""} key={item}>{item}</div>)}</div>;
}

function LiveVideoInputCard({ busy, fileName, form, materialReady, onChange, onSubtitleUpload, onUpload, sourcePreviewIsVideo, sourcePreviewSrc, subtitleName, templateItems }: any) {
  function togglePlatform(platform: string) {
    const selected = form.selectedPlatforms?.includes(platform)
      ? form.selectedPlatforms.filter((item: string) => item !== platform)
      : [...(form.selectedPlatforms || []), platform];
    onChange({ ...form, selectedPlatforms: selected.length ? selected : [platform] });
  }

  return (
    <section className="commerce-card input-card">
      <h3>视频素材输入</h3>
      <div className="input-card-grid">
        <label className={`${materialReady ? "commerce-upload ready" : "commerce-upload"}${sourcePreviewSrc ? " has-source-preview" : ""}`}>
          <input accept={LIVE_CLIP_VIDEO_ACCEPT} type="file" onChange={(event) => event.target.files?.[0] && onUpload(event.target.files[0])} />
          {sourcePreviewSrc ? (
            <span className="source-preview-media">
              {sourcePreviewIsVideo
                ? <video muted playsInline preload="metadata" src={sourcePreviewSrc} />
                : <img alt="已上传源视频首帧" src={sourcePreviewSrc} />}
              <span className="source-preview-overlay">{busy === "upload" ? "上传中..." : "点击更换视频"}</span>
            </span>
          ) : <span className="upload-icon">☁</span>}
          <strong>{sourcePreviewSrc ? "源视频预览" : busy === "upload" ? "上传中..." : "点击上传直播长视频"}</strong>
          <small className="source-file-name">{fileName || "支持 MP4 / MOV / FLV / TS，单个文件最大 10GB"}</small>
        </label>
        <div className="input-fields">
          <label className="subtitle-upload-row">字幕/SRT
            <input accept=".srt,.txt" type="file" onChange={(event) => event.target.files?.[0] && onSubtitleUpload(event.target.files[0])} />
            <small>{busy === "subtitle" ? "字幕上传中..." : subtitleName || "可选：上传 SRT 后按真实时间轴切片"}</small>
          </label>
          <label>直播主题 <input maxLength={60} placeholder="请输入本场直播主题" value={form.topic} onChange={(e) => onChange({ ...form, topic: e.target.value })} /></label>
          <label>主推商品 <input placeholder="请选择主推商品" value={form.product} onChange={(e) => onChange({ ...form, product: e.target.value })} /></label>
          <label>目标平台 <div className="platform-select" role="group" aria-label="目标平台">{platforms.map((item) => {
            const selected = form.selectedPlatforms?.includes(item);
            return <button aria-pressed={selected} className={selected ? "active" : ""} data-platform={platformValueMap[item]} key={item} onClick={() => togglePlatform(item)} type="button">{item}</button>;
          })}</div></label>
          <label>内容方向 <select value={form.direction} onChange={(e) => onChange({ ...form, direction: e.target.value })}><option value="">请选择内容方向</option><option>商品讲解</option><option>带货转化</option><option>直播高能片段</option></select></label>
          <TemplateRegistryPanel
            items={templateItems || LIVE_CLIP_TEMPLATE_ITEMS}
            selectedId={form.captionStyle}
            onSelect={(value) => onChange({ ...form, captionStyle: value })}
          />
          <label className="radio-row">是否生成字幕 <input checked={form.subtitle} type="checkbox" onChange={(e) => onChange({ ...form, subtitle: e.target.checked })} /> <span>是（推荐）</span></label>
        </div>
      </div>
    </section>
  );
}

function ClipProcessProgress({ activeStep }: { activeStep: number }) {
  return <section className="commerce-card process-card"><div className="section-head"><h3>识别与切片进度</h3><span>预计剩余时间：02:18</span></div><div className="process-line">{processSteps.map((item, index) => <div className={activeStep >= index ? "active" : ""} key={item}><span>{index + 1}</span><strong>{item}</strong><small>{["将语音转为文字", "识别镜头切换点", "提取高价值片段", "生成候选切片", "生成成片与文案"][index]}</small></div>)}</div></section>;
}

function CandidateClipTable({ clips, onSelect, rerunActive, selectedId }: any) {
  return (
    <section className="commerce-card" id="liveClipSegmentList">
      <h3>候选切片列表</h3>
      <table className="commerce-table">
        <thead><tr><th>时间段</th><th>卖点标签</th><th>情绪强度</th><th>推荐分</th><th>风险提示</th><th>操作</th></tr></thead>
        <tbody>{clips.length ? clips.map((clip: any) => <tr className={selectedId === clip.clip_id ? "selected" : ""} key={clip.clip_id} onClick={() => onSelect(clip.clip_id)}><td>{clip.start_time} - {clip.end_time}</td><td><span>{clip.segment_type || clip.highlight_label}</span></td><td><i />{clip.hook ? "强" : "待转写"}</td><td className="green">{clip.score || clip.total_score || 0}</td><td>{clip.risk_tips?.length ? clip.risk_tips.join("；") : "无风险"}</td><td><button data-action="preview-clip" type="button">切片预览</button><button data-action="keep-clip" type="button">保留</button><button data-action="more-clip" type="button">更多操作</button></td></tr>) : <tr><td colSpan={6}>{rerunActive ? "正在重新切片，本轮候选结果生成后再展示。" : "暂无切片结果。点击“开始切片”后会在这里显示接口返回的 slice_segments。"}</td></tr>}</tbody>
      </table>
    </section>
  );
}

function ClipTimelinePreview({ clips, selectedId }: any) {
  return <section className="commerce-card timeline-card"><h3>时间轴预览</h3><div className="timeline-control"><button type="button">▶</button><div className="timeline-bars">{clips.map((clip: any, index: number) => <span className={clip.clip_id === selectedId ? "active" : ""} key={clip.clip_id} style={{ width: `${18 + index * 7}%` }} />)}</div></div><p>总时长 52:18　候选切片 {clips.length} 条　预计成片时长 06:32</p></section>;
}

function ShortVideoPreviewPanel({ clip, previewSrc, rerunActive }: any) {
  return <section className="commerce-card preview-card"><div className="section-head"><h3>短视频预览</h3><span>9:16</span></div><div className="phone-mock">{previewSrc ? <video controls src={previewSrc} /> : <div><strong>{rerunActive ? "本轮生成中" : clip?.distribution?.cover_text || "等待切片"}</strong><small>{rerunActive ? "重新切片后显示本轮真实预览" : clip?.title || "上传视频并开始切片后显示真实预览"}</small></div>}</div><div className="clip-thumbs">{clip ? <button className="active" type="button"><span>▶</span>{clip.slice_id || clip.clip_id}<small>{clip.duration || clip.duration_seconds || 0}s</small></button> : <button disabled type="button"><span>▶</span>{rerunActive ? "本轮生成中" : "暂无切片"}<small>00:00</small></button>}</div></section>;
}

function ClipCopywritingPanel({ clip, rerunActive }: any) {
  const titles = [clip?.distribution?.douyin_title, clip?.distribution?.kuaishou_title, clip?.distribution?.shipinhao_title].filter(Boolean);
  return <section className="commerce-card copy-panel"><h3>标题与文案建议</h3><ol>{titles.length ? titles.map((item, index) => <li key={`${item}-${index}`}><span>{index + 1}</span>{item}</li>) : <li><span>1</span>{rerunActive ? "本轮生成中，等待新的标题与文案建议。" : "暂无文案，等待 slice_segments。"}</li>}</ol><label>文案（建议）<textarea readOnly value={rerunActive ? "" : clip?.distribution?.video_caption || ""} /></label></section>;
}

function ExportFormatPanel({ canExportFinal, canExportJianying, deliveryPackage, onDownload, onExport, rerunActive, showAdvanced }: any) {
  const packageReady = Boolean(deliveryPackage?.download_url || deliveryPackage?.manifest?.download_url);
  return (
    <section className="commerce-card export-format">
      <h3>交付包</h3>
      {rerunActive ? <p>本轮生成中，结果完成后可导出。</p> : null}
      <div>
        <button data-action="export-delivery-package" disabled={rerunActive || !canExportFinal} type="button" onClick={() => onExport("delivery_package")}>导出交付包</button>
        <button data-action="download-delivery-package" disabled={!packageReady} type="button" onClick={onDownload}>下载交付包</button>
      </div>
      {showAdvanced ? (
        <details className="export-advanced-formats">
          <summary>高级导出格式</summary>
          <div>{exportFormats.map((item) => {
            const disabled = rerunActive || (["MP4", "MOV"].includes(item.label) ? !canExportFinal : item.type === "jianying_project_zip" ? !canExportJianying : false);
            return <button data-action={`export-${item.type}`} disabled={disabled} key={item.label} type="button" onClick={() => onExport(item.type)}>{item.label}</button>;
          })}</div>
        </details>
      ) : null}
    </section>
  );
}

function LiveClipResultPanel({ qaResult, response, result, showAdvanced }: any) {
  const hideCompletedResults = shouldHideLiveClipCompletedResults(result, response);
  const missing = response?.missing_inputs || result?.missing_inputs || [];
  const warnings = response?.warnings || result?.warnings || [];
  const nextAction = response?.next_action || result?.next_action || [];
  const segments = hideCompletedResults ? [] : (result?.slice_segments || []);
  const agentLogs = hideCompletedResults ? [] : (result?.logs?.agent_logs || []);
  const skillLogs = hideCompletedResults ? [] : (result?.logs?.skill_logs || []);
  const visibleQaResult = hideCompletedResults ? null : qaResult;
  const visibleAgentsCalled = hideCompletedResults ? [] : (result?.agents_called || []);
  const visibleSkillsCalled = hideCompletedResults ? [] : (result?.skills_called || []);
  const visibleRealRender = hideCompletedResults ? false : Boolean(result?.has_real_render);
  return (
    <section className="commerce-card live-result-panel" id="liveClipResultPanel">
      <div className="section-head">
        <h3>输出结果</h3>
        <span>{formatLiveClipStatus(response?.status || result?.status || "idle", "待开始")}</span>
      </div>
      <QASummaryPanel qa={visibleQaResult} showAdvanced={showAdvanced} />
      <LiveNoticePanel id="liveClipErrorPanel" missing={missing} nextAction={nextAction} warnings={warnings} />
      <DeliveryClipIndexPanel clips={segments} />
      <h4>成片 / final clips</h4>
      <div className="slice-card-grid">
        {segments.length
          ? segments.map((clip: any) => <SliceSegmentCard clip={clip} key={clip.slice_id || clip.clip_id} />)
          : <div className="empty-result">{hideCompletedResults ? "正在重新切片，本轮结果生成后再展示 QA 与成片结果。" : "暂无 slice_segments。无视频或缺少任务时必须返回 blocked，不生成假切片。"}</div>}
      </div>
      {showAdvanced ? (
        <details className="raw-json-panel" id="liveClipRawJsonPanel" open>
          <summary>高级信息：内部状态、日志与原始 JSON</summary>
          <div className="live-status-grid" id="liveClipStatusCard">
            <div><small>project_id</small><strong>{result?.project_id || "-"}</strong></div>
            <div><small>task_id</small><strong>{result?.task_id || "-"}</strong></div>
            <div><small>当前阶段</small><strong>{result?.current_step || response?.message || "等待开始"}</strong></div>
            <div><small>Agent 数量</small><strong>{visibleAgentsCalled.length || 0}</strong></div>
            <div><small>Skill</small><strong>{visibleSkillsCalled.join(" / ") || "-"}</strong></div>
            <div><small>FFmpeg</small><strong>{formatLiveClipStatus(result?.ffmpeg?.status, "检测中")}</strong></div>
            <div><small>真实成片</small><strong>{visibleRealRender ? "是" : "否"}</strong></div>
          </div>
          <LogPanel id="liveClipAgentLogPanel" items={agentLogs} title="Agent 调用日志" />
          <LogPanel id="liveClipSkillLogPanel" items={skillLogs} title="Skill 调用日志" />
          <pre>{JSON.stringify(response || {}, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}

function QASummaryPanel({ qa, showAdvanced }: any) {
  if (!qa) return <div className="qa-summary-panel" id="liveClipQaStatusPanel"><strong>QA 状态</strong><span>等待切片结果</span></div>;
  const failed = qa.qa_failed_items || [];
  const checks = qa.qa_checks || {};
  return (
    <div className="qa-summary-panel" id="liveClipQaStatusPanel">
      <div className="qa-summary-head">
        <strong>QA 状态：{formatLiveClipStatus(qa.qa_status, qa.qa_status || "-")}</strong>
        <span>{qa.qa_score || 0} 分｜失败 {failed.length} 项｜重试：{qa.qa_retry_required ? "是" : "否"}</span>
      </div>
      <p>{failed.length ? `需处理：${failed.map(formatLiveClipQaCheckLabel).join(" / ")}` : "QA 摘要通过，等待审核或导出交付包。"}</p>
      {showAdvanced ? <details className="qa-advanced-matrix" open>
        <summary>QA matrix 细节</summary>
        <p>归因 Agent：{qa.qa_failure_owner_agent || "-"}｜Skill：{qa.qa_failure_owner_skill || "-"}｜原因：{formatLiveClipFailureReason(qa)}</p>
        <div className="qa-check-grid">
          {Object.entries(checks).map(([key, value]) => <span className={value ? "ok" : "failed"} key={key}>{formatLiveClipQaCheckLabel(key)}：{formatLiveClipQaCheckValue(value)}</span>)}
        </div>
      </details> : null}
    </div>
  );
}

function DeliveryClipIndexPanel({ clips }: any) {
  const finalItems = (clips || []).map((clip: any) => ({
    clip_id: clip.clip_id || clip.slice_id,
    file: clip.render?.final_mp4 || clip.files?.final_clip || "",
  })).filter((item: any) => item.file);
  const subtitleItems = (clips || []).map((clip: any) => ({
    clip_id: clip.clip_id || clip.slice_id,
    file: clip.files?.subtitle || "",
  })).filter((item: any) => item.file);
  return (
    <div className="delivery-index-panel">
      <div>
        <strong>成片文件</strong>
        {finalItems.length ? finalItems.map((item: any) => <span key={`final-${item.clip_id}`}>{item.clip_id}：{item.file.split("/").pop()}</span>) : <span>等待生成成片文件</span>}
      </div>
      <div>
        <strong>字幕文件</strong>
        {subtitleItems.length ? subtitleItems.map((item: any) => <span key={`subtitle-${item.clip_id}`}>{item.clip_id}：{item.file.split("/").pop()}</span>) : <span>等待生成字幕文件</span>}
      </div>
    </div>
  );
}

function LiveNoticePanel({ id, missing, nextAction, warnings }: any) {
  if (!missing?.length && !warnings?.length && !nextAction?.length) return null;
  return (
    <div className="live-notice" id={id}>
      {missing?.length ? <p><strong>缺失项：</strong>{missing.map(formatLiveClipMissingInput).join(" / ")}</p> : null}
      {warnings?.length ? <p><strong>提示：</strong>{warnings.join("；")}</p> : null}
      {nextAction?.length ? <p><strong>建议操作：</strong>{nextAction.join("；")}</p> : null}
    </div>
  );
}

function SliceSegmentCard({ clip }: any) {
  const distribution = clip.distribution || {};
  const render = clip.render || {};
  const qa = clip.qa || {};
  const qaChecks = clip.qa_checks || qa.qa_checks || {};
  const failedItems = clip.qa_failed_items || qa.qa_failed_items || [];
  return (
    <article className="slice-card">
      <div className="slice-card-head"><strong>【{clip.slice_id || clip.clip_id}】{clip.title}</strong><span>{clip.score || clip.total_score || 0} 分</span></div>
      <p>时间：{clip.start_time} - {clip.end_time}｜时长：{clip.duration || clip.duration_seconds} 秒｜类型：{clip.segment_type}</p>
      <p><strong>Hook：</strong>{clip.hook}</p>
      <p><strong>摘要：</strong>{clip.summary}</p>
      <p><strong>原文摘录：</strong>{clip.transcript_excerpt}</p>
      <p><strong>选择原因：</strong>{clip.reason}</p>
      <p><strong>商品卖点：</strong>{(clip.selling_points || []).join(" / ") || "-"}</p>
      <p><strong>推荐平台：</strong>{(distribution.target_platforms || []).join(" / ") || "-"}</p>
      <p><strong>抖音标题：</strong>{distribution.douyin_title}</p>
      <p><strong>快手标题：</strong>{distribution.kuaishou_title}</p>
      <p><strong>视频号标题：</strong>{distribution.shipinhao_title}</p>
      <p><strong>小红书标题：</strong>{distribution.xiaohongshu_title}</p>
      <p><strong>视频文案：</strong>{distribution.video_caption}</p>
      <p><strong>话题标签：</strong>{(distribution.hashtags || []).join(" ")}</p>
      <p><strong>封面文案：</strong>{distribution.cover_text}</p>
      <p><strong>封面提示词：</strong>{distribution.cover_prompt}</p>
      <p><strong>风险提示：</strong>{(clip.risk_tips || []).join("；") || "无"}</p>
      <details className="slice-debug-details">
        <summary>切片高级信息</summary>
        <div className="render-box">
          <span>渲染状态：{formatLiveClipStatus(render.status, render.status || "-")}</span>
          <span>输出文件：{render.final_mp4 || "null"}</span>
          <span>文件存在：{render.file_exists ? "是" : "否"}</span>
          <span>文件大小：{render.file_size || 0}</span>
          <span>审核状态：{formatLiveClipStatus(clip.review_status, clip.review_status || "-")}</span>
          <span>质检：{formatLiveClipStatus(clip.qa_status || qa.qa_status || qa.status, clip.qa_status || qa.qa_status || qa.status || "-")} / {clip.qa_score || qa.qa_score || qa.score || 0}</span>
        </div>
        <div className="qa-check-grid compact">
          {Object.entries(qaChecks).map(([key, value]) => <span className={value ? "ok" : "failed"} key={key}>{formatLiveClipQaCheckLabel(key)}：{formatLiveClipQaCheckValue(value)}</span>)}
        </div>
        <p><strong>渲染日志：</strong>{sanitizeLiveClipText(render.render_log, render.render_log || "-")}</p>
        <p><strong>失败项：</strong>{failedItems.map(formatLiveClipQaCheckLabel).join(" / ") || "-"}</p>
        <p><strong>失败归因：</strong>{clip.qa_failure_owner_agent || qa.qa_failure_owner_agent || "-"} / {clip.qa_failure_owner_skill || qa.qa_failure_owner_skill || "-"}</p>
        <p><strong>重试建议：</strong>{clip.qa_retry_required || qa.qa_retry_required ? formatLiveClipFailureReason({ qa_failure_reason: clip.qa_failure_reason || qa.qa_failure_reason, qa_failed_items: failedItems }) : "-"}</p>
      </details>
    </article>
  );
}

function LogPanel({ id, items, title }: any) {
  return (
    <div className="live-log-panel" id={id}>
      <h4>{title}</h4>
      {items?.length ? items.map((item: any, index: number) => (
        <div className="log-row" key={`${id}-${index}`}>
          <strong>{item.agent_name || item.skill_name}</strong>
          <span>{formatLiveClipStatus(item.status, item.status || "-")}</span>
          <small>{formatLiveClipLogMessage(item) || sanitizeLiveClipText(item.provider, item.provider || "")}</small>
          {item.missing_inputs?.length ? <em>缺失：{item.missing_inputs.map(formatLiveClipMissingInput).join(" / ")}</em> : null}
        </div>
      )) : <p>暂无日志。</p>}
    </div>
  );
}

function BottomActionBar({ activeStep, busy, canExportFinal, deliveryReady, onAdvanced, onApprove, onDownload, onExport, onPreview, onReview, onRetry, onStart, qaPassed, qaRetryRequired, rerunActive, showAdvanced }: any) {
  const bar = getLiveClipBottomBarState({
    activeStep,
    busy,
    canExportFinal,
    qaPassed,
    qaRetryRequired,
    rerunActive,
  });
  return <footer className="commerce-bottom-bar"><button data-action="start-liveclip" id="btnLiveClipStart" disabled={bar.startDisabled} onClick={onStart} type="button">▶ {bar.startLabel}</button><button data-action="preview-liveclip" id="btnLiveClipPreview" disabled={bar.refreshDisabled} onClick={onPreview} type="button">查看预览</button><button data-action="rerun-liveclip" id="btnLiveClipPartialRedo" disabled={bar.retryDisabled} onClick={onRetry} type="button">局部重做</button><button data-action="submit-liveclip-review" id="btnLiveClipReview" disabled={bar.reviewDisabled} onClick={onReview} type="button">提交审核</button><button data-action="approve-liveclip" id="btnLiveClipApprove" disabled={bar.approveDisabled} onClick={onApprove} type="button">通过审核</button><button data-action="export-delivery-package" id="btnLiveClipExport" disabled={bar.exportDisabled} onClick={onExport} type="button">导出交付包</button><button data-action="download-delivery-package" id="btnLiveClipDownload" disabled={!deliveryReady} onClick={onDownload} type="button">下载交付包</button><button data-action="toggle-liveclip-advanced" id="btnLiveClipAdvanced" onClick={onAdvanced} type="button">{showAdvanced ? "收起高级信息" : "展开高级信息"}</button></footer>;
}
