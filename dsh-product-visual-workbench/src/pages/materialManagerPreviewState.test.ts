// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadPageModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./MaterialManagerPage.tsx", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

test("does not keep fallback preview assets when result lookup is blocked", async () => {
  const page = await loadPageModule();
  const previousPreview = {
    main_images: [{ id: "main_001", name: "old fallback", url: "/old.svg" }],
    detail_pages: [],
    generation_meta: { fallback: true, fallback_reason: "commercial_provider_failed" },
  };

  const nextPreview = page.buildProductVisualPreviewState(previousPreview, {
    status: "blocked",
    missing_inputs: ["result"],
    data: { status: "failed" },
  });

  assert.equal(nextPreview.main_images.length, 0);
  assert.equal(nextPreview.detail_pages.length, 0);
  assert.equal(nextPreview.generation_meta?.fallback, false);
  assert.equal(nextPreview.generation_meta?.blocked_reason, "result_missing");
});

test("formats invalid image API key errors as operator action instead of raw vendor JSON", async () => {
  const page = await loadPageModule();

  assert.equal(
    page.formatProductVisualRunError('APIMart image API failed: 401 {"error":{"message":"invalid API key","type":"apimart_error"}}'),
    "APIMart 图片生成认证失败：API Key 无效。请到系统设置更新 APIMart Key 后重新生成。",
  );
  assert.equal(
    page.formatProductVisualProviderWarning({
      fallback: true,
      fallback_reason: "commercial_provider_failed",
      fallback_error: 'APIMart image API failed: 401 {"error":{"message":"invalid API key","type":"apimart_error"}}',
    }),
    "真实 API 生成失败，已切换本地 fallback。APIMart 图片生成认证失败：API Key 无效。请到系统设置更新 APIMart Key 后重新生成。",
  );
});

test("formats blocked upload responses into actionable operator messages", async () => {
  const page = await loadPageModule();
  assert.equal(page.formatProductVisualUploadError({ status: "blocked", missing_inputs: ["logo_transparency"] }), "品牌 LOGO 必须是透明镂空 PNG 或 SVG。");
  assert.equal(page.formatProductVisualUploadError({ status: "blocked", missing_inputs: ["image_format"] }), "图片格式不支持，请上传 PNG、JPG、WEBP 或透明 SVG。");
});

test("uses the latest server asset snapshot instead of merging stale upload state", async () => {
  const page = await loadPageModule();
  const latest = page.mergeProductVisualAssets([
    { asset_type: "input_image_2", file_name: "new-product.png", url: "/new-product.png" },
  ]);
  assert.equal(latest.input_image_2.file_name, "new-product.png");
});

test("marks mock/fallback previews as non-commercial templates", async () => {
  const page = await loadPageModule();

  assert.equal(page.isProductVisualFallbackPreview({
    fallback: true,
    generation_mode: "local_mock",
    fallback_reason: "commercial_provider_failed",
  }), true);
  assert.equal(page.isProductVisualFallbackPreview({
    fallback: false,
    generation_mode: "commercial_concurrent",
    active_provider: "apimart",
  }), false);
  assert.equal(page.isProductVisualFallbackPreview({ fallback: true, generation_mode: "commercial_concurrent" }), false);
});

test("exposes fixed product visual input slots and output order", async () => {
  const page = await loadPageModule();

  assert.deepEqual(page.productVisualInputSlots.map((slot) => [slot.key, slot.label]), [
    ["input_image_1", "图一：品牌LOGO"],
    ["input_image_2", "图二：商品图"],
    ["input_image_3", "图三：模特图"],
    ["input_image_4", "图四：细节/尺码参考"],
  ]);

  assert.deepEqual(page.productVisualOutputPlan, [
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
  ]);
});

test("keeps start generation actionable while reporting missing product assets", async () => {
  const page = await loadPageModule();

  assert.equal(page.canStartProductVisualGeneration({ product_name: "连衣裙", target_platform: "douyin" }, {}), true);
  assert.deepEqual(page.getMissingProductVisualStartRequirements({ product_name: "连衣裙", target_platform: "douyin" }, {
    input_image_1: { asset_id: "asset_1" },
  }), ["图二：商品图", "图三：模特图"]);
  assert.deepEqual(page.getMissingProductVisualStartRequirements({ product_name: "连衣裙", target_platform: "douyin" }, {
    input_image_1: { asset_id: "asset_1" },
    input_image_2: { asset_id: "asset_2" },
    input_image_3: { asset_id: "asset_3" },
  }), []);
});

