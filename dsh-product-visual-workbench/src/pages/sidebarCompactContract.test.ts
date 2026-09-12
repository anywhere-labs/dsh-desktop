// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readPage(name) {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

test("liveclip sidebar uses compact labels when collapsed", () => {
  const source = readPage("LiveClipPage.tsx");

  assert.match(source, /sidebarExpanded/);
  assert.match(source, /sidebar-expanded/);
  assert.match(source, /sidebar-collapsed/);
  assert.match(source, /className=\{sidebarExpanded \? "commerce-sidebar expanded" : "commerce-sidebar collapsed"\}/);
  assert.match(source, /className="sidebar-toggle"/);
  assert.match(source, /onMouseEnter=\{\(\) => setSidebarExpanded\(true\)\}/);
  assert.match(source, /onMouseLeave=\{\(\) => setSidebarExpanded\(false\)\}/);
  assert.match(source, /<em>\{label\}<\/em>/);
});

test("api settings sidebar uses compact labels when collapsed", () => {
  const source = readPage("ApiSettingsPage.tsx");

  assert.match(source, /sidebarExpanded/);
  assert.match(source, /sidebar-expanded/);
  assert.match(source, /sidebar-collapsed/);
  assert.match(source, /className=\{sidebarExpanded \? "commerce-sidebar expanded" : "commerce-sidebar collapsed"\}/);
  assert.match(source, /className="sidebar-toggle"/);
  assert.match(source, /onMouseEnter=\{\(\) => setSidebarExpanded\(true\)\}/);
  assert.match(source, /onMouseLeave=\{\(\) => setSidebarExpanded\(false\)\}/);
  assert.match(source, /<em>商品图与详情页<\/em>/);
  assert.match(source, /<em>直播切片分发<\/em>/);
  assert.match(source, /<em>系统设置<\/em>/);
});

test("workflow modules use the unified operations navigation", () => {
  const source = readSource("../main.tsx");
  const shell = readSource("../components/OperationsShell.tsx");
  const css = readSource("../style.css");

  assert.match(source, /OperationsShell/);
  assert.match(source, /PipelinePage/);
  assert.match(shell, /className="ops-sidebar"/);
  assert.match(shell, /工作流与 Prompt/);
  assert.match(shell, /日志审计/);
  assert.match(css, /\.ops-sidebar/);
  assert.match(css, /\.ops-nav button\.active/);
});
