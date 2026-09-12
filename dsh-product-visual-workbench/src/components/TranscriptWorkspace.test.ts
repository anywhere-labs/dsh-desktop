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

const segments = [
  { start: 0, end: 1.2, text: "第一句", sequence_no: 1, emphasis_tags: ["hook"], hook_candidate: true },
  { start: 1.5, end: 3, text: "第二句", sequence_no: 2, emphasis_tags: ["detail"] },
  { start: 4, end: 6, text: "第三句", sequence_no: 3, emphasis_tags: ["benefit"] },
];

test("builds a complete revision-checked edit payload", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const edited = workspace.editTranscriptSegment(segments, 1, "text", "修改后");

  assert.deepEqual(workspace.buildTranscriptUpdatePayload(7, edited), {
    revision: 7,
    segments: [
      segments[0],
      { start: 1.5, end: 3, text: "修改后", sequence_no: 2, emphasis_tags: ["detail"] },
      segments[2],
    ],
  });
});

test("merges selected rows using first start, last end, and joined text", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");

  assert.deepEqual(workspace.mergeTranscriptSegments(segments, [0, 1]), [
    { start: 0, end: 3, text: "第一句 第二句" },
    segments[2],
  ]);
});

test("rejects merging non-contiguous first and third rows", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");

  assert.throws(
    () => workspace.mergeTranscriptSegments(segments, [0, 2]),
    /只能合并连续字幕/,
  );
});

test("deletes selected transcript rows", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  assert.deepEqual(workspace.deleteTranscriptSegments(segments, [1]), [
    segments[0],
    segments[2],
  ]);
});

test("splits one row at text and timeline midpoint", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const source = [{ start: 2, end: 6, text: "前半部分 后半部分" }];

  assert.deepEqual(workspace.splitTranscriptSegment(source, 0), [
    { start: 2, end: 4, text: "前半部分" },
    { start: 4, end: 6, text: "后半部分" },
  ]);
});

test("rejects splitting a segment shorter than two milliseconds", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  assert.throws(
    () => workspace.splitTranscriptSegment([{ start: 0, end: 0.001, text: "前后" }], 0),
    /2ms/,
  );
  assert.deepEqual(
    workspace.splitTranscriptSegment([{ start: 0, end: 0.002, text: "前后" }], 0),
    [
      { start: 0, end: 0.001, text: "前" },
      { start: 0.001, end: 0.002, text: "后" },
    ],
  );
});

test("safe split keeps data and returns a visible error", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const source = [{ start: 0, end: 0.001, text: "前后" }];
  assert.deepEqual(workspace.trySplitTranscriptSegment(source, 0), {
    segments: source,
    error: "字幕片段至少需要 2ms 才能拆分",
  });
});

test("validates editable transcript timestamps before save", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  assert.equal(workspace.validateEditableSegments(segments), "");
  assert.match(workspace.validateEditableSegments([{ start: -1, end: 1, text: "bad" }]), /非负/);
  assert.match(workspace.validateEditableSegments([{ start: 1, end: 1, text: "bad" }]), /结束时间/);
  assert.match(workspace.validateEditableSegments([
    { start: 2, end: 3, text: "later" },
    { start: 1, end: 2, text: "earlier" },
  ]), /时间顺序/);
});

test("request generation guard rejects stale async responses", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const guard = workspace.createRequestGenerationGuard();
  const first = guard.next("task-1");
  assert.equal(guard.isCurrent(first), true);
  const second = guard.next("task-2");
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test("empty numeric edits do not silently become zero", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  assert.deepEqual(
    workspace.editTranscriptSegment(segments, 0, "start", ""),
    segments,
  );
});

test("accepts a successful revision update and preserves conflict state", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const initial = { revision: 3, segments, conflict: false };
  const success = workspace.applyTranscriptMutation(initial, {
    status: "ok",
    data: { revision: 4, segments: [segments[0]] },
  });
  const conflict = workspace.applyTranscriptMutation(success, {
    status: "blocked",
    missing_inputs: ["transcript_revision"],
    data: { current_revision: 5 },
  });

  assert.deepEqual(success, {
    revision: 4,
    segments: [segments[0]],
    conflict: false,
  });
  assert.deepEqual(conflict, {
    revision: 4,
    segments: [segments[0]],
    conflict: true,
  });
});

test("builds normalize payload with revision and merge gap", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  assert.deepEqual(workspace.buildTranscriptNormalizePayload(9, 500), {
    revision: 9,
    merge_gap_ms: 500,
  });
});

test("request builders preserve save revision and default normalize gap", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");

  assert.deepEqual(workspace.buildTranscriptUpdateRequest("task-1", 6, segments), {
    taskId: "task-1",
    body: { revision: 6, segments },
  });
  assert.deepEqual(workspace.buildTranscriptNormalizeRequest("task-1", 6), {
    taskId: "task-1",
    body: { revision: 6, merge_gap_ms: 500 },
  });
  assert.deepEqual(workspace.buildTranscriptRerenderRequest("task-1", 8), {
    taskId: "task-1",
    body: { revision: 8 },
  });
  assert.deepEqual(
    workspace.buildTranscriptRerenderRequest(
      "task-1",
      8,
      [
        "douyin_apparel_detail_conversion_v1",
        "douyin_live_conversion_clip_v1",
      ],
      "douyin_live_conversion_clip_v1",
    ),
    {
      taskId: "task-1",
      body: {
        revision: 8,
        template_ids: [
          "douyin_apparel_detail_conversion_v1",
          "douyin_live_conversion_clip_v1",
        ],
        active_template_id: "douyin_live_conversion_clip_v1",
      },
    },
  );
});

