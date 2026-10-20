# Install and uninstall

[中文说明](install-and-uninstall.zh.md)

This guide describes the package-operation boundary used by DSH Community Market.

## Views

| View | Source of truth | Available operations |
| --- | --- | --- |
| Discover | Normalized selected catalog source | Browse details and request install preview |
| Installable | Catalog entries with one npm package identity | Request install preview |
| Installed | The official plugin manager's bundle list for the active Profile, reduced to community plugins | Enable, disable, or uninstall listed bundles; official and Desktop built-in bundles are not listed |
| Sources | User-owned catalog source settings | Add, select, order, and remove sources |

Installed state is independent of the selected catalog and of which market performed the installation.

## Install flow

1. The user selects a catalog item. The Renderer sends only `sourceRecordId` and `itemId`.
2. The Host resolves the normalized npm package identity it previously observed.
3. The Host requests `https://registry.npmjs.org/<package>/latest` and requires the same package name, an exact stable version, and a valid `dsh.bundle.patch` declaration.
4. The confirmation shows the package, exact version, current Profile, and preview expiry.
5. On confirmation, the Host consumes the one-shot `previewId` and calls the official plugin manager's `installBundle` with the exact `name@version` target, saved exactly and activated.
6. The manager validates the bundle, selects it in `dsh.profile.bundles`, and applies it live where the Host runs HMR. The Host confirms that the bundle the manager reports equals the verified package. A bundle the manager installed and selected but judged before its rows activated gets the activation grace described under [Enable, disable, and uninstall](#enable-disable-and-uninstall).

The source's listed version is never used as the install target. Repository equality, deprecation metadata, lifecycle scripts, engine ranges, integrity metadata, and provider verification flags do not block the operation. Provider command strings are discarded.

Market installation creates no receipt, checkpoint, retry, cleanup, or rollback operation of its own. A failed or cancelled installation restores the Profile manifest and lockfile through the manager; Desktop's ordinary Profile checkpoints cover everything else.

## Automatic-install conditions

A catalog entry can reach automatic install preview only when:

- exactly one valid npm package name is normalized from the entry;
- the package is not `dsh-plugin-desktop`, `dsh-plugin-desktop-beta`, or `dsh-community-market`;
- npm `latest` is an exact stable version for that same package; and
- the npm manifest declares a safe relative DSH bundle patch path.

Failure keeps the item browseable and may expose a display-only manual command.

## Enable, disable, and uninstall

1. The Host reads the active Profile's bundles from the official plugin manager's `listBundles`.
2. Community bundles the Profile declares or selects appear in the Installed view. A bundle the manager marks official, a bundle the installation ships, a package in the `@deepseek-ai` scope, or one of Desktop's built-in bundles (`dsh-community-market`, `dshmarket`, `@agents-anywhere/dsh-bridge-next`, the Desktop packages) is managed on the official Plugins page and is not listed. A listed bundle is toggleable when the manager reports no `readOnlyReason` and it either loads or is currently selected; it is removable when the manager marks it `removable`.
3. Enable and disable submit the package name and the desired state. The Host rechecks the inventory and calls `setBundleEnabled`, which keeps the dependency installed. The manager judges activation the moment its reload returns, so a row still waiting for a service it injects is reported as a failure even when it activates right after; when the selection was saved, the Host re-reads the rows' live phases for up to five seconds and accepts the change once every row of an enabled bundle is active, or no row of a disabled bundle is live. A row that fails, or one still pending when that period ends, keeps the manager's failure.
4. Uninstall submits only the package name. The Host rechecks the inventory, returns a one-shot confirmation, rechecks again on execution, and calls `removeBundle`, which deselects and unloads the bundle before pnpm removes it.

This flow applies equally to plugins installed by Community Market, another plugin market, or the DSH CLI.

## Manual fallback

If automatic preview is unavailable, the Host may construct a bounded display-only npm command from normalized identity. **Open DSH Terminal** opens the terminal only; it sends no package command, path, or Profile and performs no mutation.

## Failure behavior

| Failure | Result |
| --- | --- |
| npm latest cannot be resolved or is not a stable DSH plugin | No package operation starts |
| Profile changes after preview | The one-shot preview is rejected |
| The manager reports a failed or cancelled change | The error is reported with the manager's bounded pnpm output; the manager has already restored the Profile files it snapshotted |
| The manager installs a bundle other than the verified package | The error is reported for diagnosis; the installed dependency stays visible in the Installed view |

For a failed package run, the Host records the manager's bounded pnpm output in the Desktop log and returns it to the local failure dialog. The dialog shows the verified package command and can open DSH Terminal, but never pastes, executes, or silently retries it.
| Renderer closes after confirmation | The Host-owned package operation continues; only the response may be lost |

A successful change applies live where the Host runs HMR. When the manager reports `restart-required`, the completion notice says that the change takes effect after the next restart; the Market never restarts Desktop.
