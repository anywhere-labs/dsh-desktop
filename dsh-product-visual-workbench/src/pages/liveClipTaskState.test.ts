// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function loadPageModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./LiveClipPage.tsx", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

test("copywriting title candidates receive stable unique keys when text repeats", async () => {
  const page = await loadPageModule();
  const items = page.buildCopywritingTitleItems([
    "很多切片转化差，是因为开头没有打中痛点",
    "商品卖点要尽早出现",
    "很多切片转化差，是因为开头没有打中痛点",
  ]);

  assert.deepEqual(items.map((item) => item.title), [
    "很多切片转化差，是因为开头没有打中痛点",
    "商品卖点要尽早出现",
    "很多切片转化差，是因为开头没有打中痛点",
  ]);
  assert.equal(new Set(items.map((item) => item.key)).size, 3);
  assert.equal(items[0].key, "很多切片转化差，是因为开头没有打中痛点::1");
  assert.equal(items[2].key, "很多切片转化差，是因为开头没有打中痛点::2");
});

test("clears an invalid task id without clearing form or material state", async () => {
  const page = await loadPageModule();
  const stored = new Map([
    ["liveClipTaskId", "missing-task"],
    ["liveClipFileName", "source.mp4"],
  ]);
  let currentUrl = "http://localhost/live?view=liveclip&taskId=missing-task";
  let state = {
    accountId: "account-1",
    liveClipMaterialId: "material-1",
    liveClipTaskId: "missing-task",
  };
  const browser = {
    location: { href: currentUrl },
    localStorage: {
      removeItem(key: string) {
        stored.delete(key);
      },
    },
    history: {
      replaceState(_state: unknown, _title: string, url: string) {
        currentUrl = new URL(url, currentUrl).href;
      },
    },
  };

  assert.equal(page.isMissingLiveClipTask({ missing_inputs: ["task_id"] }), true);
  page.clearInvalidLiveClipTask(
    (update: (previous: typeof state) => typeof state) => {
      state = update(state);
    },
    browser,
  );

  assert.equal(stored.has("liveClipTaskId"), false);
  assert.equal(stored.get("liveClipFileName"), "source.mp4");
  assert.equal(new URL(currentUrl).searchParams.has("taskId"), false);
  assert.equal(new URL(currentUrl).searchParams.get("view"), "liveclip");
  assert.equal(state.liveClipTaskId, "");
  assert.equal(state.liveClipMaterialId, "material-1");
  assert.equal(state.accountId, "account-1");
});

test("does not allow final export when QA failed even with warnings", async () => {
  const page = await loadPageModule();

  assert.equal(page.canExportFinalByQa({
    qa_status: "failed",
    qa_warnings: ["subtitle warning"],
    qa_checks: { final_video_exists: true },
  }), false);
});

test("customer delivery state blocks approval and export until QA passes", async () => {
  const page = await loadPageModule();

  assert.deepEqual(page.getCustomerDeliveryState({
    taskId: "task-1",
    clipCount: 3,
    qaStatus: "failed",
    confirmed: false,
    busy: "",
    packageReady: false,
  }), {
    canApprove: false,
    canExport: false,
    canDownload: false,
  });
  assert.deepEqual(page.getCustomerDeliveryState({
    taskId: "task-1",
    clipCount: 3,
    qaStatus: "passed",
    confirmed: true,
    busy: "",
    packageReady: true,
  }), {
    canApprove: false,
    canExport: true,
    canDownload: true,
  });
});

test("customer generation keeps processing feedback until completed clips exist", async () => {
  const page = await loadPageModule();

  assert.equal(page.shortLiveClipTaskId("1234567890abcdef"), "12345678");
  assert.equal(page.shouldShowLiveClipResults("processing", 10), false);
  assert.equal(page.shouldShowLiveClipResults("completed", 0), false);
  assert.equal(page.shouldShowLiveClipResults("completed", 3), true);
  assert.equal(page.getLiveClipGenerationMessage({
    status: "processing",
    clipCount: 0,
    startedStatus: "processing",
    t: page.liveClipI18n.zh,
  }), "已开始生成，正在等待结果。");
  assert.equal(page.getLiveClipGenerationMessage({
    status: "completed",
    clipCount: 3,
    startedStatus: "processing",
    t: page.liveClipI18n.zh,
  }), "结果已生成，可以查看和下载。");
});

