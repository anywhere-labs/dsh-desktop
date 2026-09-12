import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("DSH product visual host proxies model provider configuration to the sidecar", async () => {
  const source = await readFile(new URL("../src/product-visual-route.ts", import.meta.url), "utf8");
  assert.match(source, /ROUTE_CONFIG\s*=\s*['"]\/api\/config['"]/);
  assert.match(source, /path:\s*ROUTE_CONFIG/);
});

test("DSH product visual host proxies the dashboard API used by the workbench", async () => {
  const source = await readFile(new URL("../src/product-visual-route.ts", import.meta.url), "utf8");
  assert.match(source, /['"]\/api\/dashboard['"]/);
  assert.match(source, /ROUTE_BACKEND_PREFIXES\.map/);
});
