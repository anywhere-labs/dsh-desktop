// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadModule(relativePath: string) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

const items = [
  {
    id: "douyin_apparel_detail_conversion_v1",
    name: "抖音女装细节转化 V1",
    version: "1.2.0",
    duration_range: [30, 45],
    overlay_count_range: [4, 6],
    sfx_count_range: [3, 5],
  },
  {
    id: "douyin_live_conversion_clip_v1",
    name: "抖音直播转化切片 V1",
    version: "1.2.0",
    duration_range: [35, 55],
    overlay_count_range: [3, 5],
    sfx_count_range: [2, 4],
  },
];

const variants = [
  {
    variant_id: "template::douyin_apparel_detail_conversion_v1",
    template_id: "douyin_apparel_detail_conversion_v1",
    template_name: "抖音女装细节转化 V1",
    template_version: "1.2.0",
    review_status: "not_submitted",
    recommended_rank: 2,
    summary: {
      clip_count: 3,
      overlay_points: 5,
      sfx_points: 4,
      qa_status: "passed",
      qa_score: 96,
    },
  },
  {
    variant_id: "template::douyin_live_conversion_clip_v1",
    template_id: "douyin_live_conversion_clip_v1",
    template_name: "抖音直播转化切片 V1",
    template_version: "1.2.0",
    review_status: "pending_review",
    recommended_rank: 1,
    recommended_reason: "更适合转化型直播",
    summary: {
      clip_count: 2,
      overlay_points: 3,
      sfx_points: 2,
      qa_status: "passed",
      qa_score: 92,
    },
  },
];

test("builds compare cards with variant metrics and previous-version fallback", async () => {
  const component = await loadModule("./LiveClipVariantComparePanel.tsx");
  const compareItems = component.buildVariantCompareItems(
    items,
    variants,
    "template::douyin_live_conversion_clip_v1",
  );
  const previousVariantId = component.resolvePreviousVariantId(
    "template::douyin_live_conversion_clip_v1",
    [
      "template::douyin_apparel_detail_conversion_v1",
      "template::douyin_live_conversion_clip_v1",
    ],
  );

  assert.equal(compareItems.length, 2);
  assert.equal(compareItems[0].variantId, "template::douyin_apparel_detail_conversion_v1");
  assert.equal(compareItems[1].isActive, true);
  assert.equal(compareItems[1].qaLabel, "QA 92");
  assert.deepEqual(compareItems[0].summaryChips, ["3条切片", "5个花字", "4个音效"]);
  assert.equal(previousVariantId, "template::douyin_apparel_detail_conversion_v1");
});

test("renders compare panel cards, active state, recommendation, and fallback action", async () => {
  const component = await loadModule("./LiveClipVariantComparePanel.tsx");
  const html = renderToStaticMarkup(
    React.createElement(component.LiveClipVariantComparePanel, {
      items,
      variants,
      activeVariantId: "template::douyin_live_conversion_clip_v1",
      variantHistory: [
        "template::douyin_apparel_detail_conversion_v1",
        "template::douyin_live_conversion_clip_v1",
      ],
      busy: false,
      onActivate: () => undefined,
      onFallback: () => undefined,
    }),
  );

  assert.match(html, /多模板对比/);
  assert.match(html, /抖音女装细节转化 V1/);
  assert.match(html, /抖音直播转化切片 V1/);
  assert.match(html, /当前主版本/);
  assert.match(html, /推荐 1/);
  assert.match(html, /更适合转化型直播/);
  assert.match(html, /回退上一个版本/);
  assert.match(html, /设为主版本/);
});

test("freezes compare panel activation controls during rerun", async () => {
  const component = await loadModule("./LiveClipVariantComparePanel.tsx");
  const html = renderToStaticMarkup(
    React.createElement(component.LiveClipVariantComparePanel, {
      activeVariantId: "template::template-a",
      busy: false,
      items: [{ id: "template-a", name: "模板A", version: "1.2.0" }],
      onActivate: () => undefined,
      onFallback: () => undefined,
      rerunActive: true,
      variantHistory: ["template::template-b", "template::template-a"],
      variants: [],
    }),
  );

  assert.match(html, /本轮包装生成中，暂不切换主版本/);
  assert.match(html, /本轮生成中/);
  assert.doesNotMatch(html, /设为主版本/);
  assert.doesNotMatch(html, /回退上一个版本/);
});
