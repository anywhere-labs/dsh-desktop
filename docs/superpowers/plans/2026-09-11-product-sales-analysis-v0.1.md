# Product Sales Analysis V0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one real, auditable V0.1 product-sales-analysis loop from a Doudian browser capture or deterministic fixture to a reviewed insight card and decision.

**Architecture:** Keep the existing Electron + React + DSH Runtime boundary. Add the narrowest Product Sales Analysis capability behind typed Commerce contracts, using the existing local Commerce service and event/evidence primitives. The Doudian browser connector remains read-only; deterministic fixtures provide repeatable CI coverage, while one live browser run is a separate acceptance evidence path.

**Tech Stack:** TypeScript, Node.js, React, Zod, Vitest, existing Cordis web server and DSH Desktop composition boundaries.

**Spec:** `D:\新建文件夹 (2)\docs\superpowers\specs\2026-09-11-ai-commerce-os-commercial-architecture-design.md`, `D:\新建文件夹 (2)\docs\commerce-os\api-ui-map.md`, `D:\新建文件夹 (2)\docs\commerce-os\architecture.md`, `D:\新建文件夹 (2)\docs\commerce-os\data-collection-layer.md`

## Global Constraints

- Code source is `E:\deepseek harness 桌面端`; product documents and launcher remain under `D:\新建文件夹 (2)`.
- Use Electron + React + DSH Runtime for V0.1; do not introduce Tauri migration work.
- Never edit `deepseek-harness/`; use the existing DSH Adapter/composition boundary.
- V0.1 Product is the only complete business module; other navigation entries remain explicit scaffolds.
- Doudian browser access is read-only; no login automation, publish, price change, order, refund, message, or delete action.
- Default mode is Local Only. Hybrid requires explicit Model Router configuration; credentials never enter model input, logs, or evidence.
- Data must pass Data Quality Gate before metric calculation or Agent analysis.
- Agent output is `ready_for_review` / `未审核` until Evaluator passes and a human reviewer accepts or modifies it.
- Preserve the existing dirty worktree; do not reset, clean, or commit unrelated user changes.

---

### Task 1: Record the repository audit and baseline gap matrix

**Files:**
- Create: `docs/commerce-os/v0.1-product-sales-audit.md`
- Test: `scripts/verify-layout.mjs` (read-only verification only)

**Interfaces:**
- Consumes: current Git status, existing Commerce source/tests, the four product documents.
- Produces: a dated audit listing implemented, partial, blocked, and not-started requirements without claiming unverified runtime behavior.

- [ ] **Step 1: Write the audit document** with the exact current baseline: 154 dirty worktree entries, existing Commerce runtime/event/approval tests, missing workspace package link, Rollup optional dependency blocker, and the V0.1 gaps.
- [ ] **Step 2: Verify the document is truthful** by checking each claimed command/result against fresh command output.
- [ ] **Step 3: Keep the audit additive** and do not modify existing product or runtime code in this task.

### Task 2: Repair workspace dependency resolution without changing behavior

**Files:**
- Modify: `package.json` only if the workspace declaration is incorrect after inspection.
- Modify: `yarn.lock` only if `corepack yarn install --immutable` requires the lockfile update.
- Test: `enterprise-agent-runtime/tests/runtime.spec.ts`, `dsh-plugin-commerce-ops/tests/contracts.spec.ts`

**Interfaces:**
- Consumes: `enterprise-agent-runtime` package exports and `dsh-plugin-commerce-ops` imports.
- Produces: a reproducible workspace install/build path where Commerce resolves `enterprise-agent-runtime` from the workspace package.

- [ ] **Step 1: Run `corepack yarn install --immutable` and capture the first failure.**
- [ ] **Step 2: Inspect the workspace link and package exports; do not delete `node_modules` or lockfiles.**
- [ ] **Step 3: Add the smallest package-manager correction needed.**
- [ ] **Step 4: Run `corepack yarn workspace enterprise-agent-runtime build`.**
- [ ] **Step 5: Run `corepack yarn workspace dsh-plugin-commerce-ops typecheck`.**

### Task 3: Add Product Sales Analysis contracts and the Data Quality Gate

**Files:**
- Create: `dsh-plugin-commerce-ops/src/product-sales/contracts.ts`
- Create: `dsh-plugin-commerce-ops/src/product-sales/data-quality.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-contracts.spec.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-data-quality.spec.ts`

