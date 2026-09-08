# Bundled Agents Anywhere (Beta)

Desktop consumes `@agents-anywhere/dsh-bridge-next` as an external package. The
pinned tarball is built from the AA v2 commit recorded in `provenance.json`;
Desktop does not require an adjacent AA checkout at runtime. It includes the
Host and browser bundles, their source maps, and Python Connector sources.
The source code is unchanged. The manifest has a Desktop build version and
explicit peers for both Desktop runtime versions (including the emitted
`dsh-llm` and `dsh-session` imports). The SHA-256 identifies the exact shipped artifact.

## Updating

1. Check out the selected AA commit in a separate checkout.
2. In `dsh-bridge-next`, run `corepack yarn install`, `corepack yarn check`.
   Its integration tests also use `connector`, `contracts`, `desktop-workbench`,
   `web-next`, and `server` from that same checkout, plus uv/Python. Initialize
   Python dependencies before running the integration suite.
3. In a staging copy, set a new exact Desktop build version and the reviewed
   runtime peer ranges. Package `package.json`, `lib`, `cordis.patch.yml`,
   `README.md`, `RUNTIME_READS.md`, and `USER_QUESTIONS.md` beneath `package/`
   in an npm-compatible tarball. Do not run lifecycle scripts when consuming it.
4. Update both Desktop dependencies, the root Yarn lockfile and provenance.
5. Run both Desktop checks and `DSH_VERIFY_AA=1 corepack yarn workspace
   <desktop-package> verify:profile`. Verify Python sources are unpacked outside
   `app.asar`, then test device onboarding against the matching AA Server/Web.

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

## Validation of this pin

The current artifact comes from AA v2 commit
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

The source is unchanged. Desktop-specific manifest changes and the artifact
SHA-256 are recorded in `provenance.json`. Desktop validation for this update
covers both variants' profile tests and actual Host/client loading, including
failure fallback. A new signed release package is not part of this update.
