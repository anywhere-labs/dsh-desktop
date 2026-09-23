# System proxy inheritance for Node-side egress

Status: implemented in both editions.
English | [中文](2026-09-20-system-proxy-inheritance.zh.md)

## The gap

Desktop had two network halves with two different answers. Chromium's half — the update check, every renderer load — follows the operating system's proxy on its own. Node's half — the LLM transport, WebFetch, web search, MCP over HTTP, package installs — connected directly on every machine, because Node's `fetch` reads neither the system configuration nor `HTTP_PROXY`.

`@deepseek-ai/dsh-http-proxy` already solved this upstream, and `package.json` already declared it. Its only installation site was the CLI's `runProfile()`. Desktop boots through `boot()`, so it had never been installed. Same machine, same configuration: `dsh` in a terminal was proxied, the double-clicked icon was not. Four issues asked for this directly (#245, #431, #942, #379) and several more were downstream of it (#1052, #527, #759).

## Why the upstream installer, not a dispatcher of our own

`setGlobalDispatcher()` is not sufficient, and this is not a matter of taste. `deepseek-harness/packages/web/web-fetch-http/src/provider.ts:134-137` shows WebFetch's direct branch constructing its own per-request `Agent` with a pinned `lookup`; a global dispatcher never reaches it. Its only proxy switch is `proxyRouteFor(url).proxied`, and the state behind that is written by `installProxyFromEnvironment()` alone. The plugin market has the same shape. A dispatcher written here would have covered the LLM transport and silently missed WebFetch.

A second constraint settles it independently: the vendored package's published surface is four functions — `installProxyFromEnvironment`, `proxyRouteFor`, `proxyEnvironmentForChild`, `clearedProxyEnv`. `createPolicyDispatcher` and the rest of the policy module exist in the type declarations but are not reachable at runtime. `deepseek-harness/` is a pinned submodule and is not modified.

So the shape is: read the system configuration, express it in the environment vocabulary the upstream installer already understands, and install.

## Reading the system configuration

`session.defaultSession.resolveProxy()` answers it. Chromium already reads the Windows registry, the macOS network preferences, and the Linux desktop settings, and evaluates PAC and WPAD before answering. Re-deriving any of that here would mean reimplementing all of it and still disagreeing with the application's own windows.

Three URLs are probed rather than one, because a PAC script may route HTTPS and HTTP differently and enterprises frequently give the npm registry its own rule. `forceReloadProxyConfig()` runs first: a session can answer its first resolve before the configuration lands (electron#26166), and a false `DIRECT` there would be indistinguishable from a machine with no proxy. Failure is never fatal — the application must start on a machine whose proxy configuration cannot be read.

`src/system-proxy.ts` holds the pure part and imports nothing from Electron, because `host-process-entry.ts` imports it and that file must not reach an Electron main API.

## Precedence

An explicitly exported `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY` wins over the system configuration, matching `curl` and every browser: a user who exported one chose a route for this program specifically. In that case nothing is synthesized and the environment passes through untouched, so the upstream resolver applies its own precedence — including the `ALL_PROXY` fallback — exactly as it does for the CLI.

Otherwise the probe result becomes `http_proxy` / `https_proxy` plus a `no_proxy` that merges the user's existing entries, this machine's LAN literals, and `.local`. Loopback is added by the upstream `LOOPBACK_NO_PROXY`.

## Two installations, not one

The supervisor installs, and the Host installs again. This is not redundancy: the global dispatcher, `proxyRouteFor`'s backing state, and `proxyEnvironmentForChild`'s injection are module-private per process. The Host's installation lands before `bootDesktopHost`, because plugins mount during boot and can request immediately.

The overlay is passed across the wire rather than re-derived. A launch environment snapshot is frozen when it loads, so the supervisor's later writes to `process.env` never reach the Host's copy; and a Host that re-probed could reach a different answer than the window the user is looking at. Passing it keeps the precedence logic in one testable function.

The supervisor's installation is still load-bearing beyond its own process: `installProxyFromEnvironment` writes the resolved names back into `process.env` in both casings, which is how `host-process.ts`'s `env: { ...process.env }` carries the route to the Host and to everything it spawns — pnpm, stdio MCP servers, the bash tool.

## Accepted costs

**PAC becomes one startup snapshot.** Per-URL PAC differences are flattened to the first proxy found, and CIDR entries in a system bypass list (`10.0.0.0/8`) do not translate into `no_proxy`. Probe disagreement is detected and logged so the flattening is visible rather than silent. Loopback and this machine's LAN literals are covered explicitly.

**Changes need a restart.** No polling was added. The FAQ states it.

**SOCKS is not supported,** because the upstream package rejects it. The diagnostic is written here rather than left to the upstream resolver, which would name `HTTPS_PROXY` — a variable the user never set — and send them hunting for a misconfiguration that does not exist. Ours names the switch they can actually reach (a proxy client's HTTP or mixed port) and says that application windows and the update check are unaffected, so nobody concludes the whole app is offline.

**Shell `*_PROXY` is still not inherited.** `src/shell-environment.ts` deliberately excludes it, because a proxy URL can carry credentials, and `tests/shell-environment.spec.ts` asserts it. That was left alone. The consequence — on macOS and Linux, a proxy set only in `~/.zshrc` is invisible when launched from the Dock — is documented as a known limitation rather than papered over.

## Observability

One `outbound proxy = ...` line is written on every start, including the direct one. A report that the application cannot reach the network is unanswerable without knowing which egress route it chose, and a line that only appears on failure cannot establish that. `source` is the field triage reads first: `system`, `environment`, or `none`. The line goes through `maskSecrets`, so credentials in a proxy URL are redacted, and `diagnostic-export.ts` already bundles `userData/logs`, so "Export diagnostics" carries it into the issue.

## Verification

`tests/system-proxy.spec.ts` covers PAC parsing and the precedence table as pure functions. `tests/system-proxy-egress.spec.ts` is the one that matters most: it stands up a real HTTP server as a fake proxy and asserts that a request visibly arrives there, that loopback and the machine's LAN address do not, and that an exported proxy beats the system one. Three undici copies coexist in this application — nested inside `dsh-http-proxy`, hoisted, and Electron's built-in — and they share a dispatcher only because `setGlobalDispatcher` writes a versioned well-known symbol. Nothing declares that agreement. If an undici upgrade moves the symbol, every unit test stays green and only that egress test notices. It should not be removed.

## Follow-up

The plugin market's IP pinning (#759) is a separate change, but this one is its precondition: the fix is to skip pinning on the `proxyRouteFor(url).proxied` branch, the way `web-fetch-http` does, and that state only exists in the Host once this installs it.
