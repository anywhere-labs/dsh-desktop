# Agent Note: Community Market delegates package operations to the official plugin manager

Status: implemented

English | [中文](2026-10-14-community-market-official-plugin-manager.zh.md)

## Problem

`dsh-community-market` carried its own package-operation lifecycle: it ran `pnpm add` and `pnpm remove` through a Desktop-supplied `desktopPnpm` capability, rewrote `dsh.profile.bundles` itself, read the Installed inventory from a Desktop-supplied `desktopPlugins` capability, and finished every mutation with a one-shot restart token and a modal that asked the user to restart Desktop. The earlier [install lifecycle note](2026-08-19-desktop-plugin-install-lifecycle-ownership.md) placed that lifecycle in Desktop because upstream had no management service.

Upstream now ships `@deepseek-ai/dsh-plugin-manager` in the base bundle of every dsh Host. Its `pluginManager` service owns `installBundle`, `setBundleEnabled`, `removeBundle`, and `listBundles`: it validates the bundle, restores the profile manifest and lockfile on failure, serializes writes under the profile lock, selects the bundle, and applies the change live through the HMR module the same bundle mounts. Next Profiles therefore no longer need a restart after a plugin change, and the official Plugins page already manages the same bundles the Market lists. Two implementations of one lifecycle disagreed on inventory shape, registry policy, failure handling, and activation.

## Decision

The Market keeps catalog identity and verification and delegates every package mutation to the official manager.

- The Host side soft-injects `pluginManager` and `profileContext` instead of `desktopProfiles`, `desktopPnpm`, and `desktopPlugins`. `MarketInstallService` takes a `MarketPluginManager` interface that the upstream service satisfies structurally; tests supply an in-memory implementation.
- Install preview still resolves npm `latest` or the pinned GitHub manifest and binds the verified target to a one-shot intent. Execution calls `installBundle(target, { enabled: true, saveExact: true })` and reports the manager's `application`: `applied`, `restart-required`, or `overridden`. A `failed` or `cancelled` change becomes a Market error carrying the manager's bounded pnpm output.
- The Installed view is a projection of `listBundles` reduced to community plugins: bundles the profile declares or selects, minus bundles the manager marks official, bundles the installation ships, packages in the `@deepseek-ai` scope, and Desktop's built-in bundles (the Desktop packages, both markets, and the remote-control bridge), which the official Plugins page already manages. `toggleable` and `removable` derive from the manager's `readOnlyReason`, `error`, and `removable` flags. Uninstall is addressed by package name and rechecked against the manager before preview and before execution; enable and disable call `setBundleEnabled` without a confirmation step.
- The restart token, the restart route, the `requestRestart` Desktop action, and the completion modal are gone. A completed change is announced in a transient banner; when the manager reports `restart-required`, the banner says that the change takes effect after the next restart.
- The manager judges activation the moment its reload returns, so a bundle whose row still waits for a service it injects (`dsh-better-sidebar` waiting for `webRuntime` was the observed case) is reported as failed even though it activates right after. When the manager saved the selection, whether through an install or a toggle, the Market re-reads the rows' live phases from `listPlugins` for a bounded grace period and accepts the change once they are active; a failed row or an expired period keeps the manager's failure. The rule reads only the manager's structured state and names no plugin. The Market Client mounts its loaders once rather than per `t` identity, because a client plugin registering or dropping its dictionary hands every slot a new `t` in the middle of the very toggle that caused it.

Next no longer provides `desktopPlugins`. It keeps `desktopProfiles` and `desktopPnpm` for dshmarket and `desktopActions.openTerminal` for the Market's manual fallback. Stable and Beta still mount their `DesktopPluginsService`; the Market no longer consumes it, and removing that service is separate cleanup.

## Consequences

The Market works in any dsh Host that mounts the base bundle, including plain Web; browsing stays available where it does not. Registry choice, fallbacks, compatibility checks, build-script approval, and failure restoration follow the official manager's configuration rather than a Market-specific npm registry pin, while the exact `name@version` target keeps the installed identity equal to the verified one. The `installations` response and the preview and execute responses changed shape; the Market Client and Host are shipped together, and no other consumer reads them.
