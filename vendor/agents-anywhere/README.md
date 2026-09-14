# Bundled Agents Anywhere (Beta)

Desktop consumes `@agents-anywhere/dsh-bridge-next` as an external package. The
pinned tarball is built from the AA v2 commit recorded in `provenance.json`;
Desktop does not require an adjacent AA checkout at runtime. It includes the
Host and browser bundles, their source maps, and Python Connector sources.
The source code is unchanged. The manifest has a Desktop build version and
explicit peers for both Desktop runtime versions (including the emitted
`dsh-llm` and `dsh-session` imports). The SHA-256 identifies the exact shipped artifact.

## Release-time updates

Root `dev`, `dev:beta`, `dist:*` and `package:dir*` commands first run
`yarn aa:prepare-release`.
This resolves the latest GitHub `main` commit once, fetches that exact commit into
an isolated temporary checkout, and builds `dsh-bridge-next` with the Connector
sources from the same commit. It never changes an adjacent AA checkout.
Each development launch checks GitHub once before starting Desktop; it does
not poll or update the running application. Direct workspace commands use the
installed pin; PR CI continues to validate the committed pin without querying
AA's moving branch.

```sh
# Read-only comparison with the current remote main head
corepack yarn aa:check
# Prepare the latest AA package without packaging Electron
corepack yarn aa:prepare-release
# Development: resolve latest AA, then launch Desktop
corepack yarn dev
# Normal release: resolve latest AA, then package Desktop
corepack yarn dist:mac:beta
# Reproduce the committed AA artifact without contacting GitHub
DSH_AA_SOURCE_REF=pinned corepack yarn dist:mac:beta
# Select an exact full 40-character commit instead of the moving branch
DSH_AA_SOURCE_REF=<commit> corepack yarn aa:prepare-release
```

On Windows PowerShell, set `$env:DSH_AA_SOURCE_REF = 'pinned'` before running
Yarn, then remove the variable when returning to latest builds. An alternative
repository (for example an authenticated SSH URL) can be supplied through
`DSH_AA_SOURCE_REPOSITORY`. The default is the public AA GitHub repository.
`DSH_AA_SOURCE_REF` accepts a branch name, full commit SHA, or `pinned`.

The preparation step runs AA's build, typecheck and build-artifact checks. It
removes prepack/postpack hooks in staging because the full upstream integration
suite requires additional Server/Web/Python fixtures. It updates both Desktop
package dependencies, `yarn.lock`, and `provenance.json`. Artifacts have distinct
versions keyed by source commit and Desktop peer ranges; unchanged, checksum-
verified inputs reuse the current artifact. Old artifacts remain available.
Review and commit the generated dependency, artifact and provenance changes
when adopting an update into the repository.

Network, source build, or dependency-install failures stop packaging; they do
not silently ship the old plugin. On failure the dependency manifests, lockfile
and provenance are restored. If root installation had started, rerun
`corepack yarn install --immutable` to restore installed dependencies before
retrying. The source SHA and artifact checksum identify exactly what shipped.
`pinned` verifies the committed tarball checksum and requires dependencies to
have been installed normally first.

These checks do not guarantee compatibility with every future AA change.
Before adopting an update, validate both Desktop variants and run
`DSH_VERIFY_AA=1 corepack yarn workspace <desktop-package> verify:profile`.
Verify Connector sources are unpacked outside `app.asar` and test onboarding
against the matching AA Server/Web. The historical validation below applies
only to its named commit.

## Product behavior

The AA option is stored per Profile in Desktop preferences, independently of the
market provider. Old preferences and first-run selections default to disabled;
skipping Setup explicitly saves disabled. Safe Mode excludes AA. Changing the
option acknowledges persistence before scheduling a Desktop restart.

Enabling adds AA to the selected bundle list, resolves it through the same
Desktop/Profile package overlay as dshmarket, and reads the package's declared
`dsh.bundle.patch`. Desktop preserves that patch and supplies only the real
DSH home and the physical Connector payload path required by Electron ASAR.
The package retains ownership of login, device pairing, account storage, and
its native runtime endpoint. Desktop does not rewrite `stateRoot` or invent a
separate DSH home for each Profile. Native AA account/device state may therefore
be reused across Profiles; the Desktop enable/disable preference stays per Profile.

A missing or malformed bundle, invalid canonical entry, missing Connector
payload, or conflicting AA user patch disables AA for that generation. Desktop
logs the diagnostic and Settings shows a retry action. This preflight follows
the market loading boundary; it does not suppress arbitrary errors thrown later
by a plugin during Cordis initialization.

Connector startup requires uv (on PATH or via `UV_PATH`) and Python 3.12+, and
may download Python dependencies. AA's native handling of an installed Agents
Anywhere desktop app remains in effect. The older `@agents-anywhere/dsh-bridge`
is a separate user plugin, not the bundled `dsh-bridge-next`; its configuration
is not migrated or removed by this option.

The earlier integration wrote AA accounts under each Profile's `agents-anywhere`
directory. Those files are preserved but are no longer selected automatically;
users may need to sign in once using AA's native state directory. No account,
credential, or device binding is silently copied between the two layouts.

## Validation history

The current artifact was prepared by the release script from AA v2 commit
`c26402633cb840d376048b0bdb42c2db59e7cb33`. Build, typecheck and build-artifact
checks passed. Both Desktop variants passed actual AA Host/client profile
loading, and repeating preparation reused the verified artifact. No signed
Electron package or interactive device onboarding was tested for this update.

The previous manually prepared artifact came from AA v2 commit
`ae47731c50f02033728faed1ba55f95c8008ec86` and includes the matching Python
Connector sources. This updates deleted-device recovery during a fresh login,
Windows discovery (avoiding `os.kill(pid, 0)`), and Windows-safe `pwd` imports.
The plugin configuration and bundle contracts remain unchanged; `dsh-session`,
`dsh-llm`, and `dsh-typert-protocol` retain explicit Desktop-compatible peers.

In an isolated source export, TypeScript checking, Host/client builds, build
artifact and real Client factory DOM checks passed. All 111 plugin tests passed
with `--test-concurrency=1`; 35 targeted Connector tests passed, including the
Windows regression tests. This includes controlled Python/backend integration,
not an interactive real-model, phone, or native Windows acceptance test.

That update left source code unchanged. Desktop validation for that update
covers both variants' profile tests and actual Host/client loading, including
failure fallback. A new signed release package is not part of this update.
