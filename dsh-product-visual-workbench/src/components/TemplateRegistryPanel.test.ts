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
    hook_within_seconds: 3,
    benefit_conclusion_required: true,
  },
  {
    id: "douyin_live_conversion_clip_v1",
    name: "抖音直播转化切片 V1",
    version: "1.2.0",
    duration_range: [35, 55],
    overlay_count_range: [3, 5],
    sfx_count_range: [2, 4],
    hook_within_seconds: 3,
    benefit_conclusion_required: true,
  },
];

test("renders template registry cards and selected template rules", async () => {
  const component = await loadModule("./TemplateRegistryPanel.tsx");
  const html = renderToStaticMarkup(React.createElement(component.TemplateRegistryPanel, {
    items,
    selectedId: "douyin_apparel_detail_conversion_v1",
    onSelect: () => undefined,
  }));

  assert.match(html, /抖音女装细节转化 V1/);
  assert.match(html, /抖音直播转化切片 V1/);
  assert.match(html, /4-6 个花字/);
  assert.match(html, /3-5 个轻音效/);
  assert.match(html, /30-45 秒/);
  assert.match(html, /3 秒内钩子/);
  assert.match(html, /利益结论/);
});


test("exported helpers normalize list items and expose the selected template", async () => {
  const component = await loadModule("./TemplateRegistryPanel.tsx");
  const normalized = component.normalizeTemplateItems(items);
  const selected = component.resolveSelectedTemplate(items, "douyin_live_conversion_clip_v1");

  assert.equal(normalized[0].overlayLabel, "4-6 个花字");
  assert.equal(normalized[0].durationLabel, "30-45 秒");
  assert.equal(normalized[0].hookLabel, "3 秒内钩子");
  assert.equal(selected?.id, "douyin_live_conversion_clip_v1");
});
