# Upstream source series

Portable `git format-patch` series carrying this product's edits to the pinned
`deepseek-harness` checkout. One directory per upstream version the series was cut
against. The submodule working tree is never the storage place for these edits:
`git submodule update` throws it away, and a dirty submodule silently switches
Stable/Beta builds onto a local runtime overlay.

## Layers

Local changes to upstream behavior belong to exactly one layer, cheapest first.

| Layer | Where it lives | Conflict cost on an upstream bump |
| --- | --- | --- |
| L0 profile config | a `config:` value in a `cordis.patch.yml` row | none |
| L1 Desktop-owned plugin | `dsh-plugin-desktop*/src/**`, loaded by a local subpath `name:` row | none |
| L2 new upstream package | a brand-new `deepseek-harness/packages/**` directory | append-only registration lines (`tsconfig.base.json`, `tsconfig.host.json`, `pnpm-lock.yaml`) |
| L3 edit to an existing upstream file | this directory | the only layer that needs human conflict work |

Anything reachable through a documented slot, service override, message projection
or LLM adapter belongs to L1, not L3.

## Replay recipe

```sh
git -C deepseek-harness fetch origin
git -C deepseek-harness worktree add --detach ../dsh-harness-series <new-pin>
git -C ../dsh-harness-series am --3way <repo>/patches/upstream/<old-version>/*.patch
```

Resolve one patch at a time, then re-run the round-trip check: the resulting tree
must equal the tree the series produced at its own base pin. Keep `rerere` enabled so
a repeated conflict is remembered instead of re-resolved.

Before shipping, confirm the submodule is back on the pin recorded in `upstream.json`;
a series applied into the submodule itself makes `scripts/prepare-local-runtime.mjs`
build a local runtime overlay, which release builds and CI refuse.

## Drop what upstream absorbed

A patch whose behavior now exists upstream is dropped at replay time
(`git am --skip`), not carried forward. Precedent from the `0.2.0-rc.2` to
`0.2.1-rc.2` bump: `agents-anywhere-connector-httpx.patch`,
`app-builder-lib@26.15.7.patch` and `pnpm@11.8.0.patch` were deleted by upstream
instead of re-recorded.

## `0.2.0-rc.2` — 13 patches

Base pin `639ed015397290b3745d163aafe02ffee4aa3f84`.

| Patch | Packages | Layer | Note |
| --- | --- | --- | --- |
| 0001-0003 | `packages/goal/goal-progress-guard`, `goal-completion-gate`, `goal-round-ledger` | L2 | **Drop candidate.** No `cordis.patch.yml` row in any profile loads these three packages; Desktop owns the same behavior through `dsh-plugin-desktop{,-beta}/goal-loop-containment`. They stay in the series until the upstream bump, because deleting them here would leave a create-then-delete pair in the replay. |
| 0004 | `packages/llm/llm-pi-ai`, `packages/llm/llm`, `packages/compaction/compaction-image-offload` | L3 | Request-size gate and HTTP 413 image-offload recovery. Upstream rewrites `src/context.ts` in `0.2.1-rc.2` and narrows the tool schema it serializes, so the wire estimate needs a semantic re-read, not just a textual conflict fix. |
| 0005 | `packages/context/file-reference`, `file-reference-local`, `packages/client/ui-reference` | L3 | Drag payload grammar plus `referencePath`, the canonical Host path a candidate inserts. |
| 0006 | `packages/client/ui-sidebar-files` | L3 | Epoch-guarded tree so a Files tab can change root without touching Session cwd; makes every tree row a drag source. |
| 0007 | `packages/client/ui-conversation` | L3 | Authorizes a Files drop against the target Session before inserting the mention. |
| 0008 | `packages/client/ui-workspace` | L3 | Declares `sidebar.workspaces.workspace.edit` and threads `fresh` through `startSession`/`openWorkspace`. |
| 0009 | `packages/client/ui-deliverables`, `ui-open-in-app` | L3 | Keeps the turn review card visible without developer tooling; slot scope fix. |
| 0010 | `packages/goal/goal-progress-guard`, `goal-completion-gate` | L2 | Scopes the no-progress streak and the denial budget to the goal currently in charge. |
| 0011 | `packages/guard/repeat-tool-reminder`, `packages/bundle/base` | L3 + L0 | Opt-in `blockAt` / `maxTrackedCallsPerTurn` hard denials, enabled in the base bundle. |
| 0012 | `docs/subsystems/slots.*` | L3 | Documents the two new slots; pairing record re-recorded with `verify-translation-pairing --write`. |
| 0013 | `packages/bundle/web-app`, `apps/web` | L0 + L3 | Persona names DeepSeek Harness instead of the selected model. |