test("customer generation blocks duplicate starts for local or backend running state", async () => {
  const page = await loadPageModule();

  assert.equal(page.shouldBlockLiveClipGeneration({ busy: "generate", batchStatus: "" }), true);
  assert.equal(page.shouldBlockLiveClipGeneration({ busy: "", batchStatus: "processing" }), true);
  assert.equal(page.shouldBlockLiveClipGeneration({ busy: "", batchStatus: "running" }), true);
  assert.equal(page.shouldBlockLiveClipGeneration({ busy: "", batchStatus: "completed" }), false);
});

test("customer QA panel shows business issue and local retry without technical owners", async () => {
  const page = await loadPageModule();
  const html = renderToStaticMarkup(React.createElement(page.CustomerQAResultPanel, {
    qa: {
      status: "failed",
      summary: ["字幕需要处理"],
      issues: [{
        issue_id: "issue-1",
        clip_id: "clip-1",
        problem: "字幕可读性需要处理",
        reason: "字幕遮挡商品主体。",
        time_range: { start: 1, end: 3 },
        action_label: "重新生成这条视频的字幕包装",
        can_retry: true,
      }],
    },
    busy: "",
    onRetry: () => undefined,
    t: page.liveClipI18n.zh,
  }));

  assert.match(html, /字幕可读性需要处理/);
  assert.match(html, /00:01–00:03/);
  assert.match(html, /按质检建议局部重做/);
  assert.doesNotMatch(html, /Agent|Skill|FFmpeg|attempt|revision/);
});

test("customer QA maps blocked missing inputs to readable actions without success marks", async () => {
  const page = await loadPageModule();
  const qa = page.normalizeCustomerQaResponse({
    status: "failed",
    summary: ["直播切片任务被阻塞，请按 missing_inputs 补齐。"],
    message: "直播切片任务被阻塞，请按 missing_inputs 补齐。",
    next_action: "直播切片任务被阻塞，请按 missing_inputs 补齐。",
    missing_inputs: ["speech_transcription_provider"],
  });

  assert.deepEqual(qa.summary, ["请补齐真实字幕或上传 SRT 后再继续。"]);
  assert.deepEqual(qa.next_action, ["请补齐真实字幕或上传 SRT 后再继续。"]);
  const html = renderToStaticMarkup(React.createElement(page.CustomerQAResultPanel, {
    qa,
    busy: "",
    onRetry: () => undefined,
    t: page.liveClipI18n.zh,
  }));

  assert.match(html, /⚠ 请补齐真实字幕或上传 SRT 后再继续。/);
  assert.doesNotMatch(html, /✔ 直播切片任务被阻塞|missing_inputs/);
});

test("customer version panel presents business versions and restore action", async () => {
  const page = await loadPageModule();
  const html = renderToStaticMarkup(React.createElement(page.CustomerVersionPanel, {
    summary: {
      current_version: 3,
      versions: [{ version: 3, status: "已通过质检", change: "重新生成字幕包装", is_current: true }],
      can_restore_previous: true,
    },
    busy: "",
    onRestore: () => undefined,
    t: page.liveClipI18n.zh,
  }));

  assert.match(html, /当前版本 3/);
  assert.match(html, /重新生成字幕包装/);
  assert.match(html, /恢复上一版本/);
  assert.doesNotMatch(html, /repair-secret|attempt_id|internal_sidecars/);
});

