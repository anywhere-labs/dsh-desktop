/** The macOS terminal's generated files: the dsh, pnpm and node shims, the zsh and bash startup files and the welcome command. */

import { PNPM_DISABLE_UPDATE_NOTIFIER, PNPM_IGNORE_MINIMUM_RELEASE_AGE } from '../pnpm-policy.ts'
import { ELECTRON_HEADERS_URL } from '../bundled-pnpm.ts'
import { DEFAULT_PROFILE, type DesktopTerminalOptions, DSH_HOME, RUN_AS_NODE, terminalModeLabel } from './contract.ts'

/** Quote one arbitrary value as a POSIX shell word. */
function quoteSh(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/** Build a command shim that enables Electron's Node mode only for its child. */
export function macShim(appExecutable: string, binPath?: string): string {
  const entry = binPath === undefined ? '' : ` ${quoteSh(binPath)}`
  return [
    '#!/bin/sh',
    `${RUN_AS_NODE}=1 exec ${quoteSh(appExecutable)}${entry} "$@"`,
    '',
  ].join('\n')
}

/** Build the DSH shim with Loader internals and one process-local default profile. */
export function macDshShim(options: DesktopTerminalOptions): string {
  return [
    '#!/bin/sh',
    [
      `${DEFAULT_PROFILE}=${quoteSh(options.profileName)}`,
      `${RUN_AS_NODE}=1`,
      `exec ${quoteSh(options.appExecutable)} --expose-internals ${quoteSh(options.dshBootstrapPath)} "$@"`,
    ].join(' '),
    '',
  ].join('\n')
}

/** Build a pnpm shim with Electron native-module settings scoped to its process tree. */
export function macPnpmShim(options: DesktopTerminalOptions): string {
  return [
    '#!/bin/sh',
    [
      `${RUN_AS_NODE}=1`,
      'npm_config_runtime=electron',
      `npm_config_target=${quoteSh(options.electronVersion)}`,
      `npm_config_disturl=${quoteSh(ELECTRON_HEADERS_URL)}`,
      `exec ${quoteSh(options.appExecutable)} ${quoteSh(options.pnpmBinPath)} ${PNPM_DISABLE_UPDATE_NOTIFIER} ${PNPM_IGNORE_MINIMUM_RELEASE_AGE} "$@"`,
    ].join(' '),
    '',
  ].join('\n')
}

/** Build a zsh startup file that preserves the user's rc and then restores desktop variables. */
export function macZshRc(options: DesktopTerminalOptions, shimDir: string): string {
  return [
    'if [[ -n "${DSH_DESKTOP_USER_ZDOTDIR:-}" && -r "${DSH_DESKTOP_USER_ZDOTDIR}/.zshrc" ]]; then',
    '  ZDOTDIR="${DSH_DESKTOP_USER_ZDOTDIR}"',
    '  source "${DSH_DESKTOP_USER_ZDOTDIR}/.zshrc"',
    'fi',
    `unset ${RUN_AS_NODE}`,
    `export ${DSH_HOME}=${quoteSh(options.homeDir)}`,
    'typeset -U path',
    `path=(${quoteSh(shimDir)} $path)`,
    'export PATH',
    `unset DSH_DESKTOP_USER_ZDOTDIR`,
    '',
  ].join('\n')
}

/** Build a bash startup file that preserves the user's rc and then restores desktop variables. */
export function macBashRc(options: DesktopTerminalOptions, shimDir: string): string {
  return [
    'if [ -n "${DSH_DESKTOP_USER_BASHRC:-}" ] && [ -r "${DSH_DESKTOP_USER_BASHRC}" ]; then',
    '  . "${DSH_DESKTOP_USER_BASHRC}"',
    'fi',
    `unset ${RUN_AS_NODE}`,
    `export ${DSH_HOME}=${quoteSh(options.homeDir)}`,
    'case ":${PATH:-}:" in',
    `  *:${quoteSh(shimDir)}:*) ;;`,
    `  *) export PATH=${quoteSh(shimDir)}:"\${PATH:-}" ;;`,
    'esac',
    'unset DSH_DESKTOP_USER_BASHRC',
    '',
  ].join('\n')
}

/** Build the macOS script opened by LaunchServices in the user's terminal. */
export function macWelcome(
  options: DesktopTerminalOptions,
  shimDir: string,
  bashRcPath: string,
): string {
  const commandHelp = 'dsh --dump-config'
  const pluginAdd = 'dsh plugin add <third-party-plugin>'
  const pluginRemove = 'dsh plugin remove <third-party-plugin>'
  const pluginUpdate = 'dsh plugin update'
  return [
    '#!/bin/sh',
    `unset ${RUN_AS_NODE}`,
    `export ${DSH_HOME}=${quoteSh(options.homeDir)}`,
    `export PATH=${quoteSh(shimDir)}:"\${PATH:-}"`,
    `cd ${quoteSh(options.profileDir)}`,
    "printf '\\033[2J\\033[3J\\033[H'",
    `printf '%s\\n' ${quoteSh(`DSH Desktop ${options.productVersion} terminal`)}`,
    `printf '%s\\n' ${quoteSh(terminalModeLabel(options.mode))}`,
    `printf '%s\\n' ${quoteSh(`Profile: ${options.profileName}`)}`,
    `printf '%s\\n' ${quoteSh(`Profile directory: ${options.profileDir}`)}`,
    `printf '%s\\n' ${quoteSh(`Harness home: ${options.homeDir}`)}`,
    `printf '%s\\n' ${quoteSh(`Plugin commands without --profile modify the ${options.profileName} profile.`)}`,
    `printf '%s\\n' ${quoteSh('Commands:')}`,
    `printf '  %s\\n' ${quoteSh(commandHelp)}`,
    `printf '  %s\\n' ${quoteSh(pluginAdd)}`,
    `printf '  %s\\n' ${quoteSh(pluginRemove)}`,
    `printf '  %s\\n' ${quoteSh(pluginUpdate)}`,
    `printf '%s\\n' ${quoteSh('Restart DSH Desktop after plugin changes.')}`,
    'case "${SHELL:-/bin/zsh}" in',
    '  */bash)',
    '    export DSH_DESKTOP_USER_BASHRC="${HOME:-}/.bashrc"',
    `    exec "\${SHELL}" --noprofile --rcfile ${quoteSh(bashRcPath)} -i`,
    '    ;;',
    '  */zsh)',
    '    export DSH_DESKTOP_USER_ZDOTDIR="${ZDOTDIR:-${HOME:-}}"',
    `    export ZDOTDIR=${quoteSh(options.stateDir)}`,
    '    exec "${SHELL}" -i',
    '    ;;',
    '  *)',
    '    export DSH_DESKTOP_USER_ZDOTDIR="${ZDOTDIR:-${HOME:-}}"',
    `    export ZDOTDIR=${quoteSh(options.stateDir)}`,
    '    exec /bin/zsh -i',
    '    ;;',
    'esac',
    '',
  ].join('\n')
}