**Interfaces:**
- Consumes: `zod`, existing Workspace and Evidence ID conventions.
- Produces: `ProductSalesWindow`, `ProductSalesRecord`, `DataQualityResult`, and `validateProductSalesInput(input)`.

- [ ] **Step 1: Write failing tests** for required fields, two complete seven-day windows, missing critical data, low sample handling, and evidence references.
- [ ] **Step 2: Run the focused tests and verify they fail because the contracts/functions are absent.**
- [ ] **Step 3: Implement the minimal Zod contracts and quality gate.**
- [ ] **Step 4: Enforce `visitors < 100 || orders < 10` as `SAMPLE_INSUFFICIENT`, not anomaly.**
- [ ] **Step 5: Run the focused tests and then the existing contracts tests.**

### Task 4: Implement deterministic metric and anomaly calculation

**Files:**
- Create: `dsh-plugin-commerce-ops/src/product-sales/metrics.ts`
- Create: `dsh-plugin-commerce-ops/src/product-sales/anomaly.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-metrics.spec.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-anomaly.spec.ts`

**Interfaces:**
- Consumes: validated `ProductSalesRecord` from Task 3.
- Produces: `calculateSalesMetrics(record)` and `detectSalesAnomalies(metrics)` with facts, formulas, thresholds, and sample status.

- [ ] **Step 1: Write failing tests** for seven-day comparisons, 20% sales/orders threshold, 15% conversion threshold, growth/no anomaly, and sample insufficiency.
- [ ] **Step 2: Run focused tests and verify expected failures.**
- [ ] **Step 3: Implement exact percentage calculations with no model involvement.**
- [ ] **Step 4: Return explicit `normal`, `anomaly`, or `sample_insufficient` status.**
- [ ] **Step 5: Run focused and regression tests.**

### Task 5: Build the structured insight card and Evaluator

**Files:**
- Create: `dsh-plugin-commerce-ops/src/product-sales/insight-card.ts`
- Create: `dsh-plugin-commerce-ops/src/product-sales/evaluator.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-insight-card.spec.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-evaluator.spec.ts`

**Interfaces:**
- Consumes: validated data, metrics, anomaly result, Evidence refs, and Model Router result.
- Produces: `ProductInsightCard` and `evaluateInsightCard(card)`.

- [ ] **Step 1: Write failing tests** asserting facts/calculations/inferences/recommendations are separate and unverified output is `ready_for_review` / `未审核`.
- [ ] **Step 2: Run tests and verify failure.**
- [ ] **Step 3: Implement the card schema with product, periods, metrics, anomaly, evidence, model run, decision proposal, and next human action.**
- [ ] **Step 4: Implement Evaluator checks for source linkage, formula correctness, threshold correctness, sample rules, evidence integrity, and read-only recommendations.**
- [ ] **Step 5: Run focused tests and verify invalid cards are rejected or marked `partial`.**

### Task 6: Add fixture collection and read-only browser evidence contracts

**Files:**
- Create: `dsh-plugin-commerce-ops/src/product-sales/fixtures.ts`
- Modify: `dsh-plugin-commerce-ops/src/connectors/browser-capture.ts` only through its existing read-only boundary.
- Test: `dsh-plugin-commerce-ops/tests/product-sales-fixture.spec.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-browser-evidence.spec.ts`

**Interfaces:**
- Consumes: existing browser capture contracts and Product Sales contracts.
- Produces: one deterministic single-SKU fixture, ten-SKU fixture set, and a `BrowserEvidence` record with URL, title, capture time, snapshot/hash, run ID, and trace ID but no credentials.

- [ ] **Step 1: Write failing tests** for one-SKU and ten-SKU fixture shape, evidence fields, credential redaction, and read-only capability declaration.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement fixtures and evidence normalization.**
- [ ] **Step 4: Add explicit failure states for login required, page unavailable, and extraction failure.**
- [ ] **Step 5: Run focused tests and existing browser tests.**

### Task 7: Compose the Product Analysis service and API routes

**Files:**
- Create: `dsh-plugin-commerce-ops/src/product-sales/service.ts`
- Modify: `dsh-plugin-commerce-ops/src/host/commerce-ops-service.ts`
- Modify: `dsh-plugin-commerce-ops/src/host/routes.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-service.spec.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-routes.spec.ts`

**Interfaces:**
- Consumes: Tasks 3–6, existing event ledger, persistence, approvals, and service wiring.
- Produces: `runProductSalesAnalysis(input)` and typed local routes for fixture execution, live browser capture handoff, insight retrieval, and review transition.

