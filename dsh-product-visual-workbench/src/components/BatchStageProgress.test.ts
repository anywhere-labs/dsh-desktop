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

const stages = {
  transcribing: { status: "completed", progress: 100, attempts: 1 },
  planning: { status: "completed", progress: 100, attempts: 1 },
  rendering: { status: "failed", progress: 35, attempts: 2, error: "ffmpeg timeout" },
  qa: { status: "pending", progress: 0, attempts: 0 },
  exporting: { status: "pending", progress: 0, attempts: 0 },
};

test("normalizes the persistent batch response", async () => {
  const component = await loadModule("./BatchStageProgress.tsx");
  assert.deepEqual(component.normalizeBatchResponse({
    status: "ok",
    data: {
      progress_percent: 47,
      batch_state: { status: "failed", current_stage: "rendering", stages },
    },
  }), {
    status: "failed",
    currentStage: "rendering",
    progressPercent: 47,
    stages,
  });
});

test("renders ordered stages and only the valid failed-state action", async () => {
  const component = await loadModule("./BatchStageProgress.tsx");
  const html = renderToStaticMarkup(React.createElement(component.BatchStageProgressView, {
    busy: "",
    error: "",
    job: {
      status: "failed",
      currentStage: "rendering",
      progressPercent: 47,
      stages,
    },
    onAction: () => undefined,
    onRefresh: () => undefined,
  }));

  for (const label of ["字幕转写", "切片规划", "视频渲染", "质量检查", "工程导出"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /47%/);
  assert.match(html, /ffmpeg timeout/);
  assert.match(html, /重试失败阶段/);
  assert.doesNotMatch(html, />暂停</);
  assert.doesNotMatch(html, />继续</);
});

test("maps queued, running, and paused states to truthful controls", async () => {
  const component = await loadModule("./BatchStageProgress.tsx");
  assert.deepEqual(component.availableBatchActions("queued"), ["pause"]);
  assert.deepEqual(component.availableBatchActions("running"), ["pause"]);
  assert.deepEqual(component.availableBatchActions("pausing"), []);
  assert.deepEqual(component.availableBatchActions("paused"), ["resume"]);
  assert.deepEqual(component.availableBatchActions("failed"), ["retry"]);
  assert.deepEqual(component.availableBatchActions("completed"), []);
});

