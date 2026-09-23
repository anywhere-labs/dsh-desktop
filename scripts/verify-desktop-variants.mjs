import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
// Both editions share behavior. Only release identity, launcher wording, and the
// channels' pinned core versions differ.
// `startup-audit.ts` re-runs 0.1.7's `auditStartupEntries` against the Host
// logger. Stable's rc.2 runtime does not export it.
const betaOnlyPaths = new Set(['profile-context.ts', 'startup-audit.ts'])
const allowedDifferences = new Set([
  'product-identity.ts',
  // Beta rides dsh 0.1.7, which collapsed the executor's two argv seams into one:
  // `runArgv`/`startArgv` are gone and `executeArgv(spec, argvOrPrepare, onStarted?)` returns
  // a single ShellExecution handle for foreground and background callers alike, so beta
  // adapts the ACL argv in exactly one override. 0.1.7 also boxes every pwsh-local Config
  // field in a Volatile reference, so beta's `pwshPath` default reads through `.get()`
  // instead of substituting a plain string. Stable stays on 0.1.5-rc.2, whose override takes
  // an argv array on `runArgv`, returns ShellRunResult, and reads bare config values.
  'windows-pwsh-sandbox.ts',
  // dsh 0.1.6-alpha.2 dropped the profile patch-reload policy: `patchReload` is gone from
  // ProfileTemplate, Profile, and the profile manifest, `initProfile` takes two arguments,
  // and reload is owned by the `hmr` entry in a profile's cordis.patch.yml instead. Beta
  // follows that API; stable stays on 0.1.5-rc.2, where the field still exists.
  'profile.ts',
  'profile-manager.ts',
  // dsh 0.1.7-alpha.1 raised SESSION_FORMAT_VERSION from 3 to 4, so the packaged
  // migration smoke asserts a V4 header and a `session.v4.jsonl` publication. Stable
  // stays on 0.1.5-rc.2, which still migrates V2 logs to V3. Both editions keep the
  // same V2 input fixture and the same byte-identity assertion on it.
  'packaged-runtime-smoke.ts',
  // dsh 0.1.7-alpha.1 split `@deepseek-ai/dsh-agent-presets` into
  // `@deepseek-ai/dsh-agent-preset` (which ships the Cordis `skills/` tree at its
  // package root) and `@deepseek-ai/dsh-agent-preset-registry`, so beta reads bundled
  // skills from `dsh-agent-preset/skills` where stable reads them from
  // `dsh-agent-presets/presets/cordis/skills`. The discovered skill names are identical.
  'packaged-filesystem-smoke.ts',
  // dsh 0.1.7-alpha.1 replaced the `SettingsProvider` service with `SettingsForms`:
  // `ctx.settings.register(namespace, schema, { applies, validate })` and the returned
  // scope's `get`/`set`/`watch` are gone, a plugin now publishes its editable fields by
  // marking its own Config entries `.volatile()` under its Loader entry id, validation
  // moves to the `internal/config` waterfall, and updates arrive as
  // `loader/volatile-update` (own fiber) or `settings/document-updated` (no value).
  // Both editions route every settings call through this one adapter so the shared host
  // files above stay byte-identical; stable's copy implements the same exports on
  // 0.1.5-rc.2's `SettingsProvider`.
  'settings-bridge.ts',
  // dsh 0.1.7-alpha.1 removed `JobRegistry#onJobDone` and the `JobSnapshot`
  // projection: settlements now arrive on the filtered `jobs.events` stream as
  // a `settled` event carrying a `JobView`. Desktop's notification policy only
  // ever read the terminal status, so both editions narrow their own core's
  // completion seam to one shared outcome here.
  'jobs-bridge.ts',
  // Same split on the client: 0.1.7 renamed `ctx.settingsScope.bind({ namespace })` to
  // `ctx.configForms.get(entryId)` and `SettingsScope<T>` to `ConfigForm<T>`, whose
  // mutators resolve `boolean` instead of `void`. The settings section and its inject
  // list read the edition-neutral names from here.
  'client/settings-bridge.ts',
])
const normalizeIdentity = source => source.toString().replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop').replaceAll('DSH Desktop Beta', 'DSH Desktop')
// Allow only the alpha.2 bootstrap adapter calls, not arbitrary drift in these
// large shared entrypoints. Stable's rc.2 runtime has no ProfileContext contract.
const betaBootLines = new Set([
  "import { createDesktopProfileBoot } from './profile-context.ts'",
  'const profileBoot = createDesktopProfileBoot(prepared, desktopPnpmBootstrap)',
  'profileBoot.prepare(hostCtx)',
  'profileBoot.markReady()',
  "import { logInactiveStartupEntries } from './startup-audit.ts'",
  'void logInactiveStartupEntries(ctx, BIN_NAME)',
])
function normalizeBeta(source, path) {
  const text = normalizeIdentity(source)
  if (path !== 'main.ts' && path !== 'host-bootstrap.ts') return text
  const lines = text.split('\n')
  for (const expected of betaBootLines) {
    if (lines.filter(line => line.trim() === expected).length !== 1) {
      throw new Error(`Missing or duplicated Beta Profile adapter in ${path}: ${expected}`)
    }
  }
  return lines.filter(line => !betaBootLines.has(line.trim())).join('\n')
}

function files(directory, base = directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(path, base))
    else if (entry.isFile()) result.push(relative(base, path).split(sep).join('/'))
  }
  return result
}

const sharedPaths = new Set([...files(stableRoot), ...files(betaRoot), ...betaOnlyPaths])
const differences = []
for (const path of [...sharedPaths].sort()) {
  if (allowedDifferences.has(path)) continue
  let stable
  let beta
  try { stable = readFileSync(join(stableRoot, path)) } catch { stable = undefined }
  try { beta = readFileSync(join(betaRoot, path)) } catch { beta = undefined }
  if (betaOnlyPaths.has(path)) {
    if (stable !== undefined || beta === undefined) differences.push(`${path} (must exist only in beta)`)
    continue
  }
  if (stable === undefined || beta === undefined || normalizeIdentity(stable) !== normalizeBeta(beta, path)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size - betaOnlyPaths.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)