test("response reducer records conflicts without replacing local transcript", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const current = { revision: 6, segments, conflict: false };

  assert.deepEqual(workspace.reduceTranscriptResponse(current, {
    status: "blocked",
    missing_inputs: ["transcript_revision"],
    data: { current_revision: 7, segments: [{ start: 0, end: 1, text: "remote" }] },
  }), { revision: 6, segments, conflict: true });
});

test("view renders loading, blocked, ready, and conflict states", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const callbacks = {
    onDelete: () => undefined,
    onEdit: () => undefined,
    onMerge: () => undefined,
    onNormalize: () => undefined,
    onRefresh: () => undefined,
    onRerender: () => undefined,
    onSave: () => undefined,
    onSelect: () => undefined,
    onSplit: () => undefined,
    onMergeGapChange: () => undefined,
  };
  const render = (props: any) => renderToStaticMarkup(React.createElement(workspace.TranscriptWorkspaceView, {
    busy: "",
    conflict: false,
    mergeGapMs: 500,
    message: "",
    revision: 3,
    segments: [],
    selected: [],
    status: "loading",
    taskId: "task-1",
    ...callbacks,
    ...props,
  }));

  assert.match(render({ status: "loading" }), /正在读取字幕状态/);
  assert.match(render({ status: "blocked", message: "暂无转写结果" }), /暂无转写结果/);

  const ready = render({ status: "ok", segments });
  assert.match(ready, /id="liveClipTranscriptWorkspace"/);
  for (const heading of ["选择", "序号", "开始", "结束", "时长", "间隔ms", "文案", "操作"]) {
    assert.match(ready, new RegExp(heading));
  }
  assert.match(ready, /字幕时间线概览/);
  assert.match(ready, /重新包装成片/);
  assert.match(ready, /hook/);
  assert.match(ready, /detail/);
  assert.match(ready, /benefit/);
  assert.match(ready, /1\.200s/);

  const conflict = render({ status: "ok", conflict: true, segments });
  assert.match(conflict, /字幕已被其他操作更新/);
  assert.match(conflict, />刷新</);
  assert.match(
    render({ status: "ok", message: "包装层已重新生成，请重新提交审核。", segments }),
    /重新提交审核/,
  );

  const busy = render({ status: "ok", busy: "save", segments });
  assert.match(busy, /disabled=""/);
  assert.doesNotMatch(
    render({ status: "blocked", message: "暂无转写结果" }),
    /导出 TXT/,
  );
});

test("builds real TXT and SRT export URLs", async () => {
  const client = await loadModule("../api/client.ts");
  assert.equal(
    client.getLiveClipTranscriptExportUrl("task 1", "txt"),
    "/api/live-clips/tasks/task%201/transcript/export/txt",
  );
  assert.equal(
    client.getLiveClipTranscriptExportUrl("task 1", "srt"),
    "/api/live-clips/tasks/task%201/transcript/export/srt",
  );
  assert.equal(
    client.getLiveClipTranscriptExportUrl("task 1", "ass"),
    "/api/live-clips/tasks/task%201/transcript/export/ass",
  );
  assert.equal(
    client.getLiveClipTranscriptExportUrl("task 1", "timeline"),
    "/api/live-clips/tasks/task%201/transcript/export/timeline",
  );
  assert.equal(
    typeof client.rerenderLiveClipTranscript,
    "function",
  );
});

test("view disables transcript actions and exports during rerun", async () => {
  const workspace = await loadModule("./TranscriptWorkspace.tsx");
  const html = renderToStaticMarkup(
    React.createElement(workspace.TranscriptWorkspaceView, {
      busy: "",
      conflict: false,
      mergeGapMs: 500,
      message: "",
      onDelete() {},
      onEdit() {},
      onMerge() {},
      onMergeGapChange() {},
      onNormalize() {},
      onRefresh() {},
      onRerender() {},
      onSave() {},
      onSelect() {},
      onSplit() {},
      rerunActive: true,
      revision: 1,
      segments: [{ start: 0, end: 1, text: "a", sequence_no: 1 }],
      selected: [],
      status: "ok",
      taskId: "task-1",
    }),
  );

  assert.match(html, /本轮生成中/);
  assert.match(html, /字幕编辑与重新包装暂时锁定，待本轮结果完成后恢复/);
  assert.doesNotMatch(html, /Revision 1/);
  assert.match(html, /本轮生成中，字幕编辑与重新包装暂时锁定/);
  assert.doesNotMatch(html, /导出 TXT/);
  assert.match(html, /重新包装成片/);
  assert.match(html, /disabled/);
});