- [ ] **Step 1: Write failing service tests** for one-SKU success, missing input, sample insufficiency, and evidence failure.
- [ ] **Step 2: Write failing route tests** for input validation, `ApiEnvelope`, trace/request IDs, and honest status mapping.
- [ ] **Step 3: Run focused tests and verify failure.**
- [ ] **Step 4: Implement the service composition without calling a model directly; use a Model Router interface or deterministic replay adapter.**
- [ ] **Step 5: Persist Task/Execution/Evidence/Event links and return `ready_for_review` until review.**
- [ ] **Step 6: Run focused tests and existing host route tests.**

### Task 8: Wire the Commerce UI Product surface and review flow

**Files:**
- Create: `dsh-plugin-commerce-ops/src/client/ProductSalesAnalysis.tsx`
- Modify: `dsh-plugin-commerce-ops/src/client/api.ts`
- Modify: `dsh-plugin-commerce-ops/src/client/App.tsx`
- Modify: `dsh-plugin-commerce-ops/src/client/styles.css`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-ui-contract.spec.ts`

**Interfaces:**
- Consumes: typed routes and `ProductInsightCard` from Tasks 5 and 7.
- Produces: Product surface with Collection Run, Data Quality, Insight Card, Evidence, review action, and honest loading/empty/error/blocked states.

- [ ] **Step 1: Write failing UI contract tests** for API-to-view mapping, `ready_for_review` / `未审核`, evidence display, and review transitions.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement the smallest Product surface and typed actions.**
- [ ] **Step 4: Ensure other navigation items remain scaffold states.**
- [ ] **Step 5: Run focused tests and build the client.**

### Task 9: Add Model Router boundary and real-model acceptance hook

**Files:**
- Create: `dsh-plugin-commerce-ops/src/product-sales/model-router.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-model-router.spec.ts`
- Test: `dsh-plugin-commerce-ops/tests/product-sales-security.spec.ts`

**Interfaces:**
- Consumes: insight-card analysis input and explicit route configuration.
- Produces: `ProductAnalysisModelRouter.analyze(input)` with replay and configured-provider modes, metadata, budget/timeout status, and credential redaction.

- [ ] **Step 1: Write failing tests** proving business code cannot call provider URLs directly, Local Only stays local, Hybrid requires explicit configuration, and credentials are rejected from model input.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement the interface and deterministic replay adapter.**
- [ ] **Step 4: Add the real-provider adapter seam without embedding credentials or a provider key.**
- [ ] **Step 5: Run focused security tests.**

### Task 10: Verify 10-SKU batch, performance, recovery, and delivery evidence

**Files:**
- Create: `dsh-plugin-commerce-ops/tests/product-sales-batch.spec.ts`
- Create: `dsh-plugin-commerce-ops/tests/product-sales-performance.spec.ts`
- Create: `docs/commerce-os/v0.1-product-sales-acceptance.md`

**Interfaces:**
- Consumes: the complete Product Sales service and existing persistence/event/evidence primitives.
- Produces: reproducible fixture batch report, performance report, recovery checks, and a live acceptance checklist for the user-provided Doudian URL.

- [ ] **Step 1: Write failing batch tests** requiring 10/10 fixture success and truthful per-SKU partial failure states.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement batch orchestration with independent SKU evidence and no duplicate upserts.**
- [ ] **Step 4: Add timing assertions for the agreed V0.1 baselines.**
- [ ] **Step 5: Run `corepack yarn build`, `corepack yarn typecheck`, `corepack yarn test`, and `corepack yarn check`; record exact outputs.**
- [ ] **Step 6: Perform the one live logged-in Doudian read-only run only when the user supplies the target URL/session; store no credentials.**
- [ ] **Step 7: Update the acceptance document with PASS/PARTIAL/BLOCKED evidence; do not claim V0.3 completion from V0.1 results.**

## Self-Review Checklist

- [ ] Every requirement in the four source documents maps to an implementation task or an explicitly phased/deferred boundary.
- [ ] No task claims live Doudian or real-model success without a live run and its Evidence.
- [ ] No task modifies `deepseek-harness/`.
- [ ] No task deletes or resets existing worktree changes.
- [ ] Every new production function has a test written and observed failing before implementation.
- [ ] V0.1 remains Product-only; other domains remain scaffolds.
- [ ] Local Only, Hybrid, approval, credential, and Evidence rules are covered by tests.

