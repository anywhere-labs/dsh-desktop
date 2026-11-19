# Next Linux server mode — phased implementation (Effi G40)

Status: phase 1 implementation, not a released or fully accepted server product.
Owner: dsh-desktop-next. No upstream submodule edits or runtime version changes.

## Launch contract

The Linux installation's public executable remains `dsh-desktop-next`. A POSIX
launcher dispatches `--headless` to the same Electron binary in Node mode before
Chromium starts. The real ELF is `dsh-desktop-next.bin`; fuse and ELF checks inspect
that binary. GUI arguments and internal Node-mode invocations are forwarded intact.
`afterPack` installs this launcher, and the final artifact verifier exercises it.
The development start script also forwards headless arguments to Node mode.

Source development on Linux: `corepack yarn dev:linux:headless` prepares the same
Market/AA prerequisites as `dev:next`, builds Next and its runtime, then starts
without a display. Defaults to `~/.dsh-next-headless-dev` and loopback port 18080;
`--data-dir`, `--profile` and `--port` override these. Unsupported hosts fail before
preparation; `--help` works everywhere. Entry unit tests on macOS or Linux use
`corepack yarn test:linux:headless`.

Initial packaged invocation (development feature, not yet a released user instruction):

```sh
dsh-desktop-next --headless --data-dir /absolute/dedicated-server-data --profile desktop --port 18080
```

`--help` performs no Profile initialization. Invalid options fail before importing
the Host runtime. Linux only; port 0 chooses a free port. The required dedicated
data directory avoids taking over existing Desktop Profiles in phase 1. A directory
lock rejects a second server; abnormal termination can leave this lock behind,
requiring manual verification and removal until phase 2 implements recovery.

The entry reuses NextDesktopRuntime, which owns the existing Host subprocess and
its IPC. Browser access is enabled only on 127.0.0.1 for this invocation. The printed
URL contains a short-lived login token: treat it as a credential. SSH forwarding
lets a remote browser reach the same port. Desktop preferences and onboarding
completion flags are not overwritten. Native notifications are suppressed, native
permission requests report restricted, and native terminal requests are logged.
This is not yet a complete desktop capability adaptation.

## Next-only composition

`src/headless/`, `scripts/headless/`, `tests/headless/` and explicit
`next-server:start/end` regions are declared Next product differences in the
variant checker and sync tool. These are independent of upstream API versions;
they must not disappear when Next and Beta converge. Shared portions still mirror.
Beta changes in this phase are only equivalent local-variable/formatting refactors.

## Validation and remaining phases

Phase 1 adds argument/launcher process-boundary tests and a Linux installation
smoke for help, invalid arguments, unauthenticated rejection, authenticated Web,
duplicate startup, SIGTERM and lock release. The smoke removes display variables
and uses temporary user/data directories. It is wired into final Linux verification.

Local evidence: Next build; Next and Beta typechecks; Next 1387 passing tests,
10 skipped; Beta 1381 passing tests, 13 skipped; variant consistency and diff checks.
An ARM64 Linux container using a temporary copy of the 2.0.24 rc.5 runtime plus
new compiled entries reached Host ready with no display, rejected anonymous Web
requests (401), and served authenticated Web (200). This development experiment
also passed the repeatable smoke after repacking app.asar: help, invalid arguments,
authenticated Web, duplicate startup and SIGTERM/lock release. The fixture deliberately
unpacked node_modules, so this is not the final unmodified packaging pipeline or a
GUI regression test. Next and Beta frontend verification also passed.

T489 remains open until the new release packaging path, including the launcher
hook, is verified with a freshly built installation artifact. No release is authorized.

Next phases:
- T490: robust process ownership, GUI/server exclusion, stale-lock recovery, signal
  and crash lifecycle, service restart behavior and diagnostics.
- T491: first-use setup and authentication via Web/CLI, configuration persistence.
- T492: complete desktop capability audit and browser/headless substitutes.
- T493: AA enablement, remote-browser OAuth, Connector ownership, remote actions,
  approvals and reconnection. AA was not enabled or accepted in phase 1.
- T494: installation and systemd documentation based on verified package formats.
- T495: clean Linux release-artifact acceptance, AA end-to-end and GUI regression.
