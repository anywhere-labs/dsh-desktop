# Community Market shell

[中文说明](market-shell.zh.md)

Status: delivered and built into DSH Desktop.

## Ownership

`dsh-community-market` owns catalog-source settings, source adapters, normalized discovery, the Market Client surface, npm latest preview, and Profile package-operation orchestration. It does not own Profile storage, pnpm execution, recovery checkpoints, terminal windows, or restart implementation.

## Runtime shape

```text
catalog source -> Host adapter -> normalized catalog -> Market Client
                                      |
                                      +-> npm latest preview

Desktop Profile inventory -> Installed view -> opaque bundleId -> pnpm remove
```

The Client receives normalized data and opaque operation identities. It never receives a package-manager capability.

## Source behavior

Standard cursor-based sources and dshfind are scanned into a bounded local index. Search, category filters, and visible pagination use that index.

DSH 1024Store discovery uses the provider's current paginated v2 API for every query, including the unfiltered directory. Single-category filters are forwarded directly. Multi-category OR filters merge bounded provider-ranked prefixes and retain an opaque local cursor. Installable requests 200 remote registry entries per batch and keeps only direct npm targets from that page; the Client requests the next opaque cursor instead of materializing the complete directory in the Host or Renderer.

Provider commands are discarded. The reviewed 1024Store adapter may parse one exact inert command shape solely to recover an npm package name; it never forwards or executes that command. A source can supply catalog identity but cannot supply executable argv, credentials, adapter code, source selection, or install authority.

## Install behavior

An installable catalog entry contributes only one npm package identity. Install preview resolves npm's official `latest` manifest and requires:

- matching npm package name;
- exact stable version; and
- valid `dsh.bundle.patch`.

The preview binds these facts, the observed catalog item, and the active Profile to a short-lived one-shot token. Execution calls only `desktopPnpm.run(argv)`, saves the exact version, and reconciles `dsh.profile.bundles`.

There are no Market receipts or install-specific protection and recovery paths. Source version, repository matching, lifecycle scripts, deprecation, engine ranges, and provider verification badges do not gate installation.

## Installed inventory and uninstall

Desktop inventory reads direct Profile dependencies and bundles. It therefore includes plugins installed by this Market, other markets, and the DSH CLI. Product-owned bundles are read-only. Other direct plugin dependencies receive an opaque generation-scoped `bundleId` and offer uninstall only.

The Host resolves `bundleId` immediately before preview and rechecks the direct dependency before execution. Uninstall uses `desktopPnpm.run(['remove', packageName])` and removes the bundle reference. The Market does not expose enable or disable.

## Failure boundary

Browsing remains available when Desktop package capabilities are absent. A source failure never blocks Desktop startup. Package-operation errors do not trigger automatic cleanup or rollback. Desktop's three healthy-start Profile checkpoints are the single recovery mechanism, and restoration remains an explicit Recovery-page action.

## Headless requirements

Contract generation, type checking, unit tests, package builds, export verification, and Loader smoke tests must remain headless-safe. Tests must not launch Electron or a graphical application.
