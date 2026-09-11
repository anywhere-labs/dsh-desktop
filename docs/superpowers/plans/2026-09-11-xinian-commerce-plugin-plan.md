# Xinian Commerce Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, runnable `dsh-plugin-xinian-commerce` with a verified product/content/task workflow and a newly designed React workbench.

**Architecture:** The plugin owns ecommerce domain behavior and the UI, while `enterprise-agent-runtime` remains the reusable event/governance substrate. A single in-process Agent loop will provide Planner, Executor, Verifier, Repair, and Delivery roles before any concurrency is added.

**Tech Stack:** TypeScript ESM, Node.js 22+, DSH Cordis WebServer, React 18, Vite, Vitest, Zod, Yarn 4.18.0.

**Spec:** `docs/superpowers/specs/2026-09-11-xinian-commerce-plugin-design.md`

## Global Constraints

- Do not edit `deepseek-harness/`; it is a pinned upstream submodule.
- Do not overwrite or refactor `dsh-plugin-commerce-ops`; add a separate workspace package.
- Keep all writes scoped to the new plugin and the root workspace manifest/lockfile needed to register it.
- Do not store secrets, tokens, cookies, or `.env` files.
- Mock/sandbox connectors must be the default; publish-like actions require an approval gate.
- Do not claim delivery from HTTP 200, process exit, or Agent self-report; retain events, checkpoint, and artifact manifest.

### Task 1: Create package shell and public contracts

