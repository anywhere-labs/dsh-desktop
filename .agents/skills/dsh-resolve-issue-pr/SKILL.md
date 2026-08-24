---
name: dsh-resolve-issue-pr
description: Manage DSH Desktop GitHub issues and pull requests end to end. Use when Codex needs to retrieve and prioritize an issue backlog, deduplicate root-cause clusters, reproduce or diagnose an issue, implement a fix, review or prepare a PR, run CI or platform verification, submit release evidence, decide closure status, or draft maintainer replies and review comments for anywhere-labs/deepseek-harness-desktop.
---

# Resolve DSH Desktop Issues and Pull Requests

Treat the repository state, live GitHub record, code, tests, and target artifacts as separate evidence sources. Do not turn a plausible explanation into a confirmed root cause or a merged patch into a verified release.

Read the repository-root `AGENTS.md` before changing files. Read `docs/maintainer-issue-pr-workflow.md` or its English counterpart `docs/maintainer-issue-pr-workflow.en.md` for the full policy, command recipes, priority and risk matrices, reply templates, PR copy, and closure text.

## Establish the task

1. Identify the repository, base branch, issue or PR number, requested outcome, and whether GitHub state is live or cached.
2. Read the complete issue or PR, comments, linked duplicates, linked PRs or commits, checks, and release references. Use `gh` read commands when authenticated.
3. Record the current branch, `HEAD`, worktree status, remotes, and submodule state. Preserve user changes.
4. Choose one lane:
   - `triage`: classify, deduplicate, request evidence, or route ownership;
   - `diagnose`: reproduce and establish a root cause without changing code;
   - `fix`: diagnose, implement, test, and prepare the PR evidence;
   - `review`: inspect the complete base-to-head change and report findings first;
   - `release verification`: test a merged fix in the target artifact before closing the issue.

Do not label, comment on, close, merge, or otherwise mutate GitHub unless the user asks for that operation. A request to review or diagnose authorizes read-only inspection, not a patch.

## Triage and prioritize a backlog

1. Record the repository, UTC retrieval time, query, item count, and live or cached source. Prefer:

```sh
gh issue list --repo <owner>/<repo> --state open --limit 500 --json number,title,body,labels,author,createdAt,updatedAt,comments,reactions,assignees,milestone,url
```

2. If live retrieval fails, use only a dated local snapshot and call it a snapshot. Never present cached data as current.
3. Read linked duplicates, active PRs, release notes, comments, and relevant code or test evidence before ranking a technically significant item.
4. Normalize one row per independently actionable root cause. Keep all source Issue numbers in that row; do not count duplicates as independent engineering demand.
5. Classify each row as `confirmed bug`, `reported bug`, `investigation`, `feature request`, or `information/duplicate`.
6. Keep evidence confidence separate from urgency: `T` target test/artifact, `C` code or diagnostics, `R` executable reproduction, `E` incomplete evidence, `F` feature/product request.

Score integers from 1 to 5:

- Impact `I`: 5 for launch, core agent execution, installation/update, workspace, data, or security blockers; 1 for cosmetic or informational work.
- Market attention `M`: use independent reporters, duplicates, recent concentration, comments/reactions, ecosystem reach, and commitments. Do not invent missing metrics.
- Delivery complexity `C`: 5 for ambiguous cross-platform native, artifact, security, or multi-owner work; 1 for mechanical or already verified closure.

Calculate delivery order without allowing easy work to hide critical incidents:

```text
Delivery feasibility F = 6 - C
Priority score S = 0.50 * I + 0.30 * M + 0.20 * F
```

Apply gates after the formula:

- `I = 5` with `T`, `C`, or `R` evidence is `P0`.
- `I = 5` with `E` evidence is `P0 investigation`: collect diagnostics and target-platform reproduction before promising a fix.
- Security, data-loss, and release-install blockers never fall below `P0` because of complexity.
- Features compete within the roadmap, not ahead of unresolved P0/P1 defects.
- Duplicates inherit the canonical priority and never receive a second engineering rank.

