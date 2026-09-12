const API_BASE = (import.meta as any).env?.VITE_API_BASE || "";

export async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) return res.json();
  return { status: res.ok ? "ok" : "failed", message: await res.text() };
}

export async function postJson(path: string, body: unknown) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function putJson(path: string, body: unknown) {
  return api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function uploadMaterial(accountId: string, scriptId: string, file: File) {
  const form = new FormData();
  form.append("account_id", accountId);
  form.append("script_id", scriptId);
  form.append("file_type", "video");
  form.append("file", file);
  return api("/api/material/upload", { method: "POST", body: form });
}

export async function createTask(body: unknown) {
  return postJson("/api/tasks", body);
}

export async function runTask(taskId: string) {
  return postJson(`/api/tasks/${taskId}/run`, {});
}

export async function getTaskResult(taskId: string) {
  return api(`/api/tasks/${taskId}/result`);
}

export async function submitTaskReview(taskId: string) {
  return postJson(`/api/tasks/${taskId}/review`, {});
}

export async function exportTask(taskId: string, exportType: string) {
  return postJson(`/api/tasks/${taskId}/export`, { export_type: exportType });
}

export async function checkFfmpeg() {
  return api("/api/tasks/ffmpeg-check");
}

export async function createProductVisualTask(body: unknown) {
  return postJson("/api/product-visual/tasks", body);
}

export async function saveProductVisualDraft(taskId: string, body: unknown) {
  return postJson(`/api/product-visual/tasks/${taskId}/draft`, body);
}

export async function uploadProductVisualAsset(taskId: string, assetType: string, file: File) {
  const form = new FormData();
  form.append("asset_type", assetType);
  form.append("file", file);
  return api(`/api/product-visual/tasks/${taskId}/assets`, { method: "POST", body: form });
}

export async function runProductVisualTask(taskId: string) {
  return postJson(`/api/product-visual/tasks/${taskId}/run`, {});
}

export async function getProductVisualStatus(taskId: string) {
  return api(`/api/product-visual/tasks/${taskId}/status`);
}

export async function getProductVisualResult(taskId: string) {
  return api(`/api/product-visual/tasks/${taskId}/result`);
}

export async function getProductVisualRuntime() {
  return api("/api/product-visual/runtime");
}

export async function refreshProductVisualTitles(taskId: string) {
  return postJson(`/api/product-visual/tasks/${taskId}/titles/refresh`, {});
}

export async function reviewProductVisualTask(taskId: string, body = { action: "submit", comment: "商品主图与详情页初稿已生成，提交审核。" }) {
  return postJson(`/api/product-visual/tasks/${taskId}/review`, body);
}

export async function exportProductVisualTask(taskId: string, formats = ["image_zip", "copywriting_package", "json_fields"]) {
  return postJson(`/api/product-visual/tasks/${taskId}/export`, { formats });
}

export async function retryProductVisualAsset(taskId: string, assetTaskId: string) {
  return postJson(`/api/product-visual/tasks/${taskId}/asset-tasks/${assetTaskId}/retry`, {});
}

export async function recordProductVisualFeedback(taskId: string, body: unknown) {
  return postJson(`/api/product-visual/tasks/${taskId}/feedback`, body);
}

export async function getProductVisualFeedback(taskId: string) {
  return api(`/api/product-visual/tasks/${taskId}/feedback`);
}

export async function createLiveClipTask(body: unknown) {
  return postJson("/api/live-clips/tasks", body);
}

export async function uploadLiveClipTaskVideo(taskId: string, accountId: string, file: File) {
  const form = new FormData();
  form.append("account_id", accountId);
  form.append("file", file);
  return api(`/api/live-clips/tasks/${encodeURIComponent(taskId)}/upload`, { method: "POST", body: form });
}

export function getLiveClipSourceThumbnailUrl(taskId: string) {
  return `/api/live-clips/tasks/${encodeURIComponent(taskId)}/source-thumbnail`;
}

export async function uploadLiveClipTaskSubtitle(taskId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return api(`/api/live-clips/tasks/${taskId}/subtitle`, { method: "POST", body: form });
}

export async function runLiveClipTask(taskId: string) {
  return postJson(`/api/live-clips/tasks/${taskId}/run`, {});
}

export async function getLiveClipStatus(taskId: string) {
  return api(`/api/live-clips/tasks/${taskId}/status`);
}

export async function getLiveClipClips(taskId: string) {
  return api(`/api/live-clips/tasks/${taskId}/clips`);
}

export async function getLiveClipResult(taskId: string) {
  return api(`/api/live-clips/tasks/${taskId}/result`);
}

export async function getLiveClipTemplates() {
  return api("/api/live-clips/templates");
}

export async function getLiveClipBatch(taskId: string) {
  return api(`/api/live-clips/tasks/${encodeURIComponent(taskId)}/batch`);
}

export async function controlLiveClipBatch(
  taskId: string,
  action: "pause" | "resume" | "retry",
) {
  return postJson(
    `/api/live-clips/tasks/${encodeURIComponent(taskId)}/batch/${action}`,
    {},
  );
}

export async function getLiveClipTranscript(taskId: string) {
  return api(`/api/live-clips/tasks/${encodeURIComponent(taskId)}/transcript`);
}

export async function updateLiveClipTranscript(taskId: string, body: unknown) {
  return putJson(`/api/live-clips/tasks/${encodeURIComponent(taskId)}/transcript`, body);
}

export async function normalizeLiveClipTranscript(taskId: string, body: unknown) {
  return postJson(`/api/live-clips/tasks/${encodeURIComponent(taskId)}/transcript/normalize`, body);
}

export async function rerenderLiveClipTranscript(taskId: string, body: unknown) {
  return postJson(`/api/live-clips/tasks/${encodeURIComponent(taskId)}/transcript/rerender`, body);
}

export async function activateLiveClipVariant(taskId: string, variantId: string) {
  return postJson(`/api/live-clips/tasks/${encodeURIComponent(taskId)}/variants/activate`, {
    variant_id: variantId,
  });
}

export function getLiveClipTranscriptExportUrl(taskId: string, format: "txt" | "srt" | "ass" | "timeline") {
  return `${API_BASE}/api/live-clips/tasks/${encodeURIComponent(taskId)}/transcript/export/${format}`;
}

export async function reviewLiveClipTask(taskId: string) {
  return postJson(`/api/live-clips/tasks/${taskId}/review`, {});
}

export async function saveLiveClipTask(taskId: string) {
  return postJson(`/api/live-clips/tasks/${taskId}/save`, {});
}

export async function mockPassLiveClipTask(taskId: string) {
  return postJson(`/api/live-clips/tasks/${taskId}/review/mock-pass`, {});
}

export async function approveLiveClipJob(taskId: string, body = { reviewer: "客户审核", comment: "" }) {
  return postJson(`/api/liveclip/jobs/${encodeURIComponent(taskId)}/approve`, body);
}

export async function createLiveClipDeliveryPackage(taskId: string) {
  return postJson(`/api/liveclip/jobs/${encodeURIComponent(taskId)}/delivery-package`, {});
}

export function getLiveClipDeliveryPackageDownloadUrl(packageId: string) {
  return `${API_BASE}/api/liveclip/delivery-packages/${encodeURIComponent(packageId)}/download`;
}

export async function exportLiveClipTask(taskId: string, exportType: string) {
  return postJson(`/api/live-clips/tasks/${taskId}/export`, { export_type: exportType });
}

export async function captionEnhanceLiveClip(clipId: string) {
  return postJson(`/api/live-clips/clips/${clipId}/caption-enhance`, {});
}

export async function getImageProviderConfig() {
  return api("/api/config/model-provider");
}

export async function saveImageProviderConfig(body: unknown) {
  return postJson("/api/config/model-provider", body);
}

export async function validateImageProviderConfig() {
  return postJson("/api/config/model-provider/validate", {});
}

export async function probeTextModel(model: string) {
  return postJson("/api/config/model-provider/probe", { model });
}

export async function uploadLiveClipCustomerVideo(payload: {
  file: File;
  title: string;
  product: string;
  direction: string;
  platform: string;
  sourceHasBurnedSubtitles?: boolean;
}) {
  const form = new FormData();
  form.append("file", payload.file);
  form.append("title", payload.title);
  form.append("product", payload.product);
  form.append("direction", payload.direction);
  form.append("platform", payload.platform);
  form.append("source_has_burned_subtitles", String(Boolean(payload.sourceHasBurnedSubtitles)));
  return api("/api/liveclip/upload", { method: "POST", body: form });
}

export async function preflightLiveClipCustomerVideo(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api("/api/liveclip/preflight", { method: "POST", body: form });
}

export async function startLiveClipCustomerTask(taskId: string) {
  return postJson("/api/liveclip/start", { task_id: taskId });
}

export async function getLiveClipCustomerStatus(taskId: string) {
  return api(`/api/liveclip/status?task_id=${encodeURIComponent(taskId)}`);
}

export async function getLiveClipCustomerResult(taskId: string) {
  return api(`/api/liveclip/result?task_id=${encodeURIComponent(taskId)}`);
}

export async function getLiveClipCustomerSubtitle(taskId: string, clipId: string) {
  return api(`/api/liveclip/tasks/${encodeURIComponent(taskId)}/clips/${encodeURIComponent(clipId)}/subtitle`);
}

export async function getLiveClipCustomerCopywriting(taskId: string, clipId: string) {
  return api(`/api/liveclip/tasks/${encodeURIComponent(taskId)}/clips/${encodeURIComponent(clipId)}/copywriting`);
}

export async function getLiveClipCustomerQa(taskId: string) {
  return api(`/api/liveclip/qa?task_id=${encodeURIComponent(taskId)}`);
}

export async function getLiveClipCustomerRepairSummary(taskId: string) {
  return api(`/api/liveclip/tasks/${encodeURIComponent(taskId)}/repair-summary`);
}

export async function repairLiveClipCustomerIssue(taskId: string, clipId: string, issueId: string) {
  return postJson(
    `/api/liveclip/tasks/${encodeURIComponent(taskId)}/clips/${encodeURIComponent(clipId)}/repair`,
    { issue_id: issueId },
  );
}

export async function restoreLiveClipCustomerPrevious(taskId: string, clipId: string) {
  return postJson(`/api/liveclip/tasks/${encodeURIComponent(taskId)}/restore-previous`, { clip_id: clipId });
}

export async function activateLiveClipCustomerVersion(taskId: string, versionId: string) {
  return postJson(
    `/api/liveclip/tasks/${encodeURIComponent(taskId)}/versions/${encodeURIComponent(versionId)}/activate`,
    {},
  );
}

export async function approveLiveClipCustomerTask(taskId: string) {
  return postJson("/api/liveclip/approve", { task_id: taskId });
}

export async function exportLiveClipCustomerPackage(taskId: string) {
  return postJson("/api/liveclip/export", { task_id: taskId });
}

export async function getLiveClipCustomerLogs(taskId: string) {
  return api(`/api/liveclip/logs?task_id=${encodeURIComponent(taskId)}`);
}
