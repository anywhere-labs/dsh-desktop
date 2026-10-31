# Community Market shell

[中文说明](market-shell.zh.md)

Status: delivered and built into DSH Desktop.

## Ownership

`dsh-community-market` owns catalog-source settings, source adapters, normalized discovery, the Market Client surface, npm latest preview, and the one-shot confirmation around each Profile package operation. It does not own Profile storage, package execution, bundle selection, live application, recovery checkpoints, or terminal windows: package operations belong to the official `pluginManager` service.

## Runtime shape

```text
catalog source -> Host adapter -> normalized catalog -> Market Client
                                      |
                                      +-> npm latest preview

official pluginManager.listBundles -> Installed view -> package name -> setBundleEnabled / removeBundle
```

The Client receives normalized data, package names, and one-shot confirmation identities. It never receives a package-manager capability.

## Source behavior

Standard cursor-based sources and dshfind are scanned into a bounded local index. Search, category filters, and visible pagination use that index.

DSH 1024Store discovery uses the provider's current paginated v2 API for every query, including the unfiltered directory. Single-category filters are forwarded directly. Multi-category OR filters merge bounded provider-ranked prefixes and retain an opaque local cursor. Installable requests 200 remote registry entries per batch and keeps only direct npm targets from that page; the Client requests the next opaque cursor instead of materializing the complete directory in the Host or Renderer.

Provider commands are discarded. The reviewed 1024Store adapter may parse one exact inert command shape solely to recover an npm package name; it never forwards or executes that command. A source can supply catalog identity but cannot supply executable argv, credentials, adapter code, source selection, or install authority.

## Install behavior

An installable catalog entry contributes only one npm package identity. Install preview resolves npm's official `latest` manifest and requires:

- matching npm package name;
- exact stable version; and
- valid `dsh.bundle.patch`.

The preview binds these facts, the observed catalog item, and the active Profile to a short-lived one-shot token. Execution calls only the official manager's `installBundle` with the exact `name@version` target, saved exactly and activated; the manager selects the bundle and applies it live where HMR runs.

There are no Market receipts or install-specific protection and recovery paths beyond the manager's own manifest and lockfile restoration. Source version, repository matching, lifecycle scripts, deprecation, engine ranges, and provider verification badges do not gate installation.

## Installed inventory, toggles, and uninstall

The inventory is the official manager's bundle list reduced to community plugins: bundles the Profile declares or selects, including plugins installed by this Market, other markets, and the DSH CLI, minus bundles the manager marks official, bundles the installation ships, packages in the `@deepseek-ai` scope, and Desktop's built-in bundles, which the official Plugins page manages. The manager's `readOnlyReason`, `error`, and `removable` flags decide which listed bundles can be enabled, disabled, or removed.

The Host rechecks the inventory immediately before an uninstall preview and again before execution. Enable and disable call `setBundleEnabled`; uninstall calls `removeBundle`, which deselects and unloads the bundle before pnpm removes it.

## Failure boundary

Browsing remains available when the official manager is absent. A source failure never blocks Desktop startup. Package-operation errors trigger no Market-side cleanup or rollback: the official manager restores the Profile manifest and lockfile it snapshotted, and Desktop's three healthy-start Profile checkpoints remain the recovery mechanism for everything else, with restoration an explicit Recovery-page action.

## Headless requirements

Contract generation, type checking, unit tests, package builds, export verification, and Loader smoke tests must remain headless-safe. Tests must not launch Electron or a graphical application.