**Files:**
- Create: `dsh-plugin-xinian-commerce/package.json`
- Create: `dsh-plugin-xinian-commerce/tsconfig.json`
- Create: `dsh-plugin-xinian-commerce/vite.config.ts`
- Create: `dsh-plugin-xinian-commerce/src/contracts/index.ts`
- Create: `dsh-plugin-xinian-commerce/tests/contracts.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `TaskState`, `CommerceTask`, `ProductRecord`, `StoreConnection`, `ArtifactRef`, `VerificationResult`, `ApiError`, and Zod schemas used by every later task.

- [ ] Write failing schema tests for valid product/task payloads and rejection of missing title, invalid task state, traversal-like asset paths, and unknown platform ids.
- [ ] Run `corepack yarn workspace dsh-plugin-xinian-commerce test contracts.spec.ts`; expect failure because package and contracts do not exist.
- [ ] Add the package metadata, workspace entry, TypeScript/Vite configs, and strict Zod-backed contracts. Use `type: module`, `main: lib/index.js`, `build`, `typecheck`, `test`, and `build:client` scripts.
- [ ] Run the focused test and typecheck; expect all contract assertions to pass.
- [ ] Run `git diff --check` and stage only Task 1 files for review.

### Task 2: Implement Agent Control Plane and local persistence

**Files:**
- Create: `dsh-plugin-xinian-commerce/src/runtime/control-plane.ts`
- Create: `dsh-plugin-xinian-commerce/src/runtime/event-store.ts`
- Create: `dsh-plugin-xinian-commerce/src/runtime/message-bus.ts`
- Create: `dsh-plugin-xinian-commerce/src/runtime/verifier.ts`
- Create: `dsh-plugin-xinian-commerce/src/runtime/agent-runtime.ts`
- Create: `dsh-plugin-xinian-commerce/tests/runtime.spec.ts`

**Interfaces:**
- Consumes the contracts from Task 1 and `enterprise-agent-runtime` event/approval types.
- Produces `TaskStore.create`, `TaskStore.transition`, `EventStore.list`, `MessageBus.claim`, `AgentRuntime.run`, and independent verification results.

- [ ] Write failing tests for the legal lifecycle, illegal transition rejection, idempotent event append, `NO_PENDING_WORK`, and the distinction between `PROCESS_EXITED`, `OUTPUT_VALID`, `BUSINESS_ACCEPTED`, and `DELIVERED`.
- [ ] Run the focused runtime tests; expect failures for missing services.
- [ ] Implement an in-memory default store with optional JSONL path injection, explicit transition table, correlation ids, checkpoint retention, and artifact manifest preservation.
- [ ] Implement the single-agent loop: Planner creates a plan, Executor calls a connector, Verifier checks output, Repair is bounded, and Delivery only marks delivered after all gates pass.
- [ ] Run runtime tests and package typecheck; expect pass with no external service required.

### Task 3: Implement domain services and host API

**Files:**
- Create: `dsh-plugin-xinian-commerce/src/domain/product-service.ts`
- Create: `dsh-plugin-xinian-commerce/src/domain/content-service.ts`
- Create: `dsh-plugin-xinian-commerce/src/domain/publish-service.ts`
- Create: `dsh-plugin-xinian-commerce/src/domain/analytics-service.ts`
- Create: `dsh-plugin-xinian-commerce/src/connectors/mock-connector.ts`
- Create: `dsh-plugin-xinian-commerce/src/host/service.ts`
- Create: `dsh-plugin-xinian-commerce/src/host/routes.ts`
- Create: `dsh-plugin-xinian-commerce/src/plugin.ts`
- Create: `dsh-plugin-xinian-commerce/src/index.ts`
- Create: `dsh-plugin-xinian-commerce/tests/routes.spec.ts`

**Interfaces:**
- Consumes Task 1 contracts and Task 2 runtime services.
- Produces `/api/xinian/health`, dashboard, product CRUD, content generation/approval/retry, task lifecycle/events/artifacts/checkpoint, stores, publish preview/execute, and analytics endpoints.

- [ ] Write route tests for health, product create/list, task creation/start, approval-required publish preview, malformed JSON, same-origin rejection, and missing-input `WAITING_INPUT`.
- [ ] Run focused route tests; expect failure because the host service and routes are absent.
- [ ] Implement bounded JSON parsing, request ids, uniform API errors, same-origin checks, path validation, and mock data that is clearly labeled as mock.
- [ ] Register routes through the existing `CommerceWebServer` shape without importing or modifying `dsh-plugin-commerce-ops`.
- [ ] Run route tests and `corepack yarn workspace dsh-plugin-xinian-commerce build`; expect pass.

### Task 4: Build the React workbench shell and interaction state

**Files:**
- Create: `dsh-plugin-xinian-commerce/src/client/App.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/api.ts`
- Create: `dsh-plugin-xinian-commerce/src/client/state.ts`
- Create: `dsh-plugin-xinian-commerce/src/client/main.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/components/Sidebar.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/components/TopBar.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/components/TaskDrawer.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/pages/DashboardPage.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/pages/ProductLibraryPage.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/pages/ContentStudioPage.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/pages/PublishWorkspacePage.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/pages/AnalyticsPage.tsx`
- Create: `dsh-plugin-xinian-commerce/src/client/pages/AgentRunPage.tsx`
- Create: `dsh-plugin-xinian-commerce/tests/client-state.spec.ts`

**Interfaces:**
- Consumes the API client and `WorkspaceState`; produces navigation, task filters, product selection, task drawer, approval drawer, and responsive module rendering.

- [ ] Write state tests for module navigation, task filter changes, drawer open/close, and clearing selection after a task is cancelled.
- [ ] Run the focused state tests; expect failure because the UI state module is absent.
- [ ] Implement typed API calls with error envelopes and explicit loading/error/empty states; build the six modules with realistic mock responses from the local API.
- [ ] Wire primary interactions: create product, generate content task, open task details, approve/reject, start/pause/cancel, repair, and inspect artifacts.
- [ ] Run state tests and `corepack yarn workspace dsh-plugin-xinian-commerce build:client`; expect pass.

### Task 5: Add redesigned CSS, static serving, and desktop plugin registration

**Files:**
- Create: `dsh-plugin-xinian-commerce/src/styles/tokens.css`
- Create: `dsh-plugin-xinian-commerce/src/styles/layout.css`
- Create: `dsh-plugin-xinian-commerce/src/styles/components.css`
- Create: `dsh-plugin-xinian-commerce/src/styles/motion.css`
- Modify: `dsh-plugin-xinian-commerce/src/client/main.tsx`
- Modify: `dsh-plugin-xinian-commerce/src/host/routes.ts`
- Modify: `dsh-plugin-xinian-commerce/src/plugin.ts`
- Create: `dsh-plugin-xinian-commerce/tests/static-serving.spec.ts`

**Interfaces:**
- Consumes the workbench bundle from Task 4 and host registration from Task 3.
- Produces `/xinian-commerce/` static serving with traversal protection, desktop-safe layout, and a mobile bottom navigation breakpoint.

- [ ] Write static-serving tests for HTML entry, CSS/JS content types, unknown asset 404, encoded traversal rejection, and redirect from `/xinian-commerce` to `/xinian-commerce/`.
- [ ] Run focused serving tests; expect failure until the static handler exists.
- [ ] Implement fresh light-workbench tokens, focus-visible states, reduced-motion behavior, card/table/drawer styles, and responsive layout without hotlinked source assets.
- [ ] Add static serving using the same safe-root pattern as existing desktop-owned pages, with `DSH_XINIAN_COMMERCE_DIST` override.
- [ ] Run serving tests and client build; expect pass.

### Task 6: Verify the package and document runtime operations

**Files:**
- Create: `dsh-plugin-xinian-commerce/README.md`
- Create: `dsh-plugin-xinian-commerce/tests/smoke.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-11-xinian-commerce-plugin-design.md` only if implementation evidence requires a contract correction.

**Interfaces:**
- Consumes all previous tasks and produces reproducible commands, endpoint examples, and honest verification evidence.

- [ ] Write a headless smoke test that instantiates the host route adapter, calls `/api/xinian/health`, creates a mock product, starts a content task, and verifies the final status and manifest without claiming external platform delivery.
- [ ] Run package unit tests, typecheck, TypeScript build, Vite build, and the smoke test from a clean process.
- [ ] Inspect generated file paths and `git diff --check`; confirm no secrets or upstream submodule changes.
- [ ] Write README commands for install, build, test, typecheck, host integration, and mock connector limitations.
- [ ] Run the complete root gate required by the repository where feasible: `corepack yarn check`.

## Final Review Checklist

- [ ] `dsh-plugin-xinian-commerce` is present in root workspaces and builds independently.
- [ ] No files under `deepseek-harness/` changed.
- [ ] No existing user changes were reset, staged, or committed by implementation work.
- [ ] API errors, task states, events, checkpoints, artifacts, and approvals are independently testable.
- [ ] Frontend primary interactions work against the local API and have explicit waiting/error/empty states.
- [ ] Completion claims use fresh command output and distinguish process, output, business acceptance, and delivery evidence.
