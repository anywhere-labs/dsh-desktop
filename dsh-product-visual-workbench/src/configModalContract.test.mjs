import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL(".", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("DSH shell exposes a persistent provider configuration modal", async () => {
  const shell = await read("./components/OperationsShell.tsx");
  const app = await read("./main.tsx");
  assert.match(shell, /配置/);
  assert.match(shell, /ProviderConfigModal/);
  assert.match(app, /onConfigSaved/);
});

test("provider configuration modal uses the same-origin model provider API", async () => {
  const modal = await read("./components/ProviderConfigModal.tsx");
  assert.match(modal, /getImageProviderConfig/);
  assert.match(modal, /saveImageProviderConfig/);
  assert.match(modal, /validateImageProviderConfig/);
  assert.match(modal, /type=\"password\"/);
  assert.match(modal, /api_base/);
});

test("product visual page checks the sidecar before upload interaction", async () => {
  const client = await read("./api/client.ts");
  const page = await read("./pages/MaterialManagerPage.tsx");
  assert.match(client, /getProductVisualRuntime/);
  assert.match(page, /getProductVisualRuntime/);
});
