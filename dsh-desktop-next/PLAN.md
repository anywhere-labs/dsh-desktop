# Desktop Next implementation boundary

Desktop Next is a separate experimental package in the outer Yarn workspace.
Its reference is the MIT-licensed upstream `apps/desktop` and `apps/desktop-host`
at `ddefc45fbc7f8e46dd73185e68295696d1297887` (DSH 0.1.6-alpha.2).

The implementation uses an Electron shell, an Electron Node-mode Host,
the authenticated WebServer and WebSocket transport, and the official published
Web frontend without a fork. The basic macOS and Windows Desktop presentation
comes from the same upstream reference. Additional features are named Profiles,
the system tray, desktop settings and tools, recovery, the existing Agents Anywhere bridge, and the existing Community Market.
Our own enhanced-window presentation remains deferred. Stable and Beta keep
their current implementations.

Next owns its development home and Electron state. Profile switching and
recovery stop the old Host before starting the next generation. Recovery must
be reachable without loading the broken plugin graph. Market routes use the real upstream WebServer; application-origin forwarding
must preserve their mutation authority checks.
Remote control is explicitly enabled and keeps its Connector state in Next's
home. Build, typecheck, unit tests, and Host smokes must not launch a graphical
application. The optional Electron smoke uses only its Node mode.

This iteration targets a runnable development package. Signed installers,
offline release seeds, automatic updates, data migration from Stable/Beta,
and enhanced windows require separate release qualification.

The tray and recovery controls are owned by Electron main independently of Host
readiness. A separate ephemeral home implements non-destructive safe mode;
configuration repair and rollback back up files before writing. The ordinary
browser gate covers HTTP, fallback documents, and WebSocket upgrades. Optional
LAN HTTPS uses the existing certificate and ingress boundaries with an OS-sealed
CA key. The official Settings slot and fallback window share the same controls.
