# Session Log

## Custody anchor

- Repository: `deepseek-harness-desktop-build`
- Baseline commit: `6201080cfaa2f9b0864333e9da695cde71d3f1e1`
- Baseline tree: `2b1c841f8f6b4700a1749feb2bfa95e1b79f00fb`
- Governed branch: `codex/wo-aera-code-desktop-branding-001`
- Pinned upstream submodule: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- Package manager: Yarn `4.18.0`

## Implementation record

1. Introduced a central Aera Code product profile and native runtime identity.
2. Added a bounded state migration that copies only non-secret profile, plugin, market, and private-mode state.
3. Added active-profile-only Gateway Keychain bootstrap without logging or persisting credential material.
4. Adopted the canonical Aera Office Pro aperture, app icon, and colour treatment.
5. Rebranded the native menu, About panel, title bar, tray, recovery surfaces, settings, notifications, terminal actions, and early boot loader.
6. Disabled the inherited update plugin so Aera Code cannot offer a differently branded upstream artifact.
7. Pinned the agent default to provider `aera-gateway` and model `aera/active`.
8. Disabled the `llm-deepseek` adapter in the Aera Code overlay.
9. Patched the conversation projection so the internal package label `@deepseek-ai/dsh-system-prompt` is presented as `Aera Code system context`. The dependency identity remains intact in source and licence custody.
10. Preserved owner-created historical session titles; they are owner data, not packaged product identity.

## Runtime diagnosis

- An initial ad-hoc hardened signature exposed a macOS library-validation mismatch. The final package was produced and deep-signed consistently by electron-builder with the available local `VoiceInk Local Developer` identity.
- A renderer title observer initially retriggered itself. It was corrected to write only when the title actually differs.
- No credential, OAuth token, cookie, authorization header, or protected provider content was recorded in evidence.

## Live proof

- Selected UI model: `AERA Gateway Active Channel`
- Exact prompt: `Reply exactly with:` followed by `AERA CODE PASS`
- Provider requests: exactly one
- Retries: zero
- Result: exact visible response `AERA CODE PASS`
- UI telemetry: one turn, one step, completed in approximately three seconds
- Native top-ribbon drag action: completed through Computer Use without error

## Post-proof custody

- Canary `/healthz`: HTTP 200
- Canary authoritative Channel catalogue: 13 entries
- Canary mutation: none
- DSH Desktop executable SHA-256 remained `1af684f056a8eb13e49fbd677072e437316086b076e3b9b92de3ddb343edc5b1`
- Aera Code remained open for owner visual acceptance.
