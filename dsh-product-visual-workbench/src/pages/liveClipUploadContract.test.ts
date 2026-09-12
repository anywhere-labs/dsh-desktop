// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
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


test("declares the explicit MP4 MOV FLV and TS picker contract", async () => {
  const page = await loadModule("./LiveClipPage.tsx");

  assert.equal(
    page.LIVE_CLIP_VIDEO_ACCEPT,
    ".mp4,.mov,.flv,.ts,video/mp4,video/quicktime,video/x-flv,video/mp2t",
  );
});


test("validates extension and ten gigabyte size before upload", async () => {
  const page = await loadModule("./LiveClipPage.tsx");
  const tenGb = 10 * 1024 * 1024 * 1024;

  assert.deepEqual(
    page.validateLiveClipVideoFile({ name: "source.MOV", size: tenGb }),
    { valid: true, message: "" },
  );
  assert.equal(
    page.validateLiveClipVideoFile({ name: "source.webm", size: 100 }).valid,
    false,
  );
  assert.equal(
    page.validateLiveClipVideoFile({ name: "source.mp4", size: tenGb + 1 }).valid,
    false,
  );
});


test("replaces and revokes local object URLs deterministically", async () => {
  const page = await loadModule("./LiveClipPage.tsx");
  const revoked: string[] = [];
  const urlApi = {
    createObjectURL(file: any) {
      return `blob:${file.name}`;
    },
    revokeObjectURL(value: string) {
      revoked.push(value);
    },
  };

  const next = page.replaceLiveClipObjectUrl(
    "blob:old.mp4",
    { name: "new.mp4" },
    urlApi,
  );
  page.releaseLiveClipObjectUrl(next, urlApi);

  assert.equal(next, "blob:new.mp4");
  assert.deepEqual(revoked, ["blob:old.mp4", "blob:new.mp4"]);
});


test("always restores upload busy state after success or failure", async () => {
  const page = await loadModule("./LiveClipPage.tsx");
  const successStates: string[] = [];
  const failureStates: string[] = [];

  const value = await page.withLiveClipUploadBusy(
    (state: string) => successStates.push(state),
    async () => "ok",
  );
  await assert.rejects(
    page.withLiveClipUploadBusy(
      (state: string) => failureStates.push(state),
      async () => {
        throw new Error("network down");
      },
    ),
    /network down/,
  );

  assert.equal(value, "ok");
  assert.deepEqual(successStates, ["upload", ""]);
  assert.deepEqual(failureStates, ["upload", ""]);
});


test("encodes task ids for upload and source thumbnail URLs", async () => {
  const client = await loadModule("../api/client.ts");
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await client.uploadLiveClipTaskVideo(
      "task /1",
      "account",
      new File(["video"], "source.mp4", { type: "video/mp4" }),
    );
    assert.equal(
      client.getLiveClipSourceThumbnailUrl("task /1"),
      "/api/live-clips/tasks/task%20%2F1/source-thumbnail",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    calls[0],
    "/api/live-clips/tasks/task%20%2F1/upload",
  );
});

test("encodes task ids for activate-variant requests", async () => {
  const client = await loadModule("../api/client.ts");
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await client.activateLiveClipVariant(
      "task /1",
      "template::douyin_live_conversion_clip_v1",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    calls[0],
    "/api/live-clips/tasks/task%20%2F1/variants/activate",
  );
});


test("sends explicit source-burned subtitle choice with customer upload", async () => {
  const client = await loadModule("../api/client.ts");
  let uploadedForm: FormData | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: any, init: any) => {
    uploadedForm = init.body;
    return new Response(JSON.stringify({ status: "uploaded", task_id: "task-1" }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await client.uploadLiveClipCustomerVideo({
      file: new File(["video"], "source.mp4", { type: "video/mp4" }),
      title: "直播主题",
      product: "桑蚕丝连衣裙",
      direction: "商品卖点",
      platform: "抖音",
      sourceHasBurnedSubtitles: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(uploadedForm?.get("source_has_burned_subtitles"), "true");
});


test("exposes the apparel packaging preset as the recommended default", async () => {
  const page = await loadModule("./LiveClipPage.tsx");

  assert.equal(
    page.DEFAULT_LIVE_CLIP_CAPTION_STYLE,
    "douyin_apparel_detail_conversion_v1",
  );
  assert.deepEqual(page.LIVE_CLIP_CAPTION_STYLE_OPTIONS, [
    {
      value: "douyin_apparel_detail_conversion_v1",
      label: "抖音女装细节转化 V1",
    },
    {
      value: "douyin_apparel_fabric_detail_v1",
      label: "抖音女装面料细节 V1",
    },
    {
      value: "douyin_apparel_compare_review_v1",
      label: "抖音女装对比测评 V1",
    },
    {
      value: "douyin_live_conversion_clip_v1",
      label: "抖音直播转化切片 V1",
    },
  ]);
});


test("fills the complete upload card with the uploaded video frame", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../style.css", import.meta.url)),
    "utf8",
  );

  assert.match(css, /\.commerce-upload\.has-source-preview\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.source-preview-media\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s);
  assert.match(css, /\.source-preview-media (?:video,\s*)?[\s\S]*?img\s*\{[^}]*object-fit:\s*cover/s);
  assert.match(css, /\.commerce-upload\.has-source-preview \.source-file-name\s*\{[^}]*position:\s*absolute/s);
});