Use default bands `P0 >= 4.0`, `P1 >= 3.3`, `P2 >= 2.5`, otherwise `P3`, subject to the gates. Report a ranked action backlog, immediate evidence lane, roadmap/closure lane, target verification environment, and one next owner action per cluster.

## Protect the workspace

- Use a dedicated worktree based on the latest `upstream/master` for new fixes and a detached review worktree for third-party PRs when practical.
- Never overwrite or clean an existing dirty worktree. Do not reuse a feature branch for unrelated Issue or PR work.
- Treat `upstream` as fetch-only and `fork` as the contributor push remote in this workspace. Confirm remote URLs instead of assuming their names elsewhere.
- Do not edit `deepseek-harness/` from a desktop feature branch. Update its pin only in a separate, explicit submodule commit.
- Keep submodule initialization, dependency installation, and graphical launches explicit. If the submodule Git link is broken, report it and repair only in a clean or newly created worktree.

## Build an evidence ledger

Separate observations from inference. Track:

| Field | Required content |
|---|---|
| Symptom | Exact user-visible behavior or error text |
| Environment | Desktop/runtime version, OS/build/architecture, install type, profile/plugins |
| Reproduction | Minimal numbered steps and frequency |
| Expected result | Observable success condition |
| Evidence | Logs, diagnostics, screenshot, test, code path, or artifact result |
| Hypothesis | Suspected cause, confidence, supporting and contradicting evidence |
| Next discriminator | Smallest check that can confirm or reject the hypothesis |

Remove secrets, credentials, account data, and unnecessary absolute paths before publishing evidence.

Use these confidence labels consistently:

- `T`: relevant automated test or target-artifact verification;
- `C`: code or explicit diagnostics support the cause;
- `R`: reporter supplied an executable reproduction;
- `E`: evidence is incomplete;
- `F`: feature or product decision, not a defect.

## Resolve an issue

1. Search open and closed issues before assuming uniqueness. Cluster only reports that share a root cause; similar symptoms may need separate investigations.
2. Reproduce on the cheapest faithful layer: pure function, service boundary, package integration, Electron process, then packaged target artifact. Stop at the first layer that proves the behavior, but use an artifact for release claims.
3. Keep a short hypothesis ledger. Test the highest-information discriminator before editing code.
4. Locate the owning package and read nearby tests, history, architecture notes, and public contracts.
5. Fix the root cause with the smallest coherent change. Add a regression test that fails for the original behavior and covers important failure, cancellation, rollback, or restart states.
6. Preserve security and recovery boundaries. Never restore raw plugin installation, relax origin checks, permit native builds silently, expose unsanitized child-process output, or bypass the managed WAL/receipt flow just to regain compatibility.
7. Run focused checks, then the smallest owning-package gate, then `corepack yarn check` for product changes. Add target-platform packaging and manual smoke evidence when the behavior depends on Electron, native helpers, installer/update logic, ASAR paths, ACLs, node-pty, or OS lifecycle.
8. Prepare the PR using the repository template. List only commands and manual checks actually run; state every skipped check and residual risk.
9. After merge, verify the fix in the release artifact and affected upgrade path. Keep the issue in `pending release` or `needs retest` state until that evidence exists.

## Review a pull request

1. Read the related issue first and state the behavior the PR claims to change.
2. Review `base...head`, not only the latest commit. Check scope, unrelated changes, generated files, lockfiles, submodule pins, and merge-base freshness.
3. Trace changed inputs across success, error, cancellation, rollback, restart, and teardown paths. Check trust boundaries and user-visible error propagation.
4. Verify tests fail without the fix when practical. Check that mocks do not bypass the boundary under test.
5. Match verification to risk. Unit tests cannot prove installer behavior, native process launch, platform lifecycle, or packaged resource presence.
6. Report findings before the summary, ordered by severity, with file/line, affected behavior, evidence, and the smallest acceptable correction. Do not block on style preferences.
7. Distinguish `approve`, `comment`, `request changes`, `superseded`, and `needs target-artifact verification`. A diagnostic improvement does not prove the underlying failure is fixed.

## Prepare and submit a pull request

