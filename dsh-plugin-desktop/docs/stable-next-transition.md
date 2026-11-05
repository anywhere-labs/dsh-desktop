# Stable transition to Next

The Stable app announces that Next is planned to replace it after the next release. The notice appears once per app launch until the user presses **Don't show again**. Pressing **OK**, closing the notice or pressing Escape shows it again on the next launch. The opt-out is a dedicated button rather than a checkbox: on macOS the dialog checkbox could not be ticked, so the notice returned on every launch (#1418). The opt-out is stored in `notices/next-transition-v1` under Electron user data, independently of profiles and the installed version. Stable development runs (`corepack yarn dev`) also show the notice. Beta and Next do not show it.

## Publishing the successor

Stable keeps requesting `X-DSH-Desktop-Channel: stable`. When the successor is ready for Stable users, publish its version through that stream, for example:

```json
{ "version": "2.0.20-next", "channel": "stable" }
```

The existing unlabelled Stable response remains supported. A response explicitly labelled `next` is still rejected by Stable; do not redirect Stable clients to the experimental Next stream. Both `-next` and `-next.N` versions are supported. Ordinary Stable versions continue to work, and Beta/RC versions remain rejected by the Stable stream.

The successor must compare newer than the installed version under SemVer. In particular, `2.0.20-next` does not upgrade `2.0.20`; use a higher core version. No automatic downgrade is enabled.

The matching macOS/Windows download endpoint must serve the promoted installer for `channel=stable` and its exact `X-DSH-Desktop-Target-Version`. Keep the version response and installer publication aligned; optional SHA-256 digests remain enforced. The client rechecks the Stable stream after download confirmation and stops if the target changes. User confirmation remains required before downloading or launching the installer.

Next installers use the `DSH-NEXT` filename and a confirmation explaining that DSH NEXT installs as a separate app. macOS instructions tell users to add and open DSH NEXT. This change does not rename the apps, change their application identities, or implement data migration. Next's own update channel remains `next`.
