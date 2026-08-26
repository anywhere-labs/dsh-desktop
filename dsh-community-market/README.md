# DSH Community Market

[中文说明](README.zh.md)

DSH Community Market is the open plugin market built into [DSH Desktop](../README.en.md). It discovers plugins from user-selected catalog sources and performs simple npm package operations against the active Desktop Profile.

> A catalog listing or an installable result is not a security review, compatibility guarantee, or endorsement. Installed plugins run locally with the user's permissions.

## Product behavior

The Market has four views:

1. **Discover** browses the selected source, with search, category filters, details, and source attribution.
2. **Installable** shows normalized entries that expose one unambiguous npm package identity. It does not trust a source-provided version.
3. **Installed** reads direct plugin dependencies from the active Profile. It includes plugins installed by this Market, another market, or the DSH CLI. Removable plugins offer **Uninstall** only; core bundles remain read-only.
4. **Sources** saves, orders, and selects catalog sources. Exactly one source is active for browsing.

The Renderer never sends a package name or package-manager command for an installation. It submits the selected source and item identity, then the Host resolves the normalized package identity it previously observed.

## Automatic installation

Automatic installation deliberately has a small qualification boundary:

- the selected catalog entry exposes exactly one valid npm package name;
- the package is not a Desktop-owned product bundle;
- the official npm registry's `latest` endpoint returns the same package name and an exact stable version; and
- that npm manifest declares a valid `dsh.bundle.patch` path.

Source versions, verification badges, repository equality, deprecation metadata, lifecycle scripts, engine ranges, tarball integrity metadata, and build-allowance claims do not decide Market eligibility. pnpm remains responsible for resolving and installing the requested exact npm version.

After confirmation, the Host calls only `desktopPnpm.run(argv)`, adds the exact npm version, and reconciles the package into `dsh.profile.bundles`. The Market creates no install receipt, snapshot, retry, cleanup, or rollback path. Recovery is handled by Desktop's unified three-slot healthy-start checkpoints.

## Uninstall and cross-market compatibility

The Installed view is derived from the active Profile's direct dependencies and bundle list, not from Market receipts or the selected catalog. This makes plugins installed by external markets and the DSH CLI visible without special integration.

Uninstall preview accepts only the generation-scoped opaque `bundleId` returned by Desktop inventory. The Host resolves it to the current direct dependency, confirms it is removable, and runs `desktopPnpm.run(['remove', packageName])`. The Market does not provide enable or disable operations.

## Catalog sources

Anyone may publish a source implementing the public [`catalog-source`](docs/schemas/catalog-source.schema.json) and [`catalog-provider-page`](docs/schemas/catalog-provider-page.schema.json) contracts. Existing APIs can be integrated through reviewed local adapters. Remote source data is normalized before the Client sees it, and provider commands are never displayed or executed.

[DSH 1024Store](https://github.com/imsai-sh/awesome-deepseek-harness-plugins) is an optional cooperating source. Desktop uses its current paginated `/api/v2/plugins` directory for browsing, search, sorting, and categories instead of the frozen 500-item v1 compatibility feed. The v2 command is never executed: an exact plain `dsh plugin --profile … add <npm-package>` shape contributes only the npm package identity, and npm `latest` remains the version authority during install preview. Browse-only GitHub targets remain visible without being marked automatically installable.

[dshfind](https://dshfind.com) is another optional cooperating source. Its adapter walks the provider's versioned REST pages and normalizes structured npm identity without executing provider command text. Any provider-supplied version remains informational; automatic installation still resolves npm `latest`.

Source requests are HTTPS-only, credential-free, bounded, and protected against unsafe redirects and private-network destinations. A source failure never changes the user's selected source or blocks DSH Desktop startup.

## Manual installation

When automatic installation is unavailable, the details dialog may show a bounded, display-only npm command reconstructed by the Host. **Open DSH Terminal** only opens Desktop's terminal; it does not paste or execute the command.

## Documentation

- [Install and uninstall](docs/install-and-uninstall.md)
- [Market shell](docs/market-shell.md)
- [Catalog provider contract](docs/catalog-provider-contract.md)
- [Catalog adapter guide](docs/catalog-adapter-guide.md)
- [Security](SECURITY.md)
- [Desktop plugin services](../dsh-plugin-desktop/docs/plugin-services.md)

## License and attribution

Package code and documentation are licensed under the [MIT License](LICENSE). No third-party catalog snapshot, provider command, or artwork is bundled in this package. Catalog providers remain independent projects responsible for their own metadata and service policies.
