/** Give GUI launches a UTF-8 locale when neither the launch environment nor the login shell names one, as Terminal.app does for its shells. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Where macOS installs its locale definitions. */
const LOCALE_DIRECTORY = '/usr/share/locale'

/** The variables POSIX programs consult for their character set; any one of them keeps the environment as it is. */
const LOCALE_VARIABLES = ['LC_ALL', 'LC_CTYPE', 'LANG'] as const

/**
 * UTF-8 locale names for the system languages, most preferred first, ending with the English and
 * language-neutral names every macOS installs.
 * @param languages - BCP 47 tags as `app.getPreferredSystemLanguages()` lists them.
 * @returns Candidate names such as `zh_CN.UTF-8`.
 */
export function utf8LocaleCandidates(languages: readonly string[]): string[] {
  const candidates: string[] = []
  for (const tag of languages) {
    const [language, ...rest] = tag.split('-')
    if (language === undefined || !/^[A-Za-z]{2,3}$/u.test(language)) continue
    const region = rest.find(part => /^[A-Za-z]{2}$/u.test(part))
    // Chinese tags may carry a script instead of a region; macOS names those locales by region.
    const script = rest.find(part => /^[A-Za-z]{4}$/u.test(part))
    const resolved = region ?? (language.toLowerCase() === 'zh' ? (script?.toLowerCase() === 'hant' ? 'TW' : 'CN') : undefined)
    if (resolved !== undefined) candidates.push(`${language.toLowerCase()}_${resolved.toUpperCase()}.UTF-8`)
  }
  candidates.push('en_US.UTF-8', 'C.UTF-8')
  return [...new Set(candidates)]
}

/**
 * Set `LANG` to the first installed candidate when the environment names no locale at all.
 *
 * Finder and Dock launches carry no locale variables, and many shell startup files export none
 * because Terminal.app sets `LANG` for the shells it opens. Without one, the Host's terminals and
 * tool subprocesses run in the C locale, where `ls` prints `?` for every non-ASCII file name. The
 * fallback never overrides a value the launch environment or the login shell provided.
 * @param environment - Environment the Host will inherit; `LANG` is set in place.
 * @param platform - Only macOS keeps its locales in one fixed directory and omits `LANG` from GUI launches.
 * @param languages - System languages in preference order.
 * @param installed - Whether a locale name is installed; defaults to the system locale directory.
 * @returns The locale set, or undefined when the environment already had one or none is installed.
 */
export function ensureUtf8Locale(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform, languages: readonly string[],
  installed: (name: string) => boolean = name => existsSync(join(LOCALE_DIRECTORY, name))): string | undefined {
  if (platform !== 'darwin' || LOCALE_VARIABLES.some(name => environment[name])) return undefined
  const locale = utf8LocaleCandidates(languages).find(installed)
  if (locale !== undefined) environment.LANG = locale
  return locale
}