test("customer plan versions show reasons and only non-current passed versions can become main", async () => {
  const page = await loadPageModule();
  const html = renderToStaticMarkup(React.createElement(page.CustomerPlanVersionPanel, {
    versions: [
      { version_id: "v1", name: "细节卖点版", reason: "口播证据完整", qa_status: "passed", is_current: true },
      { version_id: "v2", name: "成交转化版", reason: "价格信息集中", qa_status: "passed", is_current: false },
    ],
    busy: "",
    onActivate: () => undefined,
    t: page.liveClipI18n.zh,
  }));

  assert.match(html, /细节卖点版/);
  assert.match(html, /口播证据完整/);
  assert.match(html, /当前主版本/);
  assert.match(html, /设为主版本/);
  assert.doesNotMatch(html, /variant_id|internal_sidecars|render_consumed/);
});

test("mounts transcript workspace only when a task id exists", async () => {
  const page = await loadPageModule();

  assert.equal(page.shouldMountTranscriptWorkspace(""), false);
  assert.equal(page.shouldMountTranscriptWorkspace(undefined), false);
  assert.equal(page.shouldMountTranscriptWorkspace("task-1"), true);
});

test("prefers upload warnings over message when building liveclip upload failure feedback", async () => {
  const page = await loadPageModule();

  assert.equal(
    page.getLiveClipUploadFailureMessage({
      warnings: ["仅支持扩展名与 MIME 匹配的 MP4 / MOV / FLV / TS 视频。"],
      message: "上传失败",
    }),
    "仅支持扩展名与 MIME 匹配的 MP4 / MOV / FLV / TS 视频。",
  );
  assert.equal(
    page.getLiveClipUploadFailureMessage({
      warnings: [],
      message: "上传失败",
    }),
    "上传失败",
  );
  assert.equal(
    page.getLiveClipUploadFailureMessage({}),
    "视频上传失败，请检查网络后重试。",
  );
});

test("formats legacy mojibake actions and qa labels into readable chinese", async () => {
  const page = await loadPageModule();

  assert.equal(page.formatLiveClipMissingInput("real_rendered_mp4"), "真实成片 MP4");
  assert.equal(page.formatLiveClipQaCheckLabel("video_playable"), "视频可播放");
  assert.equal(page.formatLiveClipQaCheckValue(false), "未通过");
  assert.equal(
    page.formatLiveClipLogMessage({ status: "blocked", message: "璋冪敤鏈畬鎴愭垨琚樆濉?" }),
    "调用未完成或被阻塞。",
  );
  assert.deepEqual(
    page.formatLiveClipNextActions(
      ["涓婁紶鐪熷疄 MP4 / MOV / FLV 鐩存挱瑙嗛鍚庡啀寮€濮嬪垏鐗囥€?"],
      ["video", "real_rendered_mp4"],
    ),
    ["请先上传直播视频素材。", "请检查 FFmpeg 与真实成片渲染状态。"],
  );
});

test("formats blocked transcript warnings and logs into readable chinese", async () => {
  const page = await loadPageModule();

  assert.deepEqual(
    page.formatLiveClipWarnings([
      "Real speech transcription failed: FunASR GPU 转写失败，且 faster-whisper fallback 已禁用：No module named 'soundfile'",
    ]),
    ["真实语音转写失败： FunASR GPU 转写失败，且 faster-whisper fallback 已禁用：缺少 soundfile 依赖"],
  );
  assert.equal(
    page.formatLiveClipLogMessage({
      agent_name: "LiveClipTranscriptAgent",
      status: "blocked",
      message: "",
    }),
    "真实语音转写不可用。",
  );
});

test("keeps active progress at transcript stage when transcription is blocked", async () => {
  const page = await loadPageModule();

  assert.equal(
    page.deriveLiveClipActiveStep(
      {
        progress_steps: [
          { key: "LiveClipTranscriptAgent", status: "blocked" },
          { key: "LiveClipShotDetectAgent", status: "waiting" },
          { key: "LiveClipHotspotAgent", status: "waiting" },
          { key: "LiveClipSegmentPlannerAgent.select", status: "waiting" },
          { key: "LiveClipRenderSkill.basic_ffmpeg", status: "waiting" },
        ],
        slice_segments: [],
      },
      { liveClipTaskId: "task-1", liveClipMaterialId: "material-1" },
    ),
    1,
  );
});

