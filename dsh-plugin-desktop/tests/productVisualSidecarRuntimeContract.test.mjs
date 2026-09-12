import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("product visual sidecar supports a stable user-level Python runtime", async () => {
  const source = await readFile(new URL("../src/product-visual-sidecar.ts", import.meta.url), "utf8");
  assert.match(source, /from 'node:os'/);
  assert.match(source, /\.dsh\/product-visual-venv\/bin\/python/);
});