test("formats strategy scores from result data and reference standards without list numbering", async () => {
  const page = await loadPageModule();

  assert.deepEqual(page.buildClickStrategyItems({
    product_recognition: 91,
    selling_point_front: 76,
    thumbnail_readability: 83,
    competitor_difference: 69,
  }), [
    { key: "product_recognition", label: "商品识别度", score: 91, level: "优秀" },
    { key: "selling_point_front", label: "卖点前置", score: 76, level: "良好" },
    { key: "thumbnail_readability", label: "缩略图可读性", score: 83, level: "优秀" },
    { key: "competitor_difference", label: "竞品差异化", score: 69, level: "待优化" },
  ]);

  const standards = page.productVisualReferenceStandards.flatMap((group) => group.items);
  assert.equal(standards.length, 17);
  assert.equal(standards.some((item) => /^\d+[.、\s]/.test(item)), false);
  assert.equal(standards.some((item) => item.includes("单模特多场景")), true);
  assert.equal(standards.some((item) => item.includes("茶室") && item.includes("通勤")), true);
});

test("formats platform rule score dimensions and asset evidence", async () => {
  const page = await loadPageModule();
  assert.deepEqual(page.buildPlatformScoreItems({
    exposure_fit: 88,
    click: 84,
    value_understanding: 86,
    conversion: 87,
  }), [
    { key: "exposure_fit", label: "平台曝光适配", score: 88, level: "优秀" },
    { key: "click", label: "点击吸引力", score: 84, level: "优秀" },
    { key: "value_understanding", label: "商品价值理解", score: 86, level: "优秀" },
    { key: "conversion", label: "购买转化承接", score: 87, level: "优秀" },
  ]);
  assert.equal(page.formatPlatformScoreSummary({ platform: "douyin", overall: 86, rule_version: "douyin_product_visual_v2" }), "抖音平台规则评分 86/100 · 规则 douyin_product_visual_v2");
});

test("exposes platform upload ratio options and low-density main-image guidance", async () => {
  const page = await loadPageModule();
  assert.deepEqual(page.productVisualPlatformOptions.map((item) => item.value), ["douyin", "kuaishou", "xhs", "shipinhao"]);
  assert.equal(page.formatPlatformRuleNotice({
    platform_label: "抖音",
    main_upload_ratio: "3:4",
    detail_upload_ratio: "9:16",
    logo_max_width_ratio: 0.1,
    main_image_text_density: "low",
    verification_status: "confirmed_from_reference",
  }), "抖音主图 3:4 · 详情页 9:16 · LOGO不超过10% · 主图低信息密度");
});

test("formats incremental product visual generation progress", async () => {
  const page = await loadPageModule();

  assert.equal(page.formatProductVisualGenerationProgress({
    completed: 4,
    total: 17,
    phase_label: "主图生成中",
    display_text: "主图生成中 · 已完成 4/17",
  }), "主图生成中 · 已完成 4/17");

  assert.equal(page.formatProductVisualGenerationProgress({
    completed: 12,
    total: 17,
    phase_label: "详情页生成中",
  }), "详情页生成中 · 已完成 12/17");
});

test("status poller prevents overlapping requests", async () => {
  const page = await loadPageModule();
  let resolveRequest;
  let requestCount = 0;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const poller = page.createProductVisualStatusPoller({
    fetchStatus: async () => {
      requestCount += 1;
      return request;
    },
    onStatus: () => undefined,
    onError: () => undefined,
    schedule: () => 1,
    clearSchedule: () => undefined,
  });

  const first = poller.pollNow();
  const overlapping = await poller.pollNow();
  assert.equal(requestCount, 1);
  assert.equal(overlapping, false);

  resolveRequest({ status: "ok", data: { progress: 35 } });
  await first;
  poller.stop();
});

test("status poller catches failures, backs off, and recovers", async () => {
  const page = await loadPageModule();
  const scheduled = [];
  const errors = [];
  const statuses = [];
  let attempt = 0;
  const poller = page.createProductVisualStatusPoller({
    fetchStatus: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary 500");
      return { status: "ok", data: { progress: 41 } };
    },
    onStatus: (status) => statuses.push(status),
    onError: (message) => errors.push(message),
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearSchedule: () => undefined,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
  });

  await poller.pollNow();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /状态查询暂时失败/);
  assert.equal(scheduled[0].delay, 2000);

  await scheduled.shift().callback();
  assert.deepEqual(statuses, [{ progress: 41 }]);
  assert.equal(scheduled[0].delay, 1000);
  poller.stop();
});

test("task snapshot surfaces transport failures for the page to handle", async () => {
  const page = await loadPageModule();

  await assert.rejects(
    page.loadProductVisualTaskSnapshot(
      "pv-1",
      async () => { throw new Error("frontend unavailable"); },
      async () => ({ status: "ok", data: {} }),
    ),
    /frontend unavailable/,
  );
});
