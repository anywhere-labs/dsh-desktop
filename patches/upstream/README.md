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

## `0.2.0-rc.2` — 15 patches

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
| 0014 | `packages/session/session-persistence` | L3 | Read past a newer harness's `job/registered`, `job/settled` and `working-directory/change` records instead of refusing the log; restores the transcripts of 21 of 203 Sessions. |
| 0015 | `packages/client/ui-conversation` | L3 | Seed the composer only from a usable stored draft, so a `{text, references}` draft written by a newer build cannot unmount the whole Session slot. |

## `0.2.1-rc.5` — 1 squashed snapshot

Base pin `b830ec950faba0a46dda564be3e2d854afed94f1` (tag `dsh-v0.2.1-rc.5`).

`worktree-snapshot-20261104.patch` is the whole local edit set for this pin in one
`git apply` payload — 120 files, +3026/−235 — recorded by diffing the submodule
working tree against the pin instead of replaying the `0.2.0-rc.2` series patch by
patch. It is byte-equal to the tree by construction, so it needs no round-trip
check, but it also has no per-concern history: split it back into L2/L3 patches
before the next bump if the replay has to be resolved interactively.

Package counts, largest first: `client/ui-sidebar-files` 17, `client/ui-workspace`
13, `client/ui-conversation` 12, `client/ui-sidebar-terminal` 12, `llm/llm-pi-ai`
11, `api/workspace-files` 10, `client/ui-reference` 6, `compaction/compaction-image-offload`
6, `context/file-reference` 6, `client/ui-deliverables` 5, `guard/repeat-tool-reminder`
5, `apps/web` 4, `bundle/web-app` 4, `docs/subsystems` 3, `llm/llm` 2, and one file
each in `bundle/base`, `client/ui-open-in-app`, `context/file-reference-local`, plus
`pnpm-lock.yaml`.

### What did not carry over from `0.2.0-rc.2`

| Old patch | Outcome | Evidence |
| --- | --- | --- |
| 0001-0003, 0010 (goal `progress-guard`, `completion-gate`, `round-ledger`) | dropped | Never loaded by a `cordis.patch.yml` row; Desktop owns the behavior through `dsh-plugin-desktop{,-beta}/goal-loop-containment`. Only stale `lib/` and `node_modules/` build output still sits under `deepseek-harness/packages/goal/`; no source survives the pin. |
| 0014 (`session-persistence` skippable event types) | absorbed | rc.5 `packages/core/session/src/known-event-types.ts` already knows `job/registered`, `job/settled` and `working-directory/change`, so the log reads past them without a local edit. |
| 0015 (`ui-conversation` draft seed guard) | absorbed | rc.5 widened the setter input to `type DraftInput = string \| DraftSnapshot` and `setDraft` resolves it, so a `{text, references}` draft no longer unmounts the Session slot. |

0004-0013 all appear in the snapshot (`grep -c` on their package paths in the patch
text confirms each one).

### Vendored-runtime counterpart

The snapshot edits submodule *source*. The same bump must also re-record the 21
`patches/dsh-*@<version>.patch` Yarn `patch:` files that edit the published runtime
tarballs, referenced from the root `package.json` resolutions and asserted by
`dsh-plugin-desktop-beta/tests/package.spec.ts`. Both sets are keyed to the runtime
version, so an rc bump orphans both if only one is refreshed.
