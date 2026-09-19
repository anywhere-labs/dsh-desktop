# Agent Note: Legacy agent preset aliases for Sessions persisted before a runtime rename

Status: implemented

English | [中文](2026-08-30-legacy-agent-preset-alias.zh.md)

## Problem

Upstream renamed the PTC agent preset from `code` to `ptc` in 0.1.2-alpha.1 with no compatibility alias — a deliberate pre-release stance recorded in the rename's own Agent Note. A Session, however, persists the preset id it started with in its header and its `agentPreset` projection, and a desktop update replaces the shipped roster without touching Session stores. Every Session created on runtime 0.1.1-rc.2 (Desktop ≤ 2.0.3) under the `code` preset failed to resume on Desktop 2.0.4: submitting a prompt resumed the Session, the resume resolved the persisted id against the renamed roster, and the client surfaced `resume failed for session "…": agent-presets: preset "code" not found (available: standard, ptc, minimal, cordis)`. The Session's history was intact; only the mount was refused. Reported as GitHub issue #727.

## Decision

The launcher materializes compatibility presets instead of rewriting Session stores. `agent-preset-compat` maps legacy ids to the shipped presets that replaced them (`code → ptc`) and, at profile preparation, copies the shipped preset verbatim into `<profileDir>/agent-preset-compat/<legacyId>/`, rewriting only the display metadata — the name gains a `（兼容）` suffix and the description names the legacy id. The copy refreshes from the shipped preset on every preparation, so the alias tracks the pinned runtime's composition.

The `agent-presets` row config takes over the harness-home user root (`includeUserRoot: false`, root configured explicitly) and orders the roster shipped → user → alias, so the alias only supplies ids that neither the shipped roster nor a locally authored preset provides — a person who authored a preset under the old id keeps mounting their own composition, and the alias never shadows it.

Alternatives considered:

- **Rewriting persisted Session headers and projections at boot** — rejected: the desktop would own Session-log surgery ahead of upstream's `SESSION_FORMAT_VERSION` v0→v1 migration, and a partial or failed rewrite corrupts history that is otherwise intact.
- **Falling back to the default preset when a persisted id is unknown** — rejected: a Session's composition is fixed once it has history; silently mounting a different composition changes the tool schemas and prompt sections the model sees.
- **Waiting for upstream to ship an alias or migration** — rejected: the rename defers all session-persistent vocabulary to a stacked persistence PR blocked on the format-version migration, and resumed Sessions are broken today.

## Consequences

Sessions created before the rename resume again under the composition they always ran, and keep displaying their persisted `code` id. New Sessions keep choosing `ptc`; preset pickers show one extra entry named after the shipped preset with a `（兼容）` suffix. A runtime that supplies `code` itself (or no longer ships `ptc`) materializes nothing, and the compat root is then not configured at all. The alias trusts as `system` because the launcher, not the user, authors it from the shipped roster; a preset authored under the legacy id in the harness home still outranks it.
