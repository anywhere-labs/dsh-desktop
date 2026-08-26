import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../', packageRoot)
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  name?: unknown
  version?: unknown
  bin?: Record<string, unknown>
  exports?: Record<string, unknown>
  files?: unknown
  scripts?: Record<string, unknown>
  dsh?: { bundle?: { patch?: unknown }; client?: unknown }
  build?: {
    productName?: unknown
    appId?: unknown
    asarUnpack?: unknown
    afterPack?: unknown
    electronFuses?: unknown
    toolsets?: Record<string, unknown>
    files?: unknown
    mac?: {
      extendInfo?: unknown
      hardenedRuntime?: unknown
      icon?: unknown
      mergeASARs?: unknown
      notarize?: unknown
      signIgnore?: unknown
      target?: unknown
      x64ArchFiles?: unknown
    }
    win?: { icon?: unknown; target?: unknown; artifactName?: unknown }
    nsis?: Record<string, unknown>
    portable?: Record<string, unknown>
    linux?: { icon?: unknown }
  }
  dependencies?: Record<string, unknown>
  optionalDependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}
const workspaceManifest = JSON.parse(readFileSync(new URL('package.json', workspaceRoot), 'utf8')) as {
  version?: unknown
  resolutions?: Record<string, unknown>
  scripts?: Record<string, unknown>
}
const ciWorkflow = readFileSync(new URL('.github/workflows/ci.yml', workspaceRoot), 'utf8')

