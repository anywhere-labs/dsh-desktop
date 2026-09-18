/** Headless bootstrap for the Beta isolated Host experiment. */
import { boot, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { DESKTOP_PACKAGE_NAME as BIN_NAME } from './product-identity.ts'
import { DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from './index.ts'
import { DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE, type DesktopNotificationSettings } from './notifications.ts'
import { installProfilePackageResolver } from './module-resolution.ts'
import { createDesktopWebProfile, listDesktopProfiles, canDeleteDesktopProfile, deleteDesktopProfile, selectDesktopProfile } from './profile-manager.ts'
import { DesktopProfileService } from './profile-service.ts'
import { DesktopActionsService } from './desktop-actions.ts'
import { clearDesktopProfilePluginState, DesktopPluginsService } from './desktop-plugins.ts'
import { desktopMarketSnapshotWithEffective, selectDesktopMarketProvider, type DesktopMarketProvider, type DesktopMarketSnapshot } from './desktop-market.ts'
import DesktopSettingsController from './desktop-settings-controller.ts'
import { clearDesktopProfilePreferences, desktopProfilePreferencesFromSettings, writeDesktopProfilePreferences, type DesktopProfilePreferences, type DesktopProfilePreferencesStateV1 } from './profile-preferences.ts'
import { clearDesktopProfileUsageHistory, type DesktopReleaseUserDataLocations } from './profile-channel-admission.ts'
import { desktopInstallAnchor, type PreparedDesktopProfile } from './profile.ts'
import { desktopLanBrowserUrls, desktopLoopbackBrowserUrl } from './desktop-network.ts'
import { DESKTOP_LAN_HTTPS_CA_PATH, type DesktopLanHttpsRuntime } from './lan-https-runtime.ts'
import type { DesktopBrowserAccess } from './desktop-browser-access.ts'
import type { DesktopPnpmBootstrap } from './pnpm.ts'
import type { DesktopRuntime } from './runtime.ts'
import type { DesktopStartupGenerationHost } from './startup-generation.ts'
import { FileExporter } from './file-exporter.ts'
import { LogFileSink } from './log-files.ts'

function desktopProfileMarketSnapshot(market: DesktopMarketProvider): DesktopMarketSnapshot {
  return Object.freeze({
    requested: market,
    effective: market,
    legacyDefaulted: false,
  })
}

export interface DesktopHostOptions {
  prepared: PreparedDesktopProfile
  profilePreferences: DesktopProfilePreferences
  homeDir: string
  activeProfileName: string
  pluginManagementStatePath: string
  selectionStatePath: string
  marketUserDataDir: string
  releaseUserDataLocations: DesktopReleaseUserDataLocations
  desktopLaunchEnvironment: LaunchEnvironmentSnapshot
  desktopPnpmBootstrap: DesktopPnpmBootstrap
  logDirectory: string
}

export async function bootDesktopHost(options: DesktopHostOptions, runtime: DesktopRuntime,
  browserAccess: DesktopBrowserAccess, lanHttps: DesktopLanHttpsRuntime,
  bindHost: (host: DesktopStartupGenerationHost) => void, requestQuit: (code: number) => void,
): Promise<() => { aaRuntime: boolean; aaOnboarding: boolean }> {
  const { prepared, profilePreferences, homeDir, activeProfileName, pluginManagementStatePath,
    selectionStatePath, marketUserDataDir, releaseUserDataLocations, desktopLaunchEnvironment,
    desktopPnpmBootstrap } = options
  const createFreshDesktopProfile = (name: string) => {
    const created = createDesktopWebProfile(homeDir, name)
    clearDesktopProfileUsageHistory(releaseUserDataLocations, created.dir)
    return created
  }
  const logSink = new LogFileSink(options.logDirectory, {
    maxFileBytes: 10 * 1024 * 1024, maxDirectoryBytes: 200 * 1024 * 1024,
  })
  let fileExporter: FileExporter | undefined
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
    const releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
    const ctx = await boot(
      BIN_NAME,
      prepared.rootConfig,
      prepared.patches,
      async (hostCtx) => {
        // Keep Host imports and browser bundle discovery on the same public
        // profile-overlay resolver used by packaged Electron.
        hostCtx.loader.internal = undefined
        bindHost(hostCtx)
        hostCtx.effect(() => () => logSink.close(), 'dsh-plugin-desktop: Host log sink')
        hostCtx.effect(
          () => async () => { await flushProfilePreferencesWrites() },
          'dsh-plugin-desktop: flush Profile preference writes',
        )
        hostCtx.effect(
          () => releasePackageResolver,
          'dsh-plugin-desktop: profile package resolution',
        )
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, desktopLaunchEnvironment)
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
          create: name => createFreshDesktopProfile(name),
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
                clearDesktopProfileUsageHistory(releaseUserDataLocations, profileDir)
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
          readMarket,
          readAa: () => ({ requested: currentProfilePreferences.aaEnabled === true, effective: prepared.aaEnabled }),
          selectAa: async enabled => {
            await enqueueProfilePreferencesWrite(current => desktopProfilePreferencesFromSettings(
              current,
              current.notifications,
              current.market,
              enabled,
            ))
          },
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
              current.aaEnabled === true,
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
    bindHost(ctx)
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
        current.aaEnabled === true,
      ))
      void write.catch((cause: unknown) => {
        ctx.logger.error(
          `${BIN_NAME}: failed to capture active Profile settings: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      })
    })
  return () => ({ aaRuntime: ctx.get('agentsAnywhereRuntime') !== undefined, aaOnboarding: ctx.get('agentsAnywhereOnboarding') !== undefined })
}
