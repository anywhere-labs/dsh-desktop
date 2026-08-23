# Build Notes

## Toolchain

- Yarn: `4.18.0`
- Electron: `43.4.0`
- electron-builder: `26.15.7`
- Platform: macOS arm64
- Bundle identifier: `dev.aerastudios.code`
- Product name: `Aera Code`

## Validation

- Focused identity/package tests: 17 passed.
- Strict TypeScript checks: passed.
- Full desktop test campaign: 763 passed, 4 skipped.
- Runtime closure: 201 first-party nodes form a closed reachable graph.
- Licence verification: 544 production packages checked; two notice-required LGPL packages retained in third-party notices.
- `git diff --check`: passed.
- Deep strict code-signature verification: passed.

## Artifact

- Installed path: `/Users/Allyd/Applications/Aera Code.app`
- Architecture: arm64
- Version: `2.0.2`
- `app.asar` SHA-256: `56badb6e396d33336f2a9a6f854cfa13e5acbe90128b2b65fd018891381ce15f`
- Signature authority: `VoiceInk Local Developer`
- Notarization: not performed; this is a local acceptance artifact, not a public distribution claim.
