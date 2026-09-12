import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("video workbench binds completed backend output to the preview player", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(source, /outputUrl/);
  assert.match(source, /<video/);
  assert.match(source, /resultUrl/);
assert.match(source, /controls[\s\S]*preload="metadata"[\s\S]*playsInline[\s\S]*aria-label="生成视频预览"/);
});