test("hides stale completed result content while rerun batch is active", async () => {
  const page = await loadPageModule();

  assert.equal(
    page.shouldHideLiveClipCompletedResults(
      {
        status: "running",
        batch_state: { status: "running" },
        slice_segments: [{ clip_id: "clip_01" }],
        qa_result: { qa_status: "passed" },
        has_real_render: true,
      },
      { status: "running" },
    ),
    true,
  );
});

test("keeps completed result content visible after rerun has finished", async () => {
  const page = await loadPageModule();

  assert.equal(
    page.shouldHideLiveClipCompletedResults(
      {
        status: "ok",
        batch_state: { status: "completed" },
        slice_segments: [{ clip_id: "clip_01" }],
        qa_result: { qa_status: "passed" },
        has_real_render: true,
      },
      { status: "ok" },
    ),
    false,
  );
});

test("hides stale candidate and preview content while rerun batch is active", async () => {
  const page = await loadPageModule();
  const result = {
    status: "running",
    batch_state: { status: "running" },
    slice_segments: [{ clip_id: "clip_01", title: "旧成片", distribution: { video_caption: "旧文案" } }],
    qa_result: { qa_status: "passed" },
    has_real_render: true,
  };
  const response = { status: "running" };

  assert.deepEqual(page.getVisibleLiveClipSegments(result, response), []);
  assert.equal(page.getVisibleLiveClipSelectedClip(result, response, "clip_01"), undefined);
  assert.equal(page.shouldDisableLiveClipExports(result, response), true);
});

test("keeps candidate and preview content visible after rerun is completed", async () => {
  const page = await loadPageModule();
  const result = {
    status: "ok",
    batch_state: { status: "completed" },
    slice_segments: [{ clip_id: "clip_01", title: "新成片", distribution: { video_caption: "新文案" } }],
    qa_result: { qa_status: "passed" },
    has_real_render: true,
  };
  const response = { status: "ok" };

  assert.equal(page.getVisibleLiveClipSegments(result, response).length, 1);
  assert.equal(page.getVisibleLiveClipSelectedClip(result, response, "clip_01")?.clip_id, "clip_01");
  assert.equal(page.shouldDisableLiveClipExports(result, response), false);
});

test("bottom action bar treats rerun as in-progress and disables stale completed actions", async () => {
  const page = await loadPageModule();

  assert.deepEqual(
    page.getLiveClipBottomBarState({
      busy: "",
      canExportFinal: true,
      qaPassed: true,
      qaRetryRequired: false,
      rerunActive: true,
    }),
    {
      startLabel: "切片中...",
      startDisabled: true,
      refreshDisabled: false,
      reviewDisabled: true,
      retryDisabled: true,
      approveDisabled: true,
      exportDisabled: true,
    },
  );
});

test("customer task keeps polling until a terminal status so generated previews appear", async () => {
  const page = await loadPageModule();

  assert.equal(page.shouldPollLiveClipCustomerTask("processing"), true);
  assert.equal(page.shouldPollLiveClipCustomerTask("uploaded"), true);
  assert.equal(page.shouldPollLiveClipCustomerTask("completed"), false);
  assert.equal(page.shouldPollLiveClipCustomerTask("failed"), false);
  assert.equal(page.shouldPollLiveClipCustomerTask("blocked"), false);
});

test("customer task stops polling after repeated transport failures", async () => {
  const page = await loadPageModule();

  assert.equal(page.shouldRetryLiveClipCustomerPoll(0), true);
  assert.equal(page.shouldRetryLiveClipCustomerPoll(2), true);
  assert.equal(page.shouldRetryLiveClipCustomerPoll(3), false);
  assert.equal(page.shouldRetryLiveClipCustomerPoll(99), false);
});

test("liveclip customer page rejects product visual task ids", async () => {
  const page = await loadPageModule();

  assert.equal(page.isLiveClipTaskId("pv_49e6322f4883449fa7"), false);
  assert.equal(page.isLiveClipTaskId("6732ac4d5b8e4b9c8dbe80f5262b0ddf"), true);
  assert.equal(page.isLiveClipTaskId(""), false);
});
