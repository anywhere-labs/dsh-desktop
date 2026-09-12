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

test("new platform preset targets the Codox XaaS API base and keeps key entry open", async () => {
  const page = await loadPageModule();

  assert.deepEqual(page.buildCustomProviderForm({ api_key: "old-key" }), {
    provider: "codox",
    api_base: "https://codox-xaas.tidescend.com",
    model: "gpt-image-2",
    text_model: "gpt-4.1-mini",
    vision_model: "gpt-4.1-mini",
    api_key: "",
  });
});

test("normalizes Codox root URL to v1 OpenAI-compatible endpoints", async () => {
  const page = await loadPageModule();

  assert.equal(
    page.buildProviderApiBase("codox", "https://codox-xaas.tidescend.com/"),
    "https://codox-xaas.tidescend.com/v1",
  );
});