describe('published package surface', () => {
  it('runs desktop and community market typechecks from the root command', () => {
    expect(workspaceManifest.scripts?.typecheck)
      .toBe('yarn workspace dsh-plugin-desktop typecheck && yarn workspace dsh-community-market typecheck')
  })

  it('runs desktop and community market tests from the root command', () => {
    expect(workspaceManifest.scripts?.test)
      .toBe('yarn workspace dsh-plugin-desktop test && yarn workspace dsh-community-market test')
  })

  it('registers both npm launcher names', () => {
    expect(manifest.name).toBe('dsh-plugin-desktop')
    expect(manifest.bin).toEqual({
      'dsh-plugin-desktop': 'lib/bin.js',
      'dsh-desktop': 'lib/bin.js',
    })
  })

  it('exposes the Host plugin and desktop-owned client face', () => {
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./windows-pwsh-sandbox', {
      types: './lib/types/windows-pwsh-sandbox.d.ts',
      default: './lib/windows-pwsh-sandbox.js',
    })
    expect(manifest.exports).toHaveProperty('./windows-subprocess', {
      types: './lib/types/windows-subprocess.d.ts',
      default: './lib/windows-subprocess.js',
    })
    expect(manifest.exports).not.toHaveProperty('./windows-agent-presets')
    expect(manifest.exports).toHaveProperty('./terminal', {
      types: './lib/types/terminal.d.ts',
      default: './lib/terminal.js',
    })
    expect(manifest.exports).toHaveProperty('./pnpm', {
      types: './lib/types/pnpm.d.ts',
      default: './lib/pnpm.js',
    })
    expect(manifest.exports).toHaveProperty('./profile-service', {
      types: './lib/types/profile-service.d.ts',
      default: './lib/profile-service.js',
    })
    expect(manifest.exports).toHaveProperty('./profiles', {
      types: './lib/types/profiles.d.ts',
      default: './lib/profiles.js',
    })
    expect(manifest.exports).toHaveProperty('./diagnostics', {
      types: './lib/types/diagnostics.d.ts',
      default: './lib/diagnostics.js',
    })
    expect(manifest.exports).toHaveProperty('./updates', {
      types: './lib/types/updates.d.ts',
      default: './lib/updates.js',
    })
    expect(manifest.exports).toHaveProperty('./notifications', {
      types: './lib/types/notifications.d.ts',
      default: './lib/notifications.js',
    })
    expect(manifest.exports).not.toHaveProperty('./windows-acl-runner')
    expect(manifest.exports).not.toHaveProperty('./desktop-cli')
    expect(manifest.exports).not.toHaveProperty('./desktop-runtime-environment')
    expect(manifest.exports).not.toHaveProperty('./desktop-terminal')
    expect(manifest.exports).not.toHaveProperty('./update-checker')
    expect(manifest.exports).not.toHaveProperty('./update-download')
    expect(manifest.exports).toHaveProperty('./package.json')
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(manifest.dsh?.client).toEqual({
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-api-remotes',
        '@deepseek-ai/dsh-client-connection',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-renderer',
        '@deepseek-ai/dsh-client-ui-settings',
        '@deepseek-ai/dsh-client-ui-theme',
      ],
    })
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).not.toContain('name: dsh-community-market')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/terminal')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/pnpm')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/profiles')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/diagnostics')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/notifications')
    expect(readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')).toContain('name: dsh-plugin-desktop/updates')
  })

  it('pins both selectable Market providers in the published runtime', () => {
    expect(manifest.dependencies).toMatchObject({
      'dsh-community-market': '0.1.0-dev.0',
      dshmarket: '1.17.1',
    })
    expect(manifest.optionalDependencies ?? {}).not.toHaveProperty('dshmarket')
  })

  it('patches app boot to accept an empty patch layer', () => {
    const patchPath = './patches/dsh-app-boot@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-app-boot@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-app-boot@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const marker = 'if (parsed === void 0 || parsed === null) return [];'
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedBoot = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js',
      packageRoot,
    ), 'utf8')
    expect(patch).toContain(marker)
    expect(installedBoot).toContain(marker)
  })

  it('patches the agent loop to stop after one empty-name tool call', () => {
    const patchPath = './patches/dsh-agent-loop@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-agent-loop@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-agent-loop@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedLoop = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      'const EMPTY_TOOL_NAME_ERROR = "assistant emitted a tool call with an empty tool name";',
      'const EMPTY_TOOL_NAME_RESULT = "Error: assistant emitted a tool call with an empty tool name.',
      'appendEmptyToolCallFailure(session, turn, step, first.block);',
      'if (hasEmptyToolCallName(candidate.block)) break;',
    ]) {
      expect(patch).toContain(marker)
      expect(installedLoop).toContain(marker)
    }
  })

  it('patches the browse panel with the Windows native-picker icon bridge', () => {
    const patchPath = './patches/dsh-client-ui-directory-picker-browse@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-client-ui-directory-picker-browse@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-client-ui-directory-picker-browse@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-directory-picker-browse/lib/client.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      '__DSH_DESKTOP_PICK_DIRECTORY__',
      '__DSH_DESKTOP_VALIDATE_DIRECTORY__',
      'openDirectory(path)',
      'openDirectory(targetPath)',
      'IconFolderOpen16',
      'nativePickerButton',
      'browser.nativePicker',
      'border:1px solid var(--dsw-alias-border-l2)',
      'background:var(--dsw-alias-bg-layer-2)',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('patches the browse backend to skip unreadable directory-looking entries', () => {
    const patchPath = './patches/dsh-host-directory-picker-browse@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-host-directory-picker-browse@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-host-directory-picker-browse@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedHost = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-host-directory-picker-browse/lib/index.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      'Windows reparse/system directories may appear as directories but fail `stat`',
      'let enterable = false;',
      'if (isDirectory || isSymbolicLink) try {',
    ]) {
      expect(patch).toContain(marker)
      expect(installedHost).toContain(marker)
    }
  })

  it('marks the upstream Workspace browser as the desktop folder-drop target', () => {
    const patchPath = './patches/dsh-client-ui-workspace@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-client-ui-workspace@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-client-ui-workspace@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
      packageRoot,
    ), 'utf8')
    expect(patch).toContain('data-dsh-workspace-drop-target')
    expect(installedClient).toContain('data-dsh-workspace-drop-target')
  })

  it('keeps API selection available after overriding a provider base URL', () => {
    const patchPath = './.yarn/patches/@deepseek-ai-dsh-client-ui-settings-models-npm-0.1.1-rc.2-5348824733.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-client-ui-settings-models@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-client-ui-settings-models@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      'const baseURLOverridden = schema.hasPath(draft, ["baseURL"])',
      'const canCustomizeApi = ownsIdentity || baseURLOverridden',
      'canCustomizeApi ? (0, react_jsx_runtime.jsxs)("div"',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('adds bilingual search copy to the fetched-model picker', () => {
    const patch = readFileSync(new URL(
      '../patches/dsh-client-ui-settings-models@0.1.1-rc.2.patch',
      packageRoot,
    ), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      'fetchSearch: "Search models"',
      'fetchSearchPlaceholder: "Search by model ID or name"',
      'fetchNoMatches: "No models match the current search."',
      'fetchSearch: "搜索模型"',
      'fetchSearchPlaceholder: "按模型 ID 或名称搜索"',
      'fetchNoMatches: "当前搜索没有匹配的模型。"',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('filters fetched-model candidates before rendering and bulk selection', () => {
    const patch = readFileSync(new URL(
      '../patches/dsh-client-ui-settings-models@0.1.1-rc.2.patch',
      packageRoot,
    ), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      'const [candidateQuery, setCandidateQuery] = (0, react.useState)("")',
      'const normalizedCandidateQuery = candidateQuery.trim().toLowerCase();',
      'const filteredCandidates = normalizedCandidateQuery.length === 0 ? activeCandidates : activeCandidates.filter((candidate) => {',
      'const haystacks = [candidate.id, candidate.name].filter((value) => typeof value === "string");',
      'filteredCandidates.length === 0 ? (0, react_jsx_runtime.jsx)("p", {',
      'children: t("fetchNoMatches")',
      'children: filteredCandidates.map((candidate) => (0, react_jsx_runtime.jsx)("li", {',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('preserves picked models outside the active filter when bulk-clearing matches', () => {
    const patch = readFileSync(new URL(
      '../patches/dsh-client-ui-settings-models@0.1.1-rc.2.patch',
      packageRoot,
    ), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      'const allFilteredCandidatesPicked = filteredCandidates.length > 0 && filteredCandidates.every((candidate) => picked.has(candidate.id));',
      'for (const candidate of filteredCandidates) next.delete(candidate.id);',
      'for (const candidate of filteredCandidates) next.add(candidate.id);',
      'disabled: filteredCandidates.length === 0',
      'children: t(allFilteredCandidatesPicked ? "fetchDeselectAll" : "fetchSelectAll")',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('preserves model input modalities in the Host session catalog', () => {
    const patchPath = './patches/dsh-host-apiproxy-model-modalities@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-host-apiproxy@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-host-apiproxy@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedRoot = new URL(
      'node_modules/@deepseek-ai/dsh-host-apiproxy/',
      packageRoot,
    )
    const installedRuntime = readFileSync(new URL('lib/index.js', installedRoot), 'utf8')
    const installedSchema = readFileSync(
      new URL('lib/types/api/sessions.schema.js', installedRoot),
      'utf8',
    )
    const installedTypes = readFileSync(
      new URL('lib/types/api/sessions.d.ts', installedRoot),
      'utf8',
    )
    const schemaMarker = 'inputModalities: z.array(z.enum([\'text\', \'image\'])).optional()'
    const projectionMarker = '{ inputModalities: [...model.inputModalities] }'

    expect(patch).toContain(schemaMarker)
    expect(patch).toContain(projectionMarker)
    expect(installedRuntime).toContain('inputModalities: z$1.array(z$1.enum(["text", "image"])).optional()')
    expect(installedRuntime).toContain(projectionMarker)
    expect(installedSchema).toContain(schemaMarker)
    expect(installedTypes).toContain("inputModalities?: readonly ('text' | 'image')[];")
  })

  it('localizes Trajectory toolbar labels in Simplified Chinese', () => {
    const patchPath = './patches/dsh-client-ui-trajectory@0.1.1-rc.2.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-client-ui-trajectory@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-client-ui-trajectory@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js',
      packageRoot,
    ), 'utf8')
    for (const marker of [
      '"toolbar.duration": "耗时"',
      '"toolbar.useActualDuration": "使用实际耗时"',
      '"toolbar.useEqualWidth": "使用等宽操作"',
      '"toolbar.turns": "轮次"',
      '"toolbar.expandTurns": "展开轮次"',
      '"toolbar.collapseTurns": "折叠轮次"',
      '"toolbar.calls": "调用"',
      '"toolbar.expandCalls": "展开调用"',
      '"toolbar.collapseCalls": "折叠调用"',
      '"toolbar.thinking": "思考"',
      'children: [trajectoryLabel("toolbar.thinking")',
      'currentTrajectoryT = t',
    ]) {
      expect(patch).toContain(marker)
      expect(installedClient).toContain(marker)
    }
  })

  it('keeps Desktop boot from opening an external browser and hides explicit Windows helpers', () => {
    const patchPath = './patches/dsh-web-app@0.1.1-rc.2.patch'
    const openPatchPath = './patches/open@11.0.1.patch'
    const openPatchResolution = `patch:open@npm%3A11.0.1#${openPatchPath}`
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-web-app@npm:0.1.1-rc.2': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-web-app@npm:^0.1.1-rc.2': expect.stringContaining(patchPath),
      'open@npm:11.0.1': openPatchResolution,
      'open@npm:^11.0.0': openPatchResolution,
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const openPatch = readFileSync(new URL(openPatchPath, workspaceRoot), 'utf8')
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const installedWebApp = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-web-app/lib/index.js',
      packageRoot,
    ), 'utf8')
    const installedOpen = readFileSync(new URL('node_modules/open/index.js', packageRoot), 'utf8')
    const installedWebPatch = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml',
      packageRoot,
    ), 'utf8')
    const desktopPatch = readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')
    for (const marker of [
      'ELECTRON_RUN_AS_NODE: "1"',
      "name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'",
    ]) {
      expect(patch).toContain(marker)
      expect(installedWebApp).toContain(marker)
    }
    expect(patch).toContain('+\t\twindowsHide: true,')
    expect(installedWebApp).toMatch(
      /function spawnBrowserLauncher\(url\) \{\s+return spawn\(process\.execPath, \[[\s\S]*?\], \{\s+windowsHide: true,\s+env:/u,
    )
    expect(lockfile).toContain('open@patch:open@npm%3A11.0.1#./patches/open@11.0.1.patch')
    expect(openPatch).toContain('+\t\t\tchildProcessOptions.windowsHide = true;')
    expect(installedOpen).toMatch(
      /if \(!isWsl\) \{\s+childProcessOptions\.windowsVerbatimArguments = true;\s+childProcessOptions\.windowsHide = true;\s+\}/u,
    )
    expect(patch).toContain('openBrowser: false')
    expect(installedWebPatch).toContain('openBrowser: false')
    expect(installedWebPatch).not.toContain('openBrowser: !!js ctx.webStartup.openBrowser')
    expect(desktopPatch).toMatch(/- id: web-runtime\n  config:\n    openBrowser: false/)
  })

  it.runIf(process.platform === 'win32')(
    'launches the browser opener helper through Electron Node mode',
    () => {
      const require = createRequire(new URL('package.json', packageRoot))
      const electronPath = require('electron') as string
      const webAppEntry = require.resolve('@deepseek-ai/dsh-web-app')
      const root = mkdtempSync(join(tmpdir(), 'dsh-browser-opener-'))
      const fakePowerShellDir = join(root, 'System32', 'WindowsPowerShell', 'v1.0')
      const fakePowerShell = join(fakePowerShellDir, 'powershell.exe')
      const main = join(root, 'main.mjs')
      const environment = { ...process.env }
      for (const name of Object.keys(environment)) {
        if (name.toUpperCase() === 'SYSTEMROOT' || name.toUpperCase() === 'WINDIR') delete environment[name]
      }
      environment.SYSTEMROOT = root

      try {
        mkdirSync(fakePowerShellDir, { recursive: true })
        copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), fakePowerShell)
        writeFileSync(main, [
          `import { internals } from ${JSON.stringify(pathToFileURL(webAppEntry).href)}`,
          `await internals.openBrowser('http://127.0.0.1:9/')`,
          `process.stdout.write('OPEN_OK')`,
          `process.exit(0)`,
          '',
        ].join('\n'))

        const stdout = execFileSync(electronPath, [main], {
          encoding: 'utf8',
          env: environment,
          timeout: 30_000,
          windowsHide: true,
        })
        expect(stdout).toContain('OPEN_OK')
        expect(stdout).not.toContain('Unable to find Electron app')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
    45_000,
  )

  it('builds public Host plugins and their private native bootstraps', () => {
    const config = readFileSync(new URL('tsdown.config.ts', packageRoot), 'utf8')

    expect(config).toContain("'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts'")
    expect(config).toContain("'windows-subprocess': 'src/windows-subprocess.ts'")
    expect(config).not.toContain("'windows-agent-presets': 'src/windows-agent-presets.ts'")
    expect(config).toContain("'windows-acl-runner': 'src/windows-acl-runner.ts'")
    expect(config).toContain("'desktop-cli': 'src/desktop-cli.ts'")
    expect(config).toContain("'desktop-runtime-environment': 'src/desktop-runtime-environment.ts'")
    expect(config).toContain("'desktop-terminal': 'src/desktop-terminal.ts'")
    expect(config).toContain("'profile-manager': 'src/profile-manager.ts'")
    expect(config).toContain("'profile-service': 'src/profile-service.ts'")
    expect(config).toContain("pnpm: 'src/pnpm.ts'")
    expect(config).toContain("profiles: 'src/profiles.ts'")
    expect(config).toContain("diagnostics: 'src/diagnostics.ts'")
    expect(config).toContain("notifications: 'src/notifications.ts'")
    expect(config).toContain("'diagnostic-export-worker': 'src/diagnostic-export-worker.ts'")
    expect(config).toContain("entry: { preload: 'src/preload.ts' }")
    expect(config).toContain("entryFileNames: 'preload.cjs'")
    expect(config).toContain("terminal: 'src/terminal.ts'")
    expect(config).toContain("'update-download': 'src/update-download.ts'")
    expect(config).toContain("updates: 'src/updates.ts'")
  })

  it('builds the browser client without Node process globals', () => {
    const config = readFileSync(new URL('tsdown.config.ts', packageRoot), 'utf8')
    const client = readFileSync(new URL('lib/client.js', packageRoot), 'utf8')

    expect(config).toContain("'process.env.NODE_ENV': JSON.stringify('production')")
    expect(client).not.toMatch(/\bprocess(?:\.|\[)/u)
  })

  it('installs Host command PATHs after the launch snapshot and before profile boot', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const recover = main.indexOf('await resolveDesktopShellEnvironment')
    const applyRecovered = main.indexOf('Object.entries(shellEnvironmentResolution.updates)')
    const snapshot = main.indexOf('const environment = loadLayeredEnv')
    const install = main.indexOf('const pnpmRuntime = installDesktopPnpmRuntime')
    const prepare = main.indexOf('let prepared = prepareDesktopProfile')
    const installDsh = main.indexOf('const dshRuntime = process.platform === \'win32\'')
    const ownPnpm = main.indexOf('const releasePnpmRuntime = generation.own(')
    const ownDsh = main.indexOf('const releaseDshRuntime = generation.own(')
    const materialize = main.indexOf('await materializeProfile({', prepare)
    const reprepare = main.indexOf('prepared = prepareDesktopProfile(', materialize)
    const pnpmBootstrap = main.indexOf('const desktopPnpmBootstrap: DesktopPnpmBootstrap = {')
    const boot = main.indexOf('const ctx = await boot')

    expect(recover).toBeGreaterThanOrEqual(0)
    expect(applyRecovered).toBeGreaterThan(recover)
    expect(snapshot).toBeGreaterThan(applyRecovered)
    expect(install).toBeGreaterThan(snapshot)
    expect(ownPnpm).toBeGreaterThan(install)
    expect(prepare).toBeGreaterThan(install)
    expect(installDsh).toBeGreaterThan(prepare)
    expect(ownDsh).toBeGreaterThan(installDsh)
    expect(materialize).toBeGreaterThan(prepare)
    expect(reprepare).toBeGreaterThan(materialize)
    expect(pnpmBootstrap).toBeGreaterThan(reprepare)
    expect(boot).toBeGreaterThan(prepare)
    expect(boot).toBeGreaterThan(installDsh)
    expect(main).toContain("'dsh-plugin-desktop: packaged pnpm runtime PATH'")
    expect(main).toContain("'dsh-plugin-desktop: packaged dsh runtime PATH'")
    expect(main).toContain('pnpmBinDir: pnpmRuntime.pathDir')
    expect(main).not.toContain("'--host'")
    expect(readFileSync(new URL('src/profile.ts', packageRoot), 'utf8'))
      .toContain('const webserverConfig = { host: desktopWebServerHost(networkExposure), port }')
    expect(main).not.toContain("'--port', '0'")
    expect(main).toContain("import { DesktopStartupGeneration } from './startup-generation.ts'")
    expect(main).toContain('async () => { await generation.release() }')
    expect(main).not.toContain('disposePnpmRuntime')
    expect(main).not.toContain('disposeDshRuntime')
  })

  it('keeps the release-age override in the shared process-local pnpm policy', () => {
    const policy = readFileSync(new URL('src/pnpm-policy.ts', packageRoot), 'utf8')
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')

    expect(policy).toContain("'--config.minimumReleaseAge=0'")
    expect(main).not.toContain('allowYoungLockedDependencies')
  })

  it('injects profile creation into the generation-scoped Host service without selecting it', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const profileImport = main.indexOf('createDesktopWebProfile,')
    const profileService = main.indexOf('await hostCtx.plugin(DesktopProfileService, {')
    const create = main.indexOf('create: name => createDesktopWebProfile(homeDir, name),', profileService)
    const list = main.indexOf('list: () => listDesktopProfiles(homeDir),', profileService)
    const persist = main.indexOf('persistSelection: name => { selectDesktopProfile(selectionStatePath, homeDir, name) },', profileService)
    const restart = main.indexOf('requestRestart: () => runtime.requestRestart(),', profileService)

    expect(profileImport).toBeGreaterThanOrEqual(0)
    expect(profileService).toBeGreaterThan(profileImport)
    expect(create).toBeGreaterThan(profileService)
    expect(list).toBeGreaterThan(create)
    expect(persist).toBeGreaterThan(list)
    expect(restart).toBeGreaterThan(persist)
  })

  it('wires local crash evidence before Electron becomes ready', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const startCrashReporter = main.indexOf('startDesktopCrashReporting(crashReporter')
    const beginRun = main.indexOf('beginDesktopRun(')
    const childLogging = main.indexOf('installDesktopChildProcessLogging(app')
    const exitCoordinator = main.indexOf('createDesktopExitCoordinator(')
    const ready = main.indexOf('await app.whenReady()')
    const markClean = main.indexOf('desktopRun?.markClean()')
    const nativeExit = main.indexOf('app.exit(code)')

    expect(startCrashReporter).toBeGreaterThanOrEqual(0)
    expect(beginRun).toBeGreaterThan(startCrashReporter)
    expect(childLogging).toBeGreaterThan(beginRun)
    expect(exitCoordinator).toBeGreaterThan(childLogging)
    expect(nativeExit).toBeGreaterThan(exitCoordinator)
    expect(markClean).toBeGreaterThan(nativeExit)
    expect(ready).toBeGreaterThan(markClean)
  })

  it('creates unified Profile checkpoints before composition and records only after health', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const beginProfile = main.indexOf('const profileStartup = beginDesktopProfileStartup(')
    const checkpoint = main.indexOf('profileCheckpoint = new DesktopProfileCheckpoint({', beginProfile)
    const recoveryController = main.indexOf('startupRecoveryController = new DesktopStartupRecoveryController({', checkpoint)
    const prepare = main.indexOf('let prepared = prepareDesktopProfile(')
    const monitor = main.indexOf('const rendererBoot = runtime.beginRendererBootMonitoring({')
    const commitHealthy = main.indexOf('commitHealthy: async () => {', monitor)
    const captureHealthy = main.indexOf('profileCheckpoint?.captureHealthy()', commitHealthy)
    const awaitRenderer = main.indexOf('const [, rendererVerdict] = await Promise.all([')
    const mount = main.indexOf('runtime.mountScheduled(),', awaitRenderer)

    expect(beginProfile).toBeGreaterThanOrEqual(0)
    expect(checkpoint).toBeGreaterThan(beginProfile)
    expect(recoveryController).toBeGreaterThan(checkpoint)
    expect(prepare).toBeGreaterThan(recoveryController)
    expect(monitor).toBeGreaterThan(prepare)
    expect(commitHealthy).toBeGreaterThan(monitor)
    expect(captureHealthy).toBeGreaterThan(commitHealthy)
    expect(awaitRenderer).toBeGreaterThan(captureHealthy)
    expect(mount).toBeGreaterThan(awaitRenderer)
    expect(main).not.toContain('DesktopStartupStateCommit')
    expect(main).not.toContain('DesktopInstallRecoveryStore')
    expect(main).not.toContain('lastKnownGood')
  })

  it('finishes or skips per-Profile native setup before Host boot and the main window', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const requestedRecovery = main.indexOf('if (recoveryModeRequested)')
    const prepare = main.indexOf('let prepared = prepareDesktopProfile(')
    const setupState = main.indexOf('readDesktopSetupWizardState(', prepare)
    const setupWindow = main.indexOf('new DesktopSetupWizardWindow({', setupState)
    const setupRun = main.indexOf('await setupWizardWindow.run()', setupWindow)
    const updateSettings = main.indexOf('await updateDesktopSetupWizardSettings(', setupRun)
    const selectMarket = main.indexOf('await selectDesktopMarketProvider(', updateSettings)
    const reprepare = main.indexOf('prepared = prepareDesktopProfile(', selectMarket)
    const completeMarker = main.indexOf("'completed',", reprepare)
    const installDsh = main.indexOf("const dshRuntime = process.platform === 'win32'", completeMarker)
    const boot = main.indexOf('const ctx = await boot', installDsh)
    const mount = main.indexOf('runtime.mountScheduled(),', boot)

    expect(requestedRecovery).toBeGreaterThanOrEqual(0)
    expect(prepare).toBeGreaterThan(requestedRecovery)
    expect(setupState).toBeGreaterThan(prepare)
    expect(setupWindow).toBeGreaterThan(setupState)
    expect(setupRun).toBeGreaterThan(setupWindow)
    expect(updateSettings).toBeGreaterThan(setupRun)
    expect(selectMarket).toBeGreaterThan(updateSettings)
    expect(reprepare).toBeGreaterThan(selectMarket)
    expect(completeMarker).toBeGreaterThan(reprepare)
    expect(installDsh).toBeGreaterThan(completeMarker)
    expect(boot).toBeGreaterThan(installDsh)
    expect(mount).toBeGreaterThan(boot)
    expect(main).toContain("setupResult.action === 'quit'")
    expect(main).toContain("setupResult.action === 'skip'")
    expect(main).toContain("'skipped',")
    expect(main).toContain('clearDesktopSetupWizardState(app.getPath(\'userData\'), profileDir)')
  })

  it('wires lifecycle evidence through key startup stages and terminal outcomes', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const createRecorder = main.indexOf('const lifecycleRecorder = createDesktopLifecycleRecorder({')
    const startRun = main.indexOf('lifecycleRecorder.startStartup(startupStage)')
    const finishRenderer = main.indexOf('lifecycleRecorder.finishRendererBoot(')
    const rendererStage = main.indexOf("startupStage = 'renderer-startup'")
    const startRenderer = main.indexOf('lifecycleRecorder.startRendererBoot()')
    const awaitRenderer = main.indexOf('const [, rendererVerdict] = await Promise.all([')
    const healthStage = main.indexOf("startupStage = 'health-commit'")
    const completeStartup = main.indexOf('lifecycleRecorder.completeStartup(startupStage, rendererReport)')
    const catchFailure = main.indexOf('} catch (cause) {')
    const failPendingRenderer = main.indexOf('lifecycleRecorder.failRendererBootIfPending(')
    const catchFailStartup = main.indexOf('lifecycleRecorder.failStartup(', failPendingRenderer)

    expect(main).toContain("import { createDesktopLifecycleRecorder } from './lifecycle-events.ts'")
    expect(createRecorder).toBeGreaterThanOrEqual(0)
    expect(startRun).toBeGreaterThan(createRecorder)
    for (const stage of [
      'shell-environment',
      'runtime-bootstrap',
      'profile-selection',
      'profile-composition',
      'host-boot',
      'renderer-startup',
      'health-commit',
    ]) {
      expect(main).toContain(`startupStage = '${stage}'`)
    }
    expect(main).toContain('lifecycleRecorder.transitionStartupStage(startupStage)')
    expect(finishRenderer).toBeGreaterThan(createRecorder)
    expect(startRenderer).toBeGreaterThan(rendererStage)
    expect(startRenderer).toBeLessThan(awaitRenderer)
    expect(healthStage).toBeGreaterThan(startRenderer)
    expect(healthStage).toBeLessThan(awaitRenderer)
    expect(completeStartup).toBeGreaterThan(awaitRenderer)
    expect(failPendingRenderer).toBeGreaterThan(catchFailure)
    expect(catchFailStartup).toBeGreaterThan(failPendingRenderer)
    expect(main).toContain('lifecycleRendererFailureReason(runtime.rendererBootFailureReason)')
    expect(main).toContain('lifecycleStartupFailureReason(cause, runtime)')
  })

  it('routes requested and failed startup through the unified recovery window without automatic mutation', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const windows = [...main.matchAll(/await openStartupRecoveryWindow\(/gu)]
      .map(match => match.index)
    const requested = main.indexOf('if (recoveryModeRequested)')
    const prepare = main.indexOf('let prepared = prepareDesktopProfile(')
    const quiesce = main.indexOf('const recoveryActionsSafe = await generation.quiesceForRecovery()')
    const configureTerminal = main.indexOf('runtime.configureTerminal({')
    const terminalAvailable = main.indexOf('recoveryTerminalAvailable = true')

    expect(windows).toHaveLength(2)
    expect(windows[0]).toBeGreaterThan(requested)
    expect(windows[0]).toBeLessThan(prepare)
    expect(configureTerminal).toBeGreaterThanOrEqual(0)
    expect(configureTerminal).toBeLessThan(requested)
    expect(terminalAvailable).toBeGreaterThan(configureTerminal)
    expect(terminalAvailable).toBeLessThan(requested)
    expect(main.match(/runtime\.configureTerminal\(\{/gu)).toHaveLength(1)
    expect(windows[1]).toBeGreaterThan(windows[0]!)
    expect(quiesce).toBeGreaterThan(prepare)
    expect(windows[1]).toBeGreaterThan(quiesce)
    expect(main).not.toContain('installRecovery')
    expect(main).not.toContain('restoreLatest')
    expect(main).not.toContain('restoreLastKnownGood')
    expect(main).toContain('failureStage: startupStage')
    expect(main).toContain("startupStage = 'profile-composition'")
    expect(main).toContain("startupStage = 'host-boot'")
    expect(main).toContain("startupStage = 'renderer-startup'")
    expect(main).toContain("return report.status === 'failed'")
    expect(main).toContain('void run().catch(async (cause: unknown) => { await handleFatalLauncherFailure(cause) })')
  })

  it('uses the upstream child-environment scrub around login-shell recovery', () => {
    const shellEnvironment = readFileSync(new URL('src/shell-environment.ts', packageRoot), 'utf8')

    expect(shellEnvironment).toContain('scrubbedParentEnv')
    expect(shellEnvironment).toContain('SENSITIVE_ENV_PATTERN')
    expect(shellEnvironment).toContain('DSH_ENV_PREFIX')
    expect(shellEnvironment).toContain('DESKTOP_SHELL_ENVIRONMENT_KEYS')
  })

  it('fixes the installed application identity', () => {
    expect(manifest.version).toBe(workspaceManifest.version)
    expect(manifest.build?.productName).toBe('DSH Desktop')
    expect(manifest.build?.appId).toBe('ai.deepseek.dsh.desktop')
    expect(manifest.build?.asarUnpack).toEqual([
      'package.json',
      'cordis.patch.yml',
      'build/**',
      'lib/**',
      'node_modules/**',
    ])
    expect(manifest.build?.electronFuses).toEqual({ runAsNode: true })
    expect(manifest.build?.toolsets).toEqual({ nsis: '1.2.1' })
    expect(manifest.files).toEqual(expect.arrayContaining([
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'docs/**',
    ]))
    expect(manifest.build?.files).toEqual([
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'cordis.patch.yml',
      'lib/**',
      'package.json',
      '!node_modules/node-pty/build/**',
    ])
    expect(manifest.build?.mac?.icon).toBe('build/app-icon-mac.png')
    expect(manifest.build?.mac?.mergeASARs).toBe(false)
    expect(manifest.build?.mac?.signIgnore).toEqual(['\\.(?:pak|dat|wasm)$'])
    expect(manifest.build?.win?.icon).toBe('build/app-icon.png')
    expect(manifest.build?.win?.target).toEqual([{
      target: 'nsis',
      arch: ['x64'],
    }])
    expect(manifest.build?.win?.artifactName).toBe('DSH-Desktop-${version}-${arch}-Portable.${ext}')
    expect(manifest.build?.nsis).toEqual({
      include: 'installer.nsh',
      license: 'THIRD_PARTY_NOTICES.md',
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      differentialPackage: false,
      shortcutName: 'DSH Desktop',
      useZip: false,
      artifactName: 'DSH-Desktop-${version}-${arch}-Setup.${ext}',
    })
    expect(manifest.build?.linux?.icon).toBe('build/app-icon.png')
  })

  it('separates unsigned smoke packaging from the signed macOS release', () => {
    const packageDir = readFileSync(new URL('scripts/package-dir.mjs', packageRoot), 'utf8')

    expect(manifest.scripts?.build).toContain('node scripts/generate-mac-app-icon.mjs')
    expect(manifest.scripts?.['package:dir']).toBe('yarn run build && node scripts/package-dir.mjs')
    expect(packageDir).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")
    expect(manifest.scripts?.['dist:mac']).toBe('node scripts/release-mac.ts')
    expect(manifest.scripts?.['dist:mac-smoke']).toBe('node scripts/package-mac.ts')
    expect(manifest.scripts?.['dist:win']).toBe('node scripts/package-win.ts')
    expect(manifest.scripts?.['dist:win-portable']).toBe('node scripts/package-win-portable.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn workspace dsh-community-market build')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run build')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run typecheck')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/package-win.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/desktop-installer-quit.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/installer-nsh.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/verify-win-portable.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/update-checker.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/update-download.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/windows-volume-diagnostics.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run verify:closure')
    expect(manifest.scripts?.['check:mac-package']).toContain('yarn workspace dsh-community-market build')
    expect(manifest.scripts?.['check:mac-package']).toContain('yarn run build')
    expect(manifest.scripts?.['check:mac-package']).toContain('yarn run typecheck')
    expect(manifest.scripts?.['check:mac-package']).toContain('tests/package-mac.spec.ts')
    expect(manifest.scripts?.['check:mac-package']).toContain('tests/verify-mac-smoke.spec.ts')
    expect(manifest.scripts?.['check:mac-package']).toContain('tests/mac-universal.spec.ts')
    expect(manifest.scripts?.['check:mac-package']).toContain('yarn run verify:closure')
    expect(manifest.scripts?.['verify:cli']).toBe('node scripts/verify-cli-runtime.mjs')
    expect(manifest.scripts?.check).toContain('yarn run verify:cli')
    expect(workspaceManifest.scripts?.['dist:mac'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:mac')
    expect(workspaceManifest.scripts?.['dist:mac-smoke'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:mac-smoke')
    expect(workspaceManifest.scripts?.['dist:win'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:win')
    expect(workspaceManifest.scripts?.['dist:win-portable'])
      .toBe('yarn workspace dsh-community-market build && yarn workspace dsh-plugin-desktop dist:win-portable')
    expect(manifest.build?.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
    expect(manifest.build?.mac).toEqual(expect.objectContaining({
      extendInfo: {
        CFBundleAllowMixedLocalizations: true,
        CFBundleDevelopmentRegion: 'en',
        CFBundleLocalizations: ['en', 'zh_CN'],
      },
      hardenedRuntime: true,
      mergeASARs: false,
      notarize: true,
      signIgnore: ['\\.(?:pak|dat|wasm)$'],
      target: ['dir'],
      x64ArchFiles: expect.stringContaining('node-pty/prebuilds/darwin-*'),
    }))
    expect(manifest.build?.files).toContain('!node_modules/node-pty/build/**')
    expect(manifest.devDependencies?.['@electron/asar']).toBe('3.4.1')
  })

  it('runs platform package gates before reusing native packaging outputs', () => {
    const windowsJob = ciWorkflow.slice(
      ciWorkflow.indexOf('  desktop-windows:'),
      ciWorkflow.indexOf('  desktop-macos:'),
    )
    const macosJob = ciWorkflow.slice(
      ciWorkflow.indexOf('  desktop-macos:'),
      ciWorkflow.indexOf('  upstream-command-windows:'),
    )

    expect(windowsJob).not.toContain('- run: yarn check')
    expect(windowsJob).toContain('- run: yarn workspace dsh-plugin-desktop check:win-package')
    expect(windowsJob).toContain('run: yarn workspace dsh-plugin-desktop dist:win')
    expect(windowsJob).toContain('run: yarn workspace dsh-plugin-desktop dist:win-portable')
    expect(windowsJob).toContain('DSH_PACKAGE_CHECK_ALREADY_RAN: \'1\'')
    expect(macosJob).not.toContain('- run: yarn check')
    expect(macosJob).toContain('- run: yarn workspace dsh-plugin-desktop check:mac-package')
    expect(macosJob).toContain('run: yarn workspace dsh-plugin-desktop dist:mac-smoke')
    expect(macosJob).toContain('DSH_PACKAGE_CHECK_ALREADY_RAN: \'1\'')
    expect(macosJob).not.toContain('- run: yarn dist:mac-smoke')
  })

  it('skips product packaging only for documentation-only changes', () => {
    const classifier = fileURLToPath(new URL('../../scripts/classify-ci-changes.mjs', import.meta.url))
    const classify = (paths: string[]): string => execFileSync(
      process.execPath,
      [classifier],
      { input: Buffer.from(`${paths.join('\0')}\0`), encoding: 'utf8' },
    ).trim()

    expect(classify([
      'docs/architecture.md',
      '.agents/notes/implemented/architecture/decision.md',
      '.agents/notes/implemented/architecture/decision.i18n.yaml',
      'dsh-community-market/docs/schema.json',
      '.github/ISSUE_TEMPLATE/feature_request.yml',
    ])).toBe('false')
    expect(classify(['README.md', 'dsh-plugin-desktop/src/index.ts'])).toBe('true')
    expect(classify(['.github/workflows/ci.yml'])).toBe('true')
    expect(classify(['THIRD_PARTY_NOTICES.md'])).toBe('true')
    expect(classify([])).toBe('true')

    expect(ciWorkflow).toContain('product="$(git diff --name-only -z')
    expect(ciWorkflow).toContain("if: needs.changes.outputs.product == 'true'")
    expect(ciWorkflow).toContain('Documentation-only change; product build and tests are not required.')
  })

  it('keeps one fixed brand-blue tray source for generated native assets', () => {
    const source = readFileSync(new URL('build/tray-icon.svg', packageRoot), 'utf8')

    expect(source.match(/#4D6BFE/gu)).toHaveLength(1)
    expect(source).not.toMatch(/<style\b|prefers-color-scheme/iu)
    for (const filename of [
      'tray-iconTemplate.png',
      'tray-iconTemplate@2x.png',
      'tray-icon-blue.png',
      'tray-icon-blue@1.25x.png',
      'tray-icon-blue@1.5x.png',
      'tray-icon-blue@2x.png',
    ]) {
      expect(readFileSync(new URL(`build/${filename}`, packageRoot)).byteLength).toBeGreaterThan(0)
    }
  })

  it('keeps the iOS Default source icon unmodified', () => {
    const digest = createHash('sha256')
      .update(readFileSync(new URL('build/app-icon.png', packageRoot)))
      .digest('hex')

    expect(digest).toBe('315fbc6e57ff1f34894f21f66fb7f9f26deccf78333c71fad21a6cec64e7de80')
  })

  it('generates a centered macOS icon with a 100-pixel visual inset', async () => {
    const source = await sharp(readFileSync(new URL('build/app-icon.png', packageRoot))).metadata()
    const icon = sharp(readFileSync(new URL('build/app-icon-mac.png', packageRoot)))
    const metadata = await icon.metadata()
    const { info } = await icon
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
      .toBuffer({ resolveWithObject: true })

    expect(metadata).toEqual(expect.objectContaining({
      format: 'png',
      width: 1024,
      height: 1024,
      space: 'rgb16',
      depth: 'ushort',
      bitsPerSample: 16,
      channels: 4,
      hasAlpha: true,
    }))
    expect(metadata.icc).toEqual(source.icc)
    expect(info).toEqual(expect.objectContaining({
      width: 824,
      height: 824,
      trimOffsetLeft: -100,
      trimOffsetTop: -100,
    }))
  })

  it('keeps Electron out of production dependencies consumed by electron-builder', () => {
    expect(manifest.dependencies).not.toHaveProperty('electron')
    expect(manifest.peerDependencies?.electron).toBe('43.4.0')
    expect(manifest.devDependencies?.electron).toBe('43.4.0')
    expect(manifest.dependencies?.pnpm).toBe('11.8.0')
  })

  it('keeps the packaged pnpm manifest, lock entry, and installed runtime on 11.8.0', () => {
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const installedPnpm = JSON.parse(readFileSync(
      workspaceRequire.resolve('pnpm'),
      'utf8',
    )) as { version?: unknown }

    expect(manifest.dependencies?.pnpm).toBe('11.8.0')
    expect(lockfile).toContain('"pnpm@npm:11.8.0":')
    expect(lockfile).toContain('resolution: "pnpm@npm:11.8.0"')
    expect(installedPnpm.version).toBe('11.8.0')
  })

  it('packages the native-compiled Koffi Windows runtime', () => {
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')

    expect(manifest.dependencies?.koffi).toBe('3.1.5')
    expect(workspaceManifest.resolutions).toMatchObject({
      'koffi@npm:^3.1.0': '3.1.5',
    })
    expect(lockfile).toContain('"koffi@npm:3.1.5":')
    expect(lockfile).toContain('@koromix/koffi-win32-x64@npm:3.1.5')
    expect(lockfile).not.toContain('"koffi@npm:3.1.4":')
    expect(lockfile).not.toContain('@koromix/koffi-win32-x64@npm:3.1.4')
  })

  it('hides official plugin-manager and general subprocess consoles on Windows', () => {
    const dshPatchPath = './patches/dsh@0.1.1-rc.2.patch'
    const subprocessPatchPath = './patches/dsh-subprocess-local@0.1.1-rc.2.patch'
    const dshPatchResolution = `patch:@deepseek-ai/dsh@npm%3A0.1.1-rc.2#${dshPatchPath}`
    const subprocessPatchResolution = `patch:@deepseek-ai/dsh-subprocess-local@npm%3A0.1.1-rc.2#${subprocessPatchPath}`
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const dshPatch = readFileSync(new URL(dshPatchPath, workspaceRoot), 'utf8')
    const subprocessPatch = readFileSync(new URL(subprocessPatchPath, workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const dshManifest = workspaceRequire.resolve('@deepseek-ai/dsh/package.json')
    const dshPluginRuntime = readdirSync(join(dirname(dshManifest), 'lib'))
      .filter(name => /^plugin-.*\.js$/u.test(name))
      .map(name => readFileSync(join(dirname(dshManifest), 'lib', name), 'utf8'))
      .join('\n')
    const subprocessManifest = workspaceRequire.resolve('@deepseek-ai/dsh-subprocess-local/package.json')
    const subprocessRuntime = readFileSync(join(dirname(subprocessManifest), 'lib/index.js'), 'utf8')

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh@npm:0.1.1-rc.2': dshPatchResolution,
      '@deepseek-ai/dsh@npm:^0.1.1-rc.2': dshPatchResolution,
      '@deepseek-ai/dsh-subprocess-local@npm:0.1.1-rc.2': subprocessPatchResolution,
      '@deepseek-ai/dsh-subprocess-local@npm:^0.1.1-rc.2': subprocessPatchResolution,
    })
    expect(lockfile).toContain('@deepseek-ai/dsh@patch:@deepseek-ai/dsh@npm%3A0.1.1-rc.2#./patches/dsh@0.1.1-rc.2.patch')
    expect(lockfile).toContain('@deepseek-ai/dsh-subprocess-local@patch:@deepseek-ai/dsh-subprocess-local@npm%3A0.1.1-rc.2#./patches/dsh-subprocess-local@0.1.1-rc.2.patch')
    expect(dshPatch).toContain('+\t\twindowsHide: true')
    expect(dshPluginRuntime).toMatch(/spawnSync\("pnpm"[\s\S]*?shell: process\.platform === "win32",\s+windowsHide: true/u)
    expect(subprocessPatch.match(/^\+\s*windowsHide: true\r?$/gmu)).toHaveLength(3)
    expect(subprocessRuntime.match(/windowsHide: true/gu)).toHaveLength(3)
  })

  it('resolves electron-builder through the pinned app-builder-lib keychain patch', () => {
    const patchResolution = 'patch:app-builder-lib@npm%3A26.15.7#./patches/app-builder-lib@26.15.7.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL('patches/app-builder-lib@26.15.7.patch', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const electronBuilderManifest = workspaceRequire.resolve('electron-builder/package.json')
    const electronBuilderRequire = createRequire(electronBuilderManifest)
    const appBuilderManifest = electronBuilderRequire.resolve('app-builder-lib/package.json')
    const installedCodeSign = readFileSync(join(dirname(appBuilderManifest), 'out/codeSign/macCodeSign.js'), 'utf8')
    const installedNsisInstaller = readFileSync(join(dirname(appBuilderManifest), 'templates/nsis/installer.nsi'), 'utf8')
    const installedNsisPortable = readFileSync(join(dirname(appBuilderManifest), 'templates/nsis/portable.nsi'), 'utf8')
    const installedNsisSingleInstance = readFileSync(
      join(dirname(appBuilderManifest), 'templates/nsis/include/allowOnlyOneInstallerInstance.nsh'),
      'utf8',
    )

    expect(workspaceManifest.resolutions).toMatchObject({
      'app-builder-lib@npm:26.15.7': patchResolution,
    })
    expect(manifest.devDependencies?.['electron-builder']).toBe('26.15.7')
    expect(lockfile).toContain('app-builder-lib@patch:app-builder-lib@npm%3A26.15.7#./patches/app-builder-lib@26.15.7.patch')
    expect(patch).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(patch).toContain('"-k", keychainPassword, keychainFile')
    expect(patch).toContain('ManifestLongPathAware true')
    expect(patch).toContain("[System.IO.Path]::GetFileName($$_.Path) -ieq '${_FILE}'")
    expect(manifest.build?.toolsets?.nsis).toBe('1.2.1')
    expect(installedCodeSign).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(installedCodeSign).toContain('"-k", keychainPassword, keychainFile')
    expect(installedNsisInstaller).toContain('ManifestLongPathAware true')
    expect(installedNsisPortable).toContain('ManifestLongPathAware true')
    expect(installedNsisSingleInstance).toContain("[System.IO.Path]::GetFileName($$_.Path) -ieq '${_FILE}'")
    expect(installedNsisSingleInstance).not.toContain("$$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase')}).Count")
  })

  it('starts restricted Windows shells with a hidden console show state', () => {
    const patchResolution = 'patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.1-rc.2#./patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL('patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const sandboxManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json')
    const sandboxLocalManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-local/package.json')
    const sandboxLocalRequire = createRequire(sandboxLocalManifest)
    const sandboxLib = join(dirname(sandboxManifest), 'lib')
    const runtimeChunks = readdirSync(sandboxLib).filter(name => /^types-.*\.js$/u.test(name))

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.1-rc.2': patchResolution,
      '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.1-rc.2': patchResolution,
    })
    expect(sandboxLocalRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json'))
      .toBe(sandboxManifest)
    expect(lockfile).toContain('@deepseek-ai/dsh-sandbox-windows-acl@patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.1-rc.2#./patches/dsh-sandbox-windows-acl@0.1.1-rc.2.patch')
    expect(patch.match(/^\+\s*dwFlags: 257,\r?$/gmu)).toHaveLength(2)
    expect(patch.match(/^\+\s*wShowWindow: 0,\r?$/gmu)).toHaveLength(2)
    expect(runtimeChunks).toHaveLength(1)
    const installedRuntime = readFileSync(join(sandboxLib, runtimeChunks[0] as string), 'utf8')
    expect(installedRuntime.match(/dwFlags: 257,/gu)).toHaveLength(2)
    expect(installedRuntime.match(/wShowWindow: 0,/gu)).toHaveLength(2)
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 0, null')
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 4, null')
    expect(installedRuntime).not.toContain('134217728')
  })
})
