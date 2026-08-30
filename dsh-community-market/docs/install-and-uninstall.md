# Install, upgrade, and uninstall

[中文说明](install-and-uninstall.zh.md)

This guide describes the package-operation boundary used by DSH Community Market.

## Views

| View | Source of truth | Available operations |
| --- | --- | --- |
| Discover | Normalized selected catalog source | Browse details and request install preview |
| Installable | Catalog entries with one npm package identity | Request install preview |
| Installed | Active Profile direct dependencies and bundle list | Upgrade direct dependencies with a resolvable source; uninstall removable dependencies; core bundles are read-only |
| Sources | User-owned catalog source settings | Add, select, order, and remove sources |

Installed state is independent of the selected catalog and of which market performed the installation.

## Install flow

1. The user selects a catalog item. The Renderer sends only `sourceRecordId` and `itemId`.
2. The Host resolves the normalized npm package identity it previously observed.
3. The Host requests `https://registry.npmjs.org/<package>/latest` and requires the same package name, an exact stable version, and a valid `dsh.bundle.patch` declaration.
4. The confirmation shows the package, exact version, current Profile, and preview expiry.
5. On confirmation, the Host consumes the one-shot `previewId` and calls `desktopPnpm.run()` with Host-owned argv for an exact `pnpm add`.
6. The Host reconciles the package into `dsh.profile.bundles` and confirms that it is now a direct Profile dependency.

The source's listed version is never used as the install target. Repository equality, deprecation metadata, lifecycle scripts, engine ranges, integrity metadata, and provider verification flags do not block the operation. Provider command strings are discarded.

Market installation creates no receipt, checkpoint, retry, cleanup, or rollback operation. Desktop's ordinary Profile checkpoints cover the resulting state.

## Automatic-install conditions

A catalog entry can reach automatic install preview only when:

- exactly one valid npm package name is normalized from the entry;
- the package is not `dsh-plugin-desktop` or `dsh-community-market`;
- npm `latest` is an exact stable version for that same package; and
- the npm manifest declares a safe relative DSH bundle patch path.

Failure keeps the item browseable and may expose a display-only manual command.

## Uninstall flow

1. Desktop reads the active Profile's `dependencies` and `dsh.profile.bundles`.
2. Each direct bundle receives a generation-scoped opaque `bundleId`. Product-owned bundles are read-only; other direct dependencies are removable.
3. The Renderer submits only that `bundleId`.
4. The Host resolves it again against current inventory, verifies that the package is still a direct dependency, and returns a one-shot confirmation.
5. On confirmation, the Host calls `desktopPnpm.run(['remove', packageName])`, removes the bundle entry, and confirms that the Profile no longer references the package.

This flow applies equally to plugins installed by Community Market, another plugin market, or the DSH CLI. Market offers no enable or disable action.

## Upgrade flow

Installed direct dependencies can request an online upgrade. The Host resolves the target only from the dependency spec in the Profile manifest plus official sources; it never depends on the selected catalog:

- **npm specs** (exact versions or semver ranges): resolve latest from `https://registry.npmjs.org/<package>/latest`.
- **Commit-pinned GitHub specs** (`github:owner/repo#<40-hex commit>[&path:/subdir]`, written by either Market or the CLI): resolve the default-branch HEAD commit via `https://api.github.com/repos/<owner>/<repo>/commits/HEAD`, then verify the manifest at that commit (package name, exact stable version, valid `dsh.bundle.patch`).
- **Branch, tag, or ref-less GitHub specs**: resolve and re-pin to the HEAD commit the same way.
- **Other specs** (`file:`, `link:`, `workspace:`, `git+https:`, …) have no online upgrade source; Market rejects them with an explanation.

1. The Renderer submits only the installed bundle's `bundleId`.
2. The Host resolves the target again against current inventory, verifies it is still a direct dependency, resolves the latest target, and returns a one-shot confirmation showing both the current and the target version.
3. When the installed target already matches the latest, the Host rejects with `up-to-date` and the Renderer reports "already at the latest version" without a confirmation dialog. The decision uses the actually installed version: the pinned commit for GitHub targets, and the version locked in `pnpm-lock.yaml` for npm targets — never the declared manifest range. A `^1.9.0` spec locking 1.9.0 still offers an upgrade when registry latest is 1.9.2.
4. On confirmation, the Host calls `desktopPnpm.run(['add', ...])` with `--save-exact`, re-pinning GitHub dependencies to the new commit (npm dependencies to the exact latest), keeps the bundle entry, and confirms the Profile dependency spec matches the preview.

After an upgrade the dependency spec is always exact: GitHub installs converge from a possibly moving ref to a pinned commit, and npm installs converge to an exact version.

## Manual fallback

If automatic preview is unavailable, the Host may construct a bounded display-only npm command from normalized identity. **Open DSH Terminal** opens the terminal only; it sends no package command, path, or Profile and performs no mutation.

## Failure behavior

| Failure | Result |
| --- | --- |
| npm latest cannot be resolved or is not a stable DSH plugin | No package operation starts |
| Profile changes after preview | The one-shot preview is rejected |
| pnpm fails | The error is reported; Market performs no automatic cleanup or rollback |
| Profile reconciliation fails after pnpm | The error is reported for diagnosis or explicit Recovery checkpoint restore |

For a pnpm process failure, the Host retains only a bounded tail of stdout and stderr. It records that diagnostic in the Desktop log and returns it to the local failure dialog. The dialog shows the verified package command and can open DSH Terminal, but never pastes, executes, or silently retries it.
| Renderer closes after confirmation | The Host-owned package operation continues; only the response may be lost |

After a successful mutation, the user may restart now or later. Restart is never silent.
