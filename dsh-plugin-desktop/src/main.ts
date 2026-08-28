/** DSH Desktop executable: minimal Electron bootstrap around the Host Cordis root. */

import { app, crashReporter, safeStorage, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boot,
  installFailLoud,
  loadLayeredEnv,
  PROFILE_PATCH_FILENAME,
  resolveProfileDir,
  type FailLoudProcess,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web-app'
import type {} from '@deepseek-ai/dsh-client-connection'
import { isDesktopInstallerQuitRequest } from './desktop-installer-quit.ts'
import { createDesktopBrowserAccess } from './desktop-browser-access.ts'
import {
  installDesktopDshRuntime,
  installDesktopPnpmRuntime,
} from './desktop-runtime-environment.ts'
import { desktopProductVersion, ElectronDesktopRuntime } from './electron-runtime.ts'
import { getOrCreateDesktopInstallationId } from './desktop-installation-id.ts'
import {
  ElectronStderrLogger,
  installDesktopChildProcessLogging,
  installDesktopUncaughtExceptionLogging,
  type DesktopLogger,
} from './desktop-logger.ts'
import {
  beginDesktopRun,
  startDesktopCrashReporting,
  type DesktopRun,
} from './crash-evidence.ts'
import { dshProductVersion } from './dsh-product-version.ts'
import { exportDesktopDiagnostics } from './diagnostic-export.ts'
import { createDesktopLifecycleRecorder } from './lifecycle-events.ts'
import type {
  DesktopLifecycleFailureReason,
  DesktopLifecycleRendererFailureReason,
} from './lifecycle-events.ts'
import { FileExporter } from './file-exporter.ts'
import { DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from './index.ts'
import {
  desktopLanBrowserUrls,
  desktopLoopbackBrowserUrl,
} from './desktop-network.ts'
import { desktopLanAddresses } from './lan-addresses.ts'
import {
  createLanHttpsCertificate,
  DesktopLanHttpsCertificateError,
  type DesktopLanHttpsPrivateKeyProtector,
} from './lan-https-certificate.ts'
import {
  DESKTOP_LAN_HTTPS_CA_PATH,
  DesktopLanHttpsRuntime,
} from './lan-https-runtime.ts'
import { LogFileSink } from './log-files.ts'
import { maskSecrets } from './mask-secrets.ts'
import { resolveDesktopShellEnvironment } from './shell-environment.ts'
import { installProfilePackageResolver } from './module-resolution.ts'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import {
  beginDesktopProfileStartup,
  assertDesktopProfileName,
  createDesktopWebProfile,
  listDesktopProfiles,
  canDeleteDesktopProfile,
  deleteDesktopProfile,
  readDesktopProfileState,
  selectDesktopProfile,
} from './profile-manager.ts'
import { DesktopProfileService } from './profile-service.ts'
import { DesktopActionsService } from './desktop-actions.ts'
import { clearDesktopProfilePluginState, DesktopPluginsService } from './desktop-plugins.ts'
import {
  desktopMarketSnapshotWithEffective,
  readDesktopMarketStateForUserData,
  selectDesktopMarketProvider,
  type DesktopMarketProvider,
  type DesktopMarketSnapshot,
} from './desktop-market.ts'
import DesktopSettingsController from './desktop-settings-controller.ts'
import {
  clearDesktopProfilePreferences,
  readDesktopProfilePreferences,
  writeDesktopProfilePreferences,
  type DesktopProfilePreferences,
  type DesktopProfilePreferencesStateV1,
} from './profile-preferences.ts'
import {
  DesktopStartupRecoveryController,
  DesktopStartupRecoveryControllerError,
} from './startup-recovery-controller.ts'
import {
  DesktopStartupRecoveryWindow,
  type DesktopStartupRecoveryConfigurationPaths,
  type DesktopStartupRecoveryProfileActions,
  type DesktopStartupFailureStage,
} from './startup-recovery-window.ts'
import { routeDesktopStartupFailure } from './startup-failure-routing.ts'
import { DesktopStartupGeneration } from './startup-generation.ts'
import {
  desktopInstallAnchor,
  healDesktopProfileModuleFallback,
  prepareDesktopProfile,
  type SkippedOptionalEntry,
} from './profile.ts'
import { clearDesktopProfileCheckpoint, DesktopProfileCheckpoint } from './profile-checkpoint.ts'
import {
  clearDesktopSetupWizardState,
  completeOrSkipDesktopSetupWizard,
  desktopSetupWizardRequired,
  desktopSetupWizardStateConstants,
  readDesktopSetupWizardState,
} from './setup-wizard-state.ts'
import {
  migrateDesktopBrowserAccessSettings,
  migrateDesktopWindowMaterialSettings,
  readDesktopSetupWizardSettings,
  updateDesktopSetupWizardSettings,
  type DesktopSetupWizardSettings,
} from './setup-wizard-settings.ts'
import type { DesktopSetupWizardResult } from './setup-wizard-contract.ts'
import { DesktopSetupWizardWindow } from './setup-wizard-window.ts'
import {
  formatProfileMaterializationFailure,
  materializeProfile,
  ProfileMaterializationError,
} from './profile-materializer.ts'
import {
  formatRecoveryPluginRemoveFailure,
  removeRecoveryPlugin,
} from './recovery-plugin-uninstall.ts'
import type { DesktopPnpmBootstrap } from './pnpm.ts'
import {
  createDesktopExitCoordinator,
  createDesktopShutdown,
  installShutdownRequests,
  type DesktopShutdown,
} from './shutdown.ts'
import {
  diagnoseWindowsVolumes,
  formatWindowsVolumeConcern,
  type WindowsVolumeConcern,
} from './windows-volume-diagnostics.ts'
import type { RendererBootReport } from './renderer-boot-contract.ts'
import { desktopLocaleFromLanguageTag } from './tray-locale.ts'
import { desktopNativeCopy } from './native-dialog-copy.ts'
import {
  DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  type DesktopNotificationSettings,
} from './notifications.ts'
import {
  desktopDefaultRelaunchArguments,
  desktopRecoveryModeRequested,
  desktopRecoveryRelaunchArguments,
} from './relaunch-arguments.ts'
import {
  recoverOversizedSessionProjectionCache,
  type SessionProjectionCacheRecoveryResult,
} from './session-projcache-recovery.ts'
import { windowsSupportsMica } from './window-material.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const PRODUCT_NAME = 'DSH Desktop'

/** Require OS-backed secret storage; Linux's plaintext fallback is not sufficient for a CA key. */
function desktopLanHttpsPrivateKeyProtector(): DesktopLanHttpsPrivateKeyProtector {
  return {
    available: () => {
      if (!safeStorage.isEncryptionAvailable()) return false
      if (process.platform !== 'linux') return true
      const backend = safeStorage.getSelectedStorageBackend()
      return backend !== 'basic_text' && backend !== 'unknown'
    },
    seal: plaintext => safeStorage.encryptString(Buffer.from(plaintext).toString('utf8')),
    open: sealed => Buffer.from(safeStorage.decryptString(Buffer.from(sealed)), 'utf8'),
  }
}

class RendererStartupFailure extends Error {
  constructor(
    readonly reason: 'renderer-failed' | 'renderer-timeout',
    report: Extract<RendererBootReport, { status: 'failed' }>,
  ) {
    super(report.error ?? `Renderer boot failed for ${String(report.plugins.length)} plugin(s)`)
    this.name = 'RendererStartupFailure'
  }
}

function lifecycleRendererFailureReason(
  reason: 'renderer-failed' | 'renderer-timeout' | undefined,
): DesktopLifecycleRendererFailureReason {
  return reason === 'renderer-timeout' ? 'renderer-timeout' : 'renderer-failed'
}

function lifecycleStartupFailureReason(
  cause: unknown,
  runtime: ElectronDesktopRuntime,
): DesktopLifecycleFailureReason {
  if (cause instanceof RendererStartupFailure) return cause.reason
  return runtime.rendererBootFailureReason ?? 'startup-failed'
}

/** Report optional user UI plugins skipped to keep startup recoverable. */
function notifySkippedOptionalEntries(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  entries: readonly SkippedOptionalEntry[],
): void {
  if (entries.length === 0) return
  const copy = desktopNativeCopy(runtime.locale)
  const names = entries.map(entry => entry.name)
  try {
    runtime.updates.notify({
      title: copy.skippedPluginTitle,
      body: copy.skippedPluginBody(names[0]!, names.length - 1),
    })
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show skipped plugin notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Surface path/volume risks that otherwise become obscure sandbox or pnpm failures later. */
function warnWindowsVolumeConcerns(logger: DesktopLogger, concerns: readonly WindowsVolumeConcern[]): void {
  for (const concern of concerns) {
    logger.error(`${BIN_NAME}: Windows volume warning: ${formatWindowsVolumeConcern(concern)}`)
  }
}

/** Notify once after the UI is ready; stderr carries the exact paths. */
function notifyWindowsVolumeConcerns(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  concerns: readonly WindowsVolumeConcern[],
): void {
  if (concerns.length === 0) return
  const copy = desktopNativeCopy(runtime.locale)
  const concernLabel = concerns[0]?.label
  const label = runtime.locale === 'zh'
    ? concernLabel === 'application install' ? '应用安装目录'
      : concernLabel === 'desktop user data' ? '桌面用户数据'
        : concernLabel === 'DSH home' ? 'DSH 主目录'
          : '某个配置路径'
    : concernLabel ?? 'A configured path'
  try {
    runtime.updates.notify({
      title: copy.unsupportedStorageTitle,
      body: copy.unsupportedStorageBody(label),
    })
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show Windows volume warning: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

function notifySessionProjectionCacheRecovery(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  _recovery: Extract<SessionProjectionCacheRecoveryResult, { status: 'quarantined' }>,
): void {
  try {
    runtime.updates.notify({
      title: 'Recovered Session Cache',
      body: 'An oversized session projection cache was moved aside and will be rebuilt from session history.',
    })
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show session projection cache recovery notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Use one Profile-owned Market request as the first composition input. */
function desktopProfileMarketSnapshot(market: DesktopMarketProvider): DesktopMarketSnapshot {
  return Object.freeze({
    requested: market,
    effective: market,
    legacyDefaulted: false,
  })
}

/** Project exactly the first-stage Profile fields from an effective settings view. */
function desktopProfilePreferencesFromSettings(
  desktop: Pick<DesktopSettings, 'mode' | 'openBrowser' | 'networkExposure'>,
  notifications: Readonly<DesktopNotificationSettings>,
  market: DesktopMarketProvider,
): DesktopProfilePreferences {
  return Object.freeze({
    mode: desktop.mode,
    openBrowser: desktop.openBrowser,
    networkExposure: desktop.networkExposure,
    notifications: Object.freeze({ ...notifications }),
    market,
  })
}

/** Preserve device-shared Wizard fields while mirroring one Profile's leaves. */
function setupSettingsWithProfilePreferences(
  current: DesktopSetupWizardSettings,
  preferences: DesktopProfilePreferences,
): DesktopSetupWizardSettings {
  return Object.freeze({
    ...current,
    mode: preferences.mode,
    openBrowser: preferences.openBrowser,
    networkExposure: preferences.networkExposure,
    notifications: Object.freeze({ ...preferences.notifications }),
  })
}

/** Mirror only the Profile-owned settings leaves into the exact prepared document. */
async function mirrorDesktopProfilePreferences(
  settingsDocument: string,
  preferences: DesktopProfilePreferences,
): Promise<void> {
  const current = readDesktopSetupWizardSettings(settingsDocument)
  await updateDesktopSetupWizardSettings(
    settingsDocument,
    setupSettingsWithProfilePreferences(current, preferences),
  )
}

/** Start one Electron process and leave lifetime to the mounted desktop plugin. */
async function start(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  if (isDesktopInstallerQuitRequest(process.argv, process.platform)) {
    app.quit()
    return
  }

  let shutdown: DesktopShutdown | undefined
  let removeShutdownRequests: (() => void) | undefined
  let removeUncaughtExceptionLogging: (() => void) | undefined
  let removeChildProcessLogging: (() => void) | undefined
  let fileExporter: FileExporter | undefined
  let runtime!: ElectronDesktopRuntime
  let logSink: LogFileSink | undefined
  let startupRecoveryController: DesktopStartupRecoveryController | undefined
  let startupRecoveryWindow: DesktopStartupRecoveryWindow | undefined
  let setupWizardWindow: DesktopSetupWizardWindow | undefined
  let startupRecoveryConfigurationPaths: DesktopStartupRecoveryConfigurationPaths | undefined
  let profileCheckpoint: DesktopProfileCheckpoint | undefined
  let startupRecoveryProfileActions: DesktopStartupRecoveryProfileActions | undefined
  let sessionProjectionCacheRecovery:
    | Extract<SessionProjectionCacheRecoveryResult, { status: 'quarantined' }>
    | undefined
  let profileRecoveryActionUsed = false
  let recoveryTerminalAvailable = false
  let startupStage: DesktopStartupFailureStage = 'electron-ready'
  const appVersion = desktopProductVersion()
  const setupWizardVersions = Object.freeze({
    desktopVersion: appVersion,
    dshVersion: dshProductVersion(),
    setupRevision: desktopSetupWizardStateConstants.setupRevision,
  })
  const recoveryModeRequested = desktopRecoveryModeRequested()
  try {
    logSink = new LogFileSink(join(app.getPath('userData'), 'logs'), {
      maxFileBytes: 10 * 1024 * 1024,
      maxDirectoryBytes: 200 * 1024 * 1024,
    })
    logSink.enforceDirectoryCap()
    logSink.purgeOlderThan(7)
    logSink.writeHeader(`--- ${BIN_NAME} ${PRODUCT_NAME} ${appVersion} ${process.platform} node ${process.version} run ${Date.now()} ---`)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    process.stderr.write(`${BIN_NAME}: file logging unavailable: ${maskSecrets(detail)}\n`)
    logSink = undefined
  }
  const electronLogger = new ElectronStderrLogger(logSink)
  const generation = new DesktopStartupGeneration({ logger: electronLogger })
  const generationId = generation.id
  const lifecycleRecorder = createDesktopLifecycleRecorder({
    userDataDir: app.getPath('userData'),
    appVersion,
    platform: process.platform,
    arch: process.arch,
    logger: electronLogger,
  })
  lifecycleRecorder.startStartup(startupStage)
  try {
    startDesktopCrashReporting(crashReporter, {
      productName: PRODUCT_NAME,
      version: appVersion,
      platform: process.platform,
      arch: process.arch,
    })
  } catch (cause) {
    electronLogger.error(`${BIN_NAME}: local crash reporting unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let desktopRun: DesktopRun | undefined
  try {
    desktopRun = beginDesktopRun(
      join(app.getPath('userData'), 'crash-evidence', 'active-run.json'),
      {
        startedAt: new Date().toISOString(),
        pid: process.pid,
        version: appVersion,
      },
    )
    const previousRun = desktopRun.previousRun
    if (previousRun !== undefined) {
      electronLogger.error('unreadable' in previousRun
        ? `${BIN_NAME}: previous desktop run did not shut down cleanly (active run marker unreadable)`
        : `${BIN_NAME}: previous desktop run did not shut down cleanly (startedAt: ${previousRun.startedAt}, pid: ${String(previousRun.pid)}, version: ${previousRun.version})`)
    }
  } catch (cause) {
    electronLogger.error(`${BIN_NAME}: active run tracking unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  removeChildProcessLogging = installDesktopChildProcessLogging(app, electronLogger)
  const nativeExit = createDesktopExitCoordinator(
    {
      prepareToQuit: () => { runtime.prepareToQuit() },
      relaunch: args => {
        app.relaunch({ args: [...(args ?? desktopDefaultRelaunchArguments())] })
      },
      exit: code => { app.exit(code) },
    },
    () => {
      removeShutdownRequests?.()
      removeUncaughtExceptionLogging?.()
      removeChildProcessLogging?.()
      try {
        desktopRun?.markClean()
      } catch (cause) {
        electronLogger.error(`${BIN_NAME}: failed to clear active run marker: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    },
  )
  let restartRequested = false
  const installationId = await getOrCreateDesktopInstallationId(app.getPath('userData'))
  runtime = new ElectronDesktopRuntime(async target => {
    if (shutdown === undefined) {
      throw new Error('dsh-plugin-desktop: shutdown coordinator is not ready')
    }
    if (restartRequested) return
    restartRequested = true
    nativeExit.requestRelaunch(
      target === 'recovery'
        ? desktopRecoveryRelaunchArguments()
        : desktopDefaultRelaunchArguments(),
    )
    await shutdown.request(0)
  }, (report) => {
    if (report.status === 'failed') {
      lifecycleRecorder.finishRendererBoot(
        report,
        lifecycleRendererFailureReason(runtime.rendererBootFailureReason),
      )
    }
    // Main owns every pre-health failure branch. Returning true prevents the
    // legacy Renderer recovery dialog from racing the native startup window.
    return report.status === 'failed'
  }, electronLogger, undefined, undefined, installationId)
  const finalExit = (code: number): void => { nativeExit.finish(code) }
  shutdown = createDesktopShutdown(
    async () => { await generation.release() },
    finalExit,
  )
  const requestQuit = (code: number): void => { void shutdown.request(code) }
  removeUncaughtExceptionLogging = installDesktopUncaughtExceptionLogging(
    process,
    electronLogger,
    requestQuit,
  )
  removeShutdownRequests = installShutdownRequests(process, app, requestQuit)

  const openStartupRecoveryWindow = async (
    failureDetail: string,
    controller: DesktopStartupRecoveryController | undefined,
    requested = false,
  ): Promise<'restart' | 'quit' | 'unavailable'> => {
    if (!app.isReady()) return 'unavailable'
    try {
      startupRecoveryWindow = new DesktopStartupRecoveryWindow({
        ...(controller === undefined ? {} : { controller }),
        ...(startupRecoveryConfigurationPaths === undefined
          ? {}
          : { configurationPaths: startupRecoveryConfigurationPaths }),
        locale: desktopLocaleFromLanguageTag(app.getLocale()),
        failureStage: startupStage,
        failureDetail: maskSecrets(failureDetail),
        ...(requested ? { requested: true } : {}),
        exportDiagnostics: async signal => await exportDesktopDiagnostics(app.getPath('userData'), {
          appVersion,
          crashDumpsDir: app.getPath('crashDumps'),
          signal,
        }),
        ...(recoveryTerminalAvailable ? { openTerminal: () => { runtime.openTerminal() } } : {}),
        ...(startupRecoveryProfileActions === undefined ? {} : { profileActions: startupRecoveryProfileActions }),
      })
      return await startupRecoveryWindow.run()
    } catch (cause) {
      electronLogger.error(
        `${BIN_NAME}: failed to open startup recovery window: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      return 'unavailable'
    } finally {
      startupRecoveryWindow = undefined
    }
  }

  const showPreHostSurface = (): boolean => {
    if (setupWizardWindow !== undefined) {
      setupWizardWindow.show()
      return true
    }
    if (startupRecoveryWindow !== undefined) {
      startupRecoveryWindow.show()
      return true
    }
    return false
  }
  app.on('activate', () => { showPreHostSurface() })
  if (process.platform === 'darwin') app.on('did-become-active', () => { showPreHostSurface() })
  app.on('second-instance', (_event, argv) => {
    if (isDesktopInstallerQuitRequest(argv, process.platform)) {
      requestQuit(0)
      return
    }
    if (!showPreHostSurface()) runtime.show()
  })
  try {
    await app.whenReady()
    startupStage = 'shell-environment'
    lifecycleRecorder.transitionStartupStage(startupStage)
    if (process.platform === 'win32') app.setAppUserModelId('ai.deepseek.dsh.desktop')
    if (app.isPackaged && process.cwd() === '/') process.chdir(app.getPath('home'))
    const shellEnvironmentResolution = await resolveDesktopShellEnvironment({
      environment: process.env,
      home: app.getPath('home'),
      isPackaged: app.isPackaged,
      platform: process.platform,
    })
    for (const [name, value] of Object.entries(shellEnvironmentResolution.updates)) process.env[name] = value
    const homeDir = resolveDshHome()
    const projectionCacheRecovery = recoverOversizedSessionProjectionCache(homeDir)
    if (projectionCacheRecovery.status === 'quarantined') {
      sessionProjectionCacheRecovery = projectionCacheRecovery
      electronLogger.error(
        `${BIN_NAME}: quarantined oversized session projection cache (${String(projectionCacheRecovery.sizeBytes)} bytes) at `
          + `${projectionCacheRecovery.cachePath}; backup saved to ${projectionCacheRecovery.backupPath}`,
      )
    }
    const windowsVolumeConcerns = diagnoseWindowsVolumes(process.platform, [
      { label: 'application install', path: process.execPath },
      { label: 'desktop user data', path: app.getPath('userData') },
      { label: 'DSH home', path: homeDir },
    ])
    warnWindowsVolumeConcerns(electronLogger, windowsVolumeConcerns)

    const failLoudProcess: FailLoudProcess = {
      on: (event, handler) => process.on(event, handler),
      off: (event, handler) => process.off(event, handler),
      stderr: electronLogger,
      exit: finalExit,
    }
    installFailLoud(BIN_NAME, failLoudProcess, async () => { await generation.release() })

    startupStage = 'runtime-bootstrap'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const environment = loadLayeredEnv(BIN_NAME, process.cwd())
    const electronVersion = process.versions.electron
    if (electronVersion === undefined) {
      throw new Error(`${BIN_NAME}: plugin runtime requires the Electron runtime version`)
    }
    const pnpmBinPath = packagedDependencyPath(import.meta.url, 'pnpm/bin/pnpm.mjs')
    const pnpmRuntime = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: process.execPath,
      pnpmBinPath,
      electronVersion,
      stateDir: join(app.getPath('userData'), 'runtime-commands'),
      environment: process.env,
    })
    const dshBootstrapPath = fileURLToPath(new URL('./desktop-cli.js', import.meta.url))
    const releasePnpmRuntime = generation.own(() => { pnpmRuntime.dispose() })
    const selectionStatePath = join(app.getPath('userData'), 'profile-selection', 'state.json')
    const pluginManagementStatePath = join(app.getPath('userData'), 'plugin-management', 'state.json')
    startupStage = 'profile-selection'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const profileStartup = beginDesktopProfileStartup(selectionStatePath, homeDir)
    const activeProfileName = profileStartup.profileName
    const activeProfileDir = resolveProfileDir(activeProfileName, homeDir)
    // Recovery can open before Profile composition and Host boot. Fix the
    // launcher-owned terminal identity as soon as Profile selection succeeds
    // so every recovery entry path exposes the same terminal action.
    runtime.configureTerminal({
      profileName: activeProfileName,
      profileDir: activeProfileDir,
      homeDir,
    })
    recoveryTerminalAvailable = true
    const recoveryProfileToken = randomUUID()
    startupRecoveryProfileActions = {
      token: recoveryProfileToken,
      list: () => listDesktopProfiles(homeDir).map(profile => ({
        name: profile.name,
        current: profile.name === activeProfileName,
        selectable: profile.webCapable && profile.problem === undefined,
      })),
      switchProfile: (name, token) => {
        if (token !== recoveryProfileToken || profileRecoveryActionUsed) {
          throw new Error(`${BIN_NAME}: the Profile recovery action is no longer valid`)
        }
        profileRecoveryActionUsed = true
        assertDesktopProfileName(name)
        const selection = readDesktopProfileState(selectionStatePath)
        if (selection.active !== activeProfileName) throw new Error(`${BIN_NAME}: active Profile changed before recovery`)
        const target = listDesktopProfiles(homeDir).find(profile => profile.name === name)
        if (target === undefined || !target.webCapable || target.problem !== undefined) {
          throw new Error(`${BIN_NAME}: Profile ${JSON.stringify(name)} is unavailable`)
        }
        selectDesktopProfile(selectionStatePath, homeDir, name)
      },
      openCreator: () => {
        runtime.openProfileCreateWindow({
          onSubmit: async name => {
            assertDesktopProfileName(name)
            const selection = readDesktopProfileState(selectionStatePath)
            if (selection.active !== activeProfileName) throw new Error(`${BIN_NAME}: active Profile changed before recovery`)
            createDesktopWebProfile(homeDir, name)
            selectDesktopProfile(selectionStatePath, homeDir, name)
          },
        })
      },
    }
    try {
      profileCheckpoint = new DesktopProfileCheckpoint({
        userDataDir: app.getPath('userData'),
        profileDir: activeProfileDir,
        homeDir,
        profileName: activeProfileName,
        provider: 'desktop-profile',
        appVersion,
      })
    } catch (cause) {
      electronLogger.error(
        `${BIN_NAME}: healthy profile checkpoints are unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    startupRecoveryConfigurationPaths = {
      settingsDocument: join(homeDir, 'settings.yaml'),
      profilePatch: join(activeProfileDir, PROFILE_PATCH_FILENAME),
      profileManifest: join(activeProfileDir, 'package.json'),
      profileDirectory: activeProfileDir,
    }
    if (profileCheckpoint !== undefined) {
      startupRecoveryController = new DesktopStartupRecoveryController({
        pluginState: {
          profileName: activeProfileName,
          homeDir,
          statePath: pluginManagementStatePath,
        },
        generationId,
        currentGeneration: () => ({
          profileName: readDesktopProfileState(selectionStatePath).active,
          generationId,
        }),
        uninstallPlugin: async packageName => {
          try {
            await removeRecoveryPlugin({
              appExecutable: process.execPath,
              dshBootstrapPath,
              profileName: activeProfileName,
              profileDir: activeProfileDir,
              homeDir,
              nodeBinDir: pnpmRuntime.nodeBinDir,
              nodeShimPath: pnpmRuntime.nodeShimPath,
              pnpmBinDir: pnpmRuntime.pathDir,
              electronVersion,
              packageName,
            })
          } catch (cause) {
            const detail = maskSecrets(formatRecoveryPluginRemoveFailure(cause))
            electronLogger.error(`${BIN_NAME}: recovery plugin uninstall failed:\n${detail}`)
            throw new DesktopStartupRecoveryControllerError(
              'operation-failed',
              'The plugin could not be removed from the current Profile.',
              { operationStage: 'plugin-change', diagnosticDetail: detail },
            )
          }
        },
        checkpoints: profileCheckpoint,
        openCheckpointDirectory: async path => {
          const error = await shell.openPath(path)
          if (error.length > 0) throw new Error(error)
        },
        afterCheckpointRestore: async result => {
          if (!result.dependencyMaterializationRequired) return
          try {
            await materializeProfile({
              appExecutable: process.execPath,
              clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
              pnpmBinPath,
              nodeBinDir: pnpmRuntime.nodeBinDir,
              nodeShimPath: pnpmRuntime.nodeShimPath,
              homeDir,
              profileDir: activeProfileDir,
              electronVersion,
            })
          } catch (cause) {
            const detail = maskSecrets(formatProfileMaterializationFailure(cause))
            electronLogger.error(`${BIN_NAME}: checkpoint dependency materialization failed:\n${detail}`)
            throw new DesktopStartupRecoveryControllerError(
              'operation-failed',
              'The checkpoint files were restored, but Profile dependencies could not be rebuilt.',
              {
                operationStage: 'dependency-materialization',
                diagnosticDetail: detail,
              },
            )
          }
        },
      })
    }
    if (recoveryModeRequested) {
      const recoveryResult = await openStartupRecoveryWindow(
        'Recovery mode was requested from the Desktop restart menu.',
        startupRecoveryController,
        true,
      )
      startupRecoveryController?.dispose()
      startupRecoveryController = undefined
      if (recoveryResult === 'restart') nativeExit.requestRelaunch()
      await shutdown.request(recoveryResult === 'restart' ? 0 : 1)
      return
    }
    startupStage = 'profile-composition'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const marketUserDataDir = app.getPath('userData')
    const lanAddresses = desktopLanAddresses()
    const legacyMarketSelection = readDesktopMarketStateForUserData(marketUserDataDir)
    let profilePreferences = readDesktopProfilePreferences(marketUserDataDir, activeProfileDir)
    let marketSelection = profilePreferences === undefined
      ? legacyMarketSelection
      : desktopProfileMarketSnapshot(profilePreferences.market)
    const preparationHooks = {
      lanAddresses,
      onSettingsDocumentResolved: (settingsDocument: string) => {
        if (startupRecoveryConfigurationPaths === undefined) return
        startupRecoveryConfigurationPaths = {
          ...startupRecoveryConfigurationPaths,
          settingsDocument,
        }
      },
    }
    await healDesktopProfileModuleFallback(homeDir)
    let prepared = prepareDesktopProfile(
      process.env.DSH_TELEMETRY_DISABLED,
      homeDir,
      process.platform,
      activeProfileName,
      pluginManagementStatePath,
      marketSelection,
      preparationHooks,
    )
    if (profilePreferences === undefined) {
      const browserAccessMigrated = await migrateDesktopBrowserAccessSettings(prepared.settingsDocument)
      let windowMaterialMigrated = false
      try {
        windowMaterialMigrated = await migrateDesktopWindowMaterialSettings(prepared.settingsDocument)
      } catch (cause) {
        // Legacy Acrylic is already normalized to off by the read boundary. A
        // read-only settings file must not turn removal of the effect into a
        // startup failure merely because the durable cleanup could not be saved.
        electronLogger.error(
          `${BIN_NAME}: failed to persist removed Acrylic material migration: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
      if (browserAccessMigrated || windowMaterialMigrated) {
        prepared = prepareDesktopProfile(
          process.env.DSH_TELEMETRY_DISABLED,
          homeDir,
          process.platform,
          activeProfileName,
          pluginManagementStatePath,
          marketSelection,
          preparationHooks,
        )
      }
      const importedSettings = readDesktopSetupWizardSettings(prepared.settingsDocument)
      profilePreferences = await writeDesktopProfilePreferences(
        marketUserDataDir,
        prepared.profile.dir,
        desktopProfilePreferencesFromSettings(
          prepared,
          importedSettings.notifications,
          legacyMarketSelection.requested,
        ),
      )
    } else {
      // Existing Profile state is the source of truth. Mirror it only after the
      // first prepare has resolved this Profile's exact settings document.
      await mirrorDesktopProfilePreferences(prepared.settingsDocument, profilePreferences)
      try {
        await migrateDesktopWindowMaterialSettings(prepared.settingsDocument)
      } catch (cause) {
        // Keep retrying the device-owned Acrylic cleanup on later launches,
        // even after this Profile has completed its one-time preference import.
        electronLogger.error(
          `${BIN_NAME}: failed to persist removed Acrylic material migration: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
      await selectDesktopMarketProvider(marketUserDataDir, profilePreferences.market)
      marketSelection = readDesktopMarketStateForUserData(marketUserDataDir)
      prepared = prepareDesktopProfile(
        process.env.DSH_TELEMETRY_DISABLED,
        homeDir,
        process.platform,
        activeProfileName,
        pluginManagementStatePath,
        marketSelection,
        preparationHooks,
      )
    }
    const setupWizardState = readDesktopSetupWizardState(marketUserDataDir, prepared.profile.dir)
    if (desktopSetupWizardRequired(setupWizardState, setupWizardVersions)) {
      const setupSettings = readDesktopSetupWizardSettings(prepared.settingsDocument)
      setupWizardWindow = new DesktopSetupWizardWindow({
        locale: desktopLocaleFromLanguageTag(app.getLocale()),
        input: {
          profileName: activeProfileName,
          platform: runtime.platform,
          micaSupported: process.platform === 'win32' && windowsSupportsMica(runtime.windowsBuild),
          ...setupSettings,
          market: marketSelection.requested,
        },
      })
      let setupResult: DesktopSetupWizardResult
      try {
        setupResult = await setupWizardWindow.run()
      } finally {
        setupWizardWindow = undefined
      }
      if (setupResult.action === 'quit') {
        startupRecoveryController?.dispose()
        startupRecoveryController = undefined
        await shutdown.request(0)
        return
      }
      if (setupResult.action === 'skip') {
        await completeOrSkipDesktopSetupWizard(
          marketUserDataDir,
          prepared.profile.dir,
          'skipped',
          setupWizardVersions,
        )
      } else {
        profilePreferences = await writeDesktopProfilePreferences(
          marketUserDataDir,
          prepared.profile.dir,
          desktopProfilePreferencesFromSettings(
            setupResult.selection,
            setupResult.selection.notifications,
            setupResult.selection.market,
          ),
        )
        await updateDesktopSetupWizardSettings(prepared.settingsDocument, {
          mode: setupResult.selection.mode,
          macosMaterial: setupResult.selection.macosMaterial,
          windowsMaterial: setupResult.selection.windowsMaterial,
          openBrowser: setupResult.selection.openBrowser,
          networkExposure: setupResult.selection.networkExposure,
          notifications: setupResult.selection.notifications,
        })
        await selectDesktopMarketProvider(marketUserDataDir, setupResult.selection.market)
        marketSelection = readDesktopMarketStateForUserData(marketUserDataDir)
        prepared = prepareDesktopProfile(
          process.env.DSH_TELEMETRY_DISABLED,
          homeDir,
          process.platform,
          activeProfileName,
          pluginManagementStatePath,
          marketSelection,
          preparationHooks,
        )
        await completeOrSkipDesktopSetupWizard(
          marketUserDataDir,
          prepared.profile.dir,
          'completed',
          setupWizardVersions,
        )
      }
    }
    if (profileCheckpoint === undefined) {
      try {
        profileCheckpoint = new DesktopProfileCheckpoint({
          userDataDir: app.getPath('userData'),
          profileDir: prepared.profile.dir,
          homeDir,
          profileName: activeProfileName,
          provider: 'desktop-profile',
          appVersion,
        })
      } catch (cause) {
        electronLogger.error(
          `${BIN_NAME}: healthy profile checkpoints remain unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    }
    startupStage = 'runtime-bootstrap'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const dshRuntime = process.platform === 'win32'
      ? installDesktopDshRuntime({
          platform: process.platform,
          appExecutable: process.execPath,
          dshBootstrapPath,
          profileName: activeProfileName,
          homeDir,
          stateDir: join(app.getPath('userData'), 'host-commands', activeProfileName),
          environment: process.env,
        })
      : undefined
    const releaseDshRuntime = generation.own(() => { dshRuntime?.dispose() })
    if (prepared.requiresDependencyMigration) {
      electronLogger.error(`${BIN_NAME}: migrating legacy Profile dependency layout with packaged pnpm`)
      try {
        await materializeProfile({
          appExecutable: process.execPath,
          clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
          pnpmBinPath,
          nodeBinDir: pnpmRuntime.nodeBinDir,
          nodeShimPath: pnpmRuntime.nodeShimPath,
          homeDir,
          profileDir: prepared.profile.dir,
          electronVersion,
          updateLockfile: true,
        })
        prepared = prepareDesktopProfile(
          process.env.DSH_TELEMETRY_DISABLED,
          homeDir,
          process.platform,
          activeProfileName,
          pluginManagementStatePath,
          marketSelection,
          preparationHooks,
        )
        if (prepared.requiresDependencyMigration) {
          throw new Error(`${BIN_NAME}: packaged pnpm did not produce compatible Profile dependency metadata`)
        }
      } catch (migrationCause) {
        const detail = migrationCause instanceof ProfileMaterializationError
          ? migrationCause.result?.stderr || migrationCause.message
          : migrationCause instanceof Error ? migrationCause.message : String(migrationCause)
        throw new Error(`${BIN_NAME}: Profile dependency migration failed: ${maskSecrets(detail)}`)
      }
    }
    if (prepared.marketFailure !== undefined) {
      electronLogger.error(
        `${BIN_NAME}: requested Market provider ${prepared.market.requested} was disabled for this generation: ${prepared.marketFailure}`,
      )
    }
    let lanHttpsCertificate: Awaited<ReturnType<typeof createLanHttpsCertificate>> | undefined
    let lanHttpsFailureCode: string | undefined
    if (prepared.lanAddresses.length === 0) {
      lanHttpsFailureCode = 'no-address'
    } else {
      try {
        lanHttpsCertificate = await createLanHttpsCertificate(
          marketUserDataDir,
          prepared.lanAddresses,
          desktopLanHttpsPrivateKeyProtector(),
        )
      } catch (cause) {
        lanHttpsFailureCode = cause instanceof DesktopLanHttpsCertificateError
          ? cause.code
          : 'certificate-state'
        electronLogger.error(
          `${BIN_NAME}: LAN HTTPS certificate setup is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    }
    const lanHttps = new DesktopLanHttpsRuntime({
      addresses: prepared.lanAddresses,
      ...(lanHttpsCertificate === undefined ? {} : { certificate: lanHttpsCertificate }),
      ...(lanHttpsFailureCode === undefined ? {} : { failureCode: lanHttpsFailureCode }),
      requestedPort: 0,
    })
    const browserAccess = createDesktopBrowserAccess(
      prepared.mode === 'compatibility' && prepared.openBrowser,
    )
    const desktopPnpmBootstrap: DesktopPnpmBootstrap = {
      activeProfileName,
      activeProfileDir: prepared.profile.dir,
      homeDir,
      appExecutable: process.execPath,
      pnpmBinPath,
      electronVersion,
      nodeBinDir: pnpmRuntime.nodeBinDir,
      nodeShimPath: pnpmRuntime.nodeShimPath,
      clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
      dshBootstrapPath,
    }
    await healDesktopProfileModuleFallback(homeDir, prepared.profile)
    if (profilePreferences === undefined) {
      throw new Error(`${BIN_NAME}: active Profile preferences were not initialized`)
    }
    let currentProfilePreferences: DesktopProfilePreferences = profilePreferences
    let profilePreferencesWriteTail: Promise<void> = Promise.resolve()
    let profilePreferencesStopping = false
    const enqueueProfilePreferencesWrite = (
      update: (current: DesktopProfilePreferences) => DesktopProfilePreferences,
    ): Promise<DesktopProfilePreferencesStateV1> => {
      if (profilePreferencesStopping) {
        return Promise.reject(new Error(`${BIN_NAME}: Profile preferences are stopping`))
      }
      const write = profilePreferencesWriteTail.then(async () => {
        const next = update(currentProfilePreferences)
        const stored = await writeDesktopProfilePreferences(
          marketUserDataDir,
          prepared.profile.dir,
          next,
        )
        currentProfilePreferences = stored
        return stored
      })
      profilePreferencesWriteTail = write.then(() => undefined, () => undefined)
      return write
    }
    const flushProfilePreferencesWrites = async (): Promise<void> => {
      profilePreferencesStopping = true
      await profilePreferencesWriteTail
    }
    startupStage = 'host-boot'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
    const ctx = await boot(
      BIN_NAME,
      prepared.rootConfig,
      prepared.patches,
      async (hostCtx) => {
        // Keep Host imports and browser bundle discovery on the same public
        // profile-overlay resolver used by packaged Electron.
        hostCtx.loader.internal = undefined
        generation.bindHost(hostCtx)
        hostCtx.effect(
          () => async () => { await flushProfilePreferencesWrites() },
          'dsh-plugin-desktop: flush Profile preference writes',
        )
        hostCtx.effect(
          () => releasePnpmRuntime,
          'dsh-plugin-desktop: packaged pnpm runtime PATH',
        )
        if (dshRuntime !== undefined) {
          hostCtx.effect(
            () => releaseDshRuntime,
            'dsh-plugin-desktop: packaged dsh runtime PATH',
          )
        }
        hostCtx.effect(
          () => releasePackageResolver,
          'dsh-plugin-desktop: profile package resolution',
        )
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
        hostCtx.provide('desktopBrowserAccess', browserAccess)
        hostCtx.provide('desktopLanHttps', lanHttps)
        hostCtx.provide('desktopRuntime', runtime)
        hostCtx.provide('desktopPnpmBootstrap', desktopPnpmBootstrap)
        await hostCtx.plugin(DesktopActionsService, {
          openTerminal: () => { runtime.openTerminal() },
          requestRestart: () => runtime.requestRestart(),
        })
        if (prepared.market.effective === 'community-market') {
          await hostCtx.plugin(DesktopPluginsService, {
            profileName: activeProfileName,
            homeDir,
            statePath: pluginManagementStatePath,
            installAnchor: desktopInstallAnchor(),
          })
        }
        if (logSink !== undefined) {
          fileExporter = new FileExporter(logSink)
          hostCtx.logger.exporter(fileExporter)
        }
        await hostCtx.plugin(DesktopProfileService, {
          current: {
            name: activeProfileName,
            dir: prepared.profile.dir,
          },
          create: name => createDesktopWebProfile(homeDir, name),
          list: () => listDesktopProfiles(homeDir),
          canDelete: name => canDeleteDesktopProfile({
            home: homeDir,
            selectionStatePath,
            currentProfileName: activeProfileName,
          }, name),
          delete: async name => {
            const profileDir = resolveProfileDir(name, homeDir)
            await deleteDesktopProfile({
              home: homeDir,
              selectionStatePath,
              currentProfileName: activeProfileName,
              clearDisabledState: () => clearDesktopProfilePluginState(pluginManagementStatePath, name),
              clearCheckpoint: async () => {
                clearDesktopProfileCheckpoint(marketUserDataDir, profileDir)
                await clearDesktopSetupWizardState(marketUserDataDir, profileDir)
              },
            }, name)
            try {
              await clearDesktopProfilePreferences(marketUserDataDir, profileDir)
            } catch (cause) {
              hostCtx.logger.error(
                `${BIN_NAME}: deleted Profile left stale preference state: ${cause instanceof Error ? cause.message : String(cause)}`,
              )
            }
          },
          persistSelection: name => { selectDesktopProfile(selectionStatePath, homeDir, name) },
          requestRestart: () => runtime.requestRestart(),
        })
        let pendingSettingsRestart: ReturnType<typeof setImmediate> | undefined
        const scheduleSettingsRestart = (): void => {
          pendingSettingsRestart ??= setImmediate(() => {
            pendingSettingsRestart = undefined
            void runtime.requestRestart().catch((cause: unknown) => {
              hostCtx.logger.error(
                `${BIN_NAME}: failed to restart after Desktop setting change: ${cause instanceof Error ? cause.message : String(cause)}`,
              )
            })
          })
        }
        hostCtx.effect(() => () => {
          if (pendingSettingsRestart !== undefined) clearImmediate(pendingSettingsRestart)
          pendingSettingsRestart = undefined
        }, 'dsh-plugin-desktop: pending Desktop settings restart')
        const readMarket = () => desktopMarketSnapshotWithEffective(
          desktopProfileMarketSnapshot(currentProfilePreferences.market),
          prepared.market.effective,
        )
        hostCtx.provide('desktopSettingsController', new DesktopSettingsController({
          profiles: hostCtx.desktopProfiles,
          persistProfileSelection: name => {
            selectDesktopProfile(selectionStatePath, homeDir, name)
          },
          readMarket,
          readWeb: () => {
            const lan = lanHttps.snapshot()
            const lanOrigins = lan.state === 'ready' && lan.actualPort !== null
              ? desktopLanBrowserUrls(lan.actualPort, lan.addresses)
              : []
            return {
              localUrl: hostCtx.connection.authenticatedUrl(
                desktopLoopbackBrowserUrl(hostCtx.webServer.port),
              ),
              lanUrls: lanOrigins.map(url => hostCtx.connection.authenticatedUrl(url)),
              lanState: lan.state,
              lanError: lan.errorCode,
              lanCaFingerprint: lan.caFingerprint,
              lanCaUrls: lanOrigins.map((origin) => {
                return new URL(DESKTOP_LAN_HTTPS_CA_PATH, origin).href
              }),
            }
          },
          selectMarket: async provider => {
            await enqueueProfilePreferencesWrite(current => desktopProfilePreferencesFromSettings(
              current,
              current.notifications,
              provider,
            ))
            return desktopMarketSnapshotWithEffective(
              await selectDesktopMarketProvider(marketUserDataDir, provider),
              prepared.market.effective,
            )
          },
          scheduleRestart: scheduleSettingsRestart,
          scheduleRecoveryRestart: () => {
            void runtime.requestRecoveryRestart().catch((cause: unknown) => {
              hostCtx.logger.error(
                `${BIN_NAME}: failed to restart in recovery mode: ${cause instanceof Error ? cause.message : String(cause)}`,
              )
            })
          },
          openTerminal: () => { runtime.openTerminal() },
          reloadRenderer: () => { runtime.reloadRenderer() },
          toggleDeveloperTools: () => { runtime.toggleDeveloperTools() },
          exportDiagnostics: () => runtime.exportDiagnostics(),
          openProfileCreator: () => {
            runtime.openProfileCreateWindow({
              onSubmit: async name => {
                hostCtx.desktopProfiles.create(name)
                await hostCtx.desktopProfiles.select(name)
              },
            })
          },
        }))
        provideCmdline(hostCtx, {
          args: [
            '--port',
            String(prepared.port),
          ],
          exit: requestQuit,
        })
      },
      prepared.bareModuleBaseUrl,
    ).catch((cause: unknown) => {
      releasePackageResolver()
      throw cause
    })
    generation.bindHost(ctx)
    fileExporter?.setThreshold((ctx.settings.get(DESKTOP_SETTINGS_NAMESPACE) as DesktopSettings | undefined)?.logLevel ?? 'info')
    ctx.on('settings/updated', (namespace, next) => {
      if (namespace === DESKTOP_SETTINGS_NAMESPACE) {
        fileExporter?.setThreshold((next as DesktopSettings).logLevel)
      }
      if (namespace !== DESKTOP_SETTINGS_NAMESPACE
        && namespace !== DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE) return
      const write = enqueueProfilePreferencesWrite(current => desktopProfilePreferencesFromSettings(
        namespace === DESKTOP_SETTINGS_NAMESPACE
          ? next as DesktopSettings
          : ctx.settings.get(DESKTOP_SETTINGS_NAMESPACE) as DesktopSettings,
        namespace === DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE
          ? next as DesktopNotificationSettings
          : ctx.settings.get(DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE) as DesktopNotificationSettings,
        current.market,
      ))
      void write.catch((cause: unknown) => {
        ctx.logger.error(
          `${BIN_NAME}: failed to capture active Profile settings: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      })
    })
    startupStage = 'renderer-startup'
    lifecycleRecorder.transitionStartupStage(startupStage)
    lifecycleRecorder.startRendererBoot()
    const rendererBoot = runtime.beginRendererBootMonitoring({
      commitHealthy: async () => {
        lifecycleRecorder.finishRendererBoot({ status: 'healthy' }, 'renderer-failed')
        startupStage = 'health-commit'
        lifecycleRecorder.transitionStartupStage(startupStage)
        try {
          profileCheckpoint?.captureHealthy()
        } catch (cause) {
          electronLogger.error(
            `${BIN_NAME}: failed to checkpoint the healthy profile configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        }
      },
    })
    const [, rendererVerdict] = await Promise.all([
      runtime.mountScheduled(),
      rendererBoot,
    ])
    const rendererReport = rendererVerdict.report
    if ('failureReason' in rendererVerdict) {
      throw new RendererStartupFailure(
        rendererVerdict.failureReason,
        rendererVerdict.report,
      )
    }
    lifecycleRecorder.completeStartup(startupStage, rendererReport)
    notifySkippedOptionalEntries(runtime, electronLogger, prepared.skippedOptionalEntries)
    notifyWindowsVolumeConcerns(runtime, electronLogger, windowsVolumeConcerns)
    if (sessionProjectionCacheRecovery !== undefined) {
      notifySessionProjectionCacheRecovery(runtime, electronLogger, sessionProjectionCacheRecovery)
    }
  } catch (cause) {
    runtime.stopRendererBootMonitoring()
    lifecycleRecorder.failRendererBootIfPending(lifecycleRendererFailureReason(runtime.rendererBootFailureReason))
    lifecycleRecorder.failStartup(startupStage, lifecycleStartupFailureReason(cause, runtime))
    electronLogger.errorCause(cause)
    let exitCode = 1
    const failureRoute = routeDesktopStartupFailure({
      appReady: app.isReady(),
      stage: startupStage,
    })
    const recoveryActionsSafe = await generation.quiesceForRecovery()
    if (failureRoute === 'startup-recovery') {
      const detail = cause instanceof Error ? cause.message : String(cause)
      const recoveryResult = await openStartupRecoveryWindow(
        detail,
        recoveryActionsSafe ? startupRecoveryController : undefined,
      )
      if (recoveryResult === 'restart') {
        nativeExit.requestRelaunch()
        exitCode = 0
      }
    }
    startupRecoveryController?.dispose()
    await shutdown.request(exitCode)
  }
}

async function run(): Promise<void> {
  app.setName(PRODUCT_NAME)
  if (process.argv.includes('--export-diagnostics')) {
    try {
      await app.whenReady()
      const path = await exportDesktopDiagnostics(app.getPath('userData'), {
        appVersion: desktopProductVersion(),
        crashDumpsDir: app.getPath('crashDumps'),
      })
      await new Promise<void>((resolve, reject) => {
        process.stdout.write(`${path}\n`, error => {
          if (error === undefined || error === null) resolve()
          else reject(error)
        })
      })
      app.exit(0)
    } catch (cause) {
      const message = `dsh-plugin-desktop: failed to export diagnostics: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`
      await new Promise<void>(resolve => {
        process.stderr.write(message, () => { resolve() })
      })
      app.exit(1)
    }
    return
  }
  await start()
}

/** Last-resort branch for launcher failures that happen before start's owned coordinator exists. */
async function handleFatalLauncherFailure(cause: unknown): Promise<void> {
  const detail = maskSecrets(cause instanceof Error ? cause.stack ?? cause.message : String(cause))
  process.stderr.write(`${BIN_NAME}: fatal launcher failure: ${detail}\n`)
  if (!app.isReady()) {
    app.exit(1)
    return
  }
  try {
    const recoveryWindow = new DesktopStartupRecoveryWindow({
      locale: desktopLocaleFromLanguageTag(app.getLocale()),
      failureStage: 'electron-ready',
      failureDetail: detail,
      exportDiagnostics: async signal => await exportDesktopDiagnostics(app.getPath('userData'), {
        appVersion: desktopProductVersion(),
        crashDumpsDir: app.getPath('crashDumps'),
        signal,
      }),
    })
    const result = await recoveryWindow.run()
    if (result === 'restart') {
      app.relaunch()
      app.exit(0)
    } else {
      app.exit(1)
    }
  } catch (windowCause) {
    process.stderr.write(
      `${BIN_NAME}: fatal recovery window failure: ${maskSecrets(windowCause instanceof Error ? windowCause.stack ?? windowCause.message : String(windowCause))}\n`,
    )
    app.exit(1)
  }
}

void run().catch(async (cause: unknown) => { await handleFatalLauncherFailure(cause) })
