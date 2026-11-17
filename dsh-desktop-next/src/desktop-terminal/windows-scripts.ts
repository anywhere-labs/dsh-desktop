/** The Windows terminal's generated files: the dsh, pnpm and node batch shims and the PowerShell and command prompt welcome scripts. */

import { PNPM_DISABLE_UPDATE_NOTIFIER, PNPM_IGNORE_MINIMUM_RELEASE_AGE } from '../pnpm-policy.ts'
import { ELECTRON_HEADERS_URL } from '../bundled-pnpm.ts'
import {
  DEFAULT_PROFILE,
  DSH_HOME,
  PATH,
  RUN_AS_NODE,
  WINDOWS_APP_EXECUTABLE,
  WINDOWS_DSH_BOOTSTRAP,
  WINDOWS_ELECTRON_VERSION,
  WINDOWS_PNPM_ENTRY,
  WINDOWS_PRODUCT_VERSION,
  WINDOWS_PROFILE_DIRECTORY,
  WINDOWS_SHIM_DIRECTORY,
  WINDOWS_TERMINAL_MODE,
} from './contract.ts'

/** Escape printable text following an `echo(` batch builtin. */
function escapeBatchText(value: string): string {
  if (/\r|\n/.test(value)) {
    throw new Error('dsh-desktop-next: terminal Windows welcome text must not contain newlines')
  }
  return value
    .replaceAll('^', '^^')
    .replaceAll('%', '%%')
    .replaceAll('&', '^&')
    .replaceAll('|', '^|')
    .replaceAll('<', '^<')
    .replaceAll('>', '^>')
    .replaceAll('(', '^(')
    .replaceAll(')', '^)')
}

/** Build a command shim that enables Electron's Node mode only for its child. */
export function windowsShim(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `set "${RUN_AS_NODE}=1"`,
    `"%${WINDOWS_APP_EXECUTABLE}%" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** Build the Windows DSH shim with Loader internals and one local default profile. */
export function windowsDshShim(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `set "${RUN_AS_NODE}=1"`,
    `"%${WINDOWS_APP_EXECUTABLE}%" --expose-internals "%${WINDOWS_DSH_BOOTSTRAP}%" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** Build a pnpm batch shim with Electron settings local to its `setlocal` child tree. */
export function windowsPnpmShim(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `set "${RUN_AS_NODE}=1"`,
    'set "npm_config_runtime=electron"',
    `set "npm_config_target=%${WINDOWS_ELECTRON_VERSION}%"`,
    `set "npm_config_disturl=${ELECTRON_HEADERS_URL}"`,
    `"%${WINDOWS_APP_EXECUTABLE}%" "%${WINDOWS_PNPM_ENTRY}%" ${PNPM_DISABLE_UPDATE_NOTIFIER} ${PNPM_IGNORE_MINIMUM_RELEASE_AGE} %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** Build the PowerShell script that remains active in the new console. */
export function windowsWelcome(): string {
  const commandHelp = 'dsh --dump-config'
  const pluginAdd = 'dsh plugin add <third-party-plugin>'
  const pluginRemove = 'dsh plugin remove <third-party-plugin>'
  const pluginUpdate = 'dsh plugin update'
  return [
    `Remove-Item Env:${RUN_AS_NODE} -ErrorAction SilentlyContinue`,
    `$dshDesktopShimDir = $env:${WINDOWS_SHIM_DIRECTORY}`,
    `$dshDesktopPath = @($env:${PATH} -split ';' | Where-Object { -not [string]::Equals($_, $dshDesktopShimDir, [StringComparison]::OrdinalIgnoreCase) })`,
    `$env:${PATH} = (@($dshDesktopShimDir) + $dshDesktopPath) -join ';'`,
    `Set-Location -LiteralPath $env:${WINDOWS_PROFILE_DIRECTORY}`,
    `Write-Host ("DSH Desktop {0} terminal" -f $env:${WINDOWS_PRODUCT_VERSION})`,
    `Write-Host $env:${WINDOWS_TERMINAL_MODE}`,
    `Write-Host ("Profile: {0}" -f $env:${DEFAULT_PROFILE})`,
    `Write-Host ("Profile directory: {0}" -f $env:${WINDOWS_PROFILE_DIRECTORY})`,
    `Write-Host ("Harness home: {0}" -f $env:${DSH_HOME})`,
    `Write-Host ("Plugin commands without --profile modify the {0} profile." -f $env:${DEFAULT_PROFILE})`,
    `Write-Host 'Commands:'`,
    `Write-Host '  ${commandHelp}'`,
    `Write-Host '  ${pluginAdd}'`,
    `Write-Host '  ${pluginRemove}'`,
    `Write-Host '  ${pluginUpdate}'`,
    `Write-Host 'Restart DSH Desktop after plugin changes.'`,
    '',
  ].join('\r\n')
}

/** Build the fallback batch welcome script used when PowerShell is unavailable. */
export function windowsCmdWelcome(): string {
  const commandHelp = 'dsh --dump-config'
  const pluginAdd = 'dsh plugin add <third-party-plugin>'
  const pluginRemove = 'dsh plugin remove <third-party-plugin>'
  const pluginUpdate = 'dsh plugin update'
  return [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    `set "${RUN_AS_NODE}="`,
    `cd /d "!${WINDOWS_PROFILE_DIRECTORY}!"`,
    `echo(DSH Desktop !${WINDOWS_PRODUCT_VERSION}! terminal`,
    `echo(!${WINDOWS_TERMINAL_MODE}!`,
    `echo(Profile: !${DEFAULT_PROFILE}!`,
    `echo(Profile directory: !${WINDOWS_PROFILE_DIRECTORY}!`,
    `echo(Harness home: !${DSH_HOME}!`,
    `echo(Plugin commands without --profile modify the !${DEFAULT_PROFILE}! profile.`,
    'echo(Commands:',
    `echo(  ${escapeBatchText(commandHelp)}`,
    `echo(  ${escapeBatchText(pluginAdd)}`,
    `echo(  ${escapeBatchText(pluginRemove)}`,
    `echo(  ${escapeBatchText(pluginUpdate)}`,
    `echo(${escapeBatchText('Restart DSH Desktop after plugin changes.')}`,
    'endlocal & set "ELECTRON_RUN_AS_NODE="',
    '',
  ].join('\r\n')
}
