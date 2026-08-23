# WO-AERA-CODE-DESKTOP-BRANDING-AND-NATIVE-IDENTITY-CONVERGENCE-001

## Objective

Converge the proven DSH Desktop runtime into a native AERA-branded macOS product named **Aera Code**, while preserving legal provenance, existing owner state, the Canary Gateway credential boundary, and the original DSH Desktop rollback artifact.

## Accepted implementation boundary

- Install the new application at `~/Applications/Aera Code.app`.
- Use the canonical Aera Office Pro aperture and application icon assets.
- Make Aera Gateway the standard model provider and active model surface.
- Disable the DeepSeek model adapter in the Aera Code product overlay.
- Remove user-visible DSH/DeepSeek product identity without rewriting third-party package names, lockfile provenance, licence notices, or owner-created historical session titles.
- Preserve `~/Applications/DSH Desktop.app`, shared session state, Gateway Keychain custody, the Canary runtime, and the pinned upstream submodule.
- Perform exactly one final live provider proof with no retry.

## Acceptance

- Native identity, menu, About panel, icon, title bar, and application chrome say Aera Code.
- Models settings expose AERA Gateway (Canary), not DeepSeek, as the configured provider.
- The composer selects AERA Gateway Active Channel by default.
- The exact one-shot prompt returns `AERA CODE PASS`.
- Canary remains healthy with its 13-Channel catalogue intact.
- The original DSH Desktop executable remains byte-identical.
- Owner visual acceptance remains the final closure gate.
