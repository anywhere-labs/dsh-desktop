# Agent Note: macOS application icon inset

Status: implemented

English | [中文](2026-08-15-macos-app-icon-inset.zh.md)

## Problem

The repository-owned iOS Default icon fills its complete 1024 by 1024 canvas. Electron Builder preserves that geometry when it creates the macOS ICNS resource, so the icon appears about one quarter larger than neighboring Dock icons. The runtime also calls `app.dock.setIcon()` with the Host-selected application icon, so changing only the packaging configuration would leave development and runtime Dock presentation inconsistent.

## Decision

`build/app-icon.png` remains the source of record and the Windows and Linux application icon. `scripts/generate-mac-app-icon.mjs` derives the macOS asset during `icons:export` on macOS and its result is committed, because libvips resampling is not byte-reproducible across platforms. The generator validates the 1024 by 1024 RGBA16 source and its ICC profile, resizes the complete artwork to 824 by 824 pixels, centers it on a transparent 1024 by 1024 canvas, and preserves its 16-bit Display P3 color data in `build/app-icon-mac.png`. The generator rejects an output path that would overwrite its source.

The macOS Electron Builder configuration uses the generated asset. The Host shell selects the same generated path on Darwin before passing its specification to the native runtime, so the installed icon, development Dock icon, and window icon use one platform decision. Windows and Linux continue to use the unchanged source asset. Both files are published and required in the physical packaged runtime so a missing generated asset fails before release.

## Verification

Package tests preserve the source icon hash, require the build command to leave the committed exports untouched, and verify that the generated PNG remains a 1024 by 1024 RGBA16 image with the source ICC profile. Decoded geometry must contain exactly 824 by 824 pixels of artwork at a 100-pixel inset. Host tests require Darwin to select the generated asset and Windows and Linux to select the source. Packaged-runtime tests reject either missing physical asset.

## Alternatives considered

**Replace the shared source icon.** Adding transparent space to the original would also shrink the Windows and Linux icon, even though the reported mismatch is specific to the macOS Dock.

**Change only `build.mac.icon`.** The runtime explicitly updates the Dock icon, so packaging-only selection would produce different results between installed and development runs.

**Maintain a hand-edited macOS bitmap.** A deterministic generator keeps the derivative reproducible, validates the source assumptions, and prevents the platform variants from drifting independently.