1. Confirm the branch contains only the intended Issue scope and is based on current `upstream/master`.
2. Run `git diff --check`, focused regression tests, the owning-package gate, and the full required gate. Record unrun checks and residual risk.
3. Use conventional commits and keep an upstream pin separate from desktop behavior.
4. Fill every repository PR template section: Summary, Related Issues, Type, Platforms, Verification, and Release Notes.
5. When the user explicitly requests submission, confirm the push remote and head branch, push to the contributor fork, then create a draft PR if required artifact evidence is outstanding or a normal PR when it is review-ready.
6. Read back the created PR and checks to verify the base, head, title, body, links, and CI state. Never create, push, mark ready, or merge a PR based only on an implementation request.

## Select verification

| Change | Minimum local evidence | Additional evidence |
|---|---|---|
| Documentation only | `git diff --check`; bilingual/link review | Update the applicable i18n record when one exists |
| Desktop logic | Focused Vitest; desktop typecheck/test | Root `corepack yarn check` |
| Market/provider | Contract generation/check; focused tests | Bounds, provenance, timeout, redirect, cancellation, reset, and hostile-input tests |
| Production dependency | Root check | Runtime closure, license check, refreshed notices |
| Windows installer/update/sandbox | Windows-focused tests | Installer and portable artifact smoke on Windows |
| macOS packaging/node-pty/lifecycle | Focused tests | Universal package smoke on macOS |
| Upstream pin | Layout and upstream toolchain checks | Separate pin commit and upstream build evidence |

Run `git diff --check` before handoff. Do not claim an unrun gate passed because CI is expected to run it later.

## Draft maintainer replies

1. Use the reporter's language unless the user requests bilingual copy. Keep technical identifiers and exact errors unchanged.
2. Lead with the current outcome or status, then state confirmed evidence, unknowns, and one concrete next action.
3. Select the narrowest matching template from the reply chapter in `docs/maintainer-issue-pr-workflow.md`. Replace every `{{placeholder}}` and delete inapplicable fields before presenting or posting it.
4. Distinguish observation, root-cause confidence, code status, and release status. Use `merged, awaiting release verification` when no affected artifact has been tested.
5. Ask only for evidence that discriminates between live hypotheses. Include redaction guidance when requesting logs or diagnostics.
6. Do not blame reporters or third-party maintainers, invent an ETA, promise a merge, or say “cannot reproduce” means “invalid.”
7. For PR reviews, attach actionable findings to file/line references when possible. Put blocking findings before the overall decision.
8. Drafting copy does not authorize posting it. Mutate GitHub only when the user explicitly asks.
9. When bilingual copy is required, write a complete English block and a complete Chinese block as separate paragraphs or sections. Do not join translations on one line with `/`.
10. Treat requests to study reply style, organize templates, or prepare reply copy as draft-only. Posting a comment requires explicit authorization for that target; permission to submit a PR does not authorize an Issue reply.
11. Describe a package built from a manifest version as a local test artifact. Call it a release only after verifying the live tag, GitHub Release, official assets, and provenance.

Match the repository's established maintainer voice:

- Use concise Chinese by default for Issue replies: two to four short paragraphs, no heading unless the evidence needs a list.
- Open with `感谢反馈`, `已复现`, `已定位`, or `已复核` according to the actual evidence; do not add ceremonial language before the status.
- Use explicit contrasts such as `这能证明...，但不能证明...` to protect root-cause and release boundaries.
- End with the tracking PR, status label, retest request, or exact evidence needed next.
- For community PR scope consolidation or superseded closure, use paired English and Chinese paragraphs: thank a specific contribution, explain the milestone or ownership decision, then close while naming the retained value.

## Finish with auditable evidence

For a fix or PR handoff, report:

1. root cause or remaining hypotheses;
2. changed files and why each is in scope;
3. regression coverage;
4. exact commands and manual checks run, with results;
5. checks not run and why;
6. platform, release, migration, rollback, security, and compatibility risks;
7. the next action: review, rebase, artifact test, release, or closure.

Close a bug only when the canonical issue links the fixing PR or commit, names the release and target platform, records regression or manual smoke evidence, and links duplicates. If the patch is merged but no affected artifact has been tested, say `merged, awaiting release verification` rather than `fixed`.
