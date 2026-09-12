// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("declares an existing favicon instead of requesting missing favicon.ico", () => {
  const frontendRoot = fileURLToPath(new URL("../../", import.meta.url));
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
  assert.doesNotThrow(() => readFileSync(`${frontendRoot}public/favicon.svg`, "utf8"));
});

test("disables the dev HMR socket for BFCache-safe browser sessions", () => {
  const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  assert.match(viteConfig, /hmr:\s*false/);
});

test("provides valid workbench metadata for browser integrations", () => {
  const frontendRoot = fileURLToPath(new URL("../../", import.meta.url));
  const metadata = JSON.parse(readFileSync(`${frontendRoot}public/meta.json`, "utf8"));
  assert.equal(metadata.name, "短视频增长 Agent OS");
  assert.equal(metadata.lang, "zh-CN");
});
