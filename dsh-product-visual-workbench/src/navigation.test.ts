// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { dshHomeUrl } from "./navigation.ts";

test("returns to the DSH host root from the local workbench route", () => {
  assert.equal(dshHomeUrl("http://127.0.0.1:43120/product-visual-workbench/"), "http://127.0.0.1:43120/");
});

test("returns to the repository Pages root from the deployed workbench route", () => {
  assert.equal(dshHomeUrl("https://cucchia599.github.io/dsh-desktop/product-visual-workbench/"), "https://cucchia599.github.io/dsh-desktop/");
});
