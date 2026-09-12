// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadPageModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./ApiSettingsPage.tsx", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

test("uses Codox affiliate registration as the default platform API link", async () => {
  const page = await loadPageModule();

  assert.equal(
    page.PLATFORM_API_REGISTER_URL,
    "https://www.codox.cc/register?aff=HZLATWKYAP7P",
  );
});
