import { realpathSync, statSync } from 'node:fs'
import { posix } from 'node:path'

const BWRAP_BASE_ARGS = [
  '--ro-bind', '/', '/',
  '--dev', '/dev',
  '--unshare-pid',
  '--proc', '/proc',
  '--die-with-parent',
] as const
const SEATBELT_BASE_FORMS = [
  '(version 1)',
  '(allow default)',
  '(deny file-write*)',
  '(allow file-write* (literal "/dev/null"))',
] as const

function reject(reason: string): never {
  throw new Error(`workspace source sandbox: ${reason}`)
}

function canonicalRoot(path: string, label: string): string {
  if (typeof path !== 'string' || path.trim().length === 0 || !posix.isAbsolute(path)) {
    return reject(`${label} must be an absolute POSIX directory path`)
  }
  if (/[\0-\x1f\x7f]/u.test(path)) return reject(`${label} contains a control character`)

  let canonical: string
  try {
    canonical = realpathSync.native(path)
    if (!statSync(canonical).isDirectory()) return reject(`${label} is not a directory`)
  } catch {
    return reject(`${label} is not an accessible existing directory`)
  }
  if (canonical === '/') return reject(`${label} cannot be the filesystem root`)
  return canonical
}

function runnerKind(argv: readonly string[], platform: NodeJS.Platform): 'bwrap' | 'landlock' | 'seatbelt' {
  if (platform === 'win32') return reject('Windows is unsupported')
  if (platform !== 'linux' && platform !== 'darwin') return reject(`unsupported platform ${platform}`)

  const executable = argv[0]
  if (platform === 'linux' && executable === 'bwrap') return 'bwrap'
  if (platform === 'linux'
    && executable !== undefined
    && posix.isAbsolute(executable)
    && posix.basename(executable) === 'landlock-run') return 'landlock'
  if (platform === 'darwin' && executable === 'sandbox-exec') return 'seatbelt'
  return reject(`unsupported ${platform} runner command ${JSON.stringify(executable)}`)
}

function separatorIndex(argv: readonly string[]): number {
  const index = argv.indexOf('--', 1)
  if (index < 2) return reject('confined argv is missing its runner/profile separator')
  return index
}

function pathContains(parent: string, child: string): boolean {
  const remainder = posix.relative(parent, child)
  return remainder === '' || (remainder !== '..' && !remainder.startsWith('../') && !posix.isAbsolute(remainder))
}

function canonicalAttachedRoots(primaryRoot: string, attachedRoots: readonly string[]): string[] {
  if (!Array.isArray(attachedRoots)) return reject('attached roots must be an array')

  const seen = new Set([primaryRoot])
  const result: string[] = []
  for (const [index, path] of attachedRoots.entries()) {
    const canonical = canonicalRoot(path, `attached root ${index}`)
    if (seen.has(canonical)) continue
    if (pathContains(primaryRoot, canonical) || pathContains(canonical, primaryRoot)
      || result.some(existing => pathContains(existing, canonical) || pathContains(canonical, existing))) {
      return reject(`attached root ${index} overlaps another Workspace root`)
    }
    seen.add(canonical)
    result.push(canonical)
  }
  return result
}

function bwrapRootsToAdd(
  profileArgs: readonly string[],
  primaryRoot: string,
): { roots: Set<string>; additions: string[] } {
  if (profileArgs.length < BWRAP_BASE_ARGS.length + 5
    || !BWRAP_BASE_ARGS.every((arg, index) => profileArgs[index] === arg)) {
    return reject('bwrap profile does not match the supported confined policy')
  }

  let index = BWRAP_BASE_ARGS.length
  if (profileArgs[index] !== '--tmpfs' || profileArgs[index + 1] !== '/tmp') {
    return reject('bwrap profile is missing its private /tmp mount')
  }
  index += 2

  const roots = new Set<string>()
  while (index < profileArgs.length) {
    const [flag, source, target] = profileArgs.slice(index, index + 3)
    if (flag !== '--bind' || source === undefined || source !== target) {
      return reject('bwrap profile contains an unsupported mount argument')
    }
    const canonical = canonicalRoot(source, 'existing bwrap bind root')
    if (source !== canonical) return reject('bwrap bind roots must already be canonical')
    roots.add(canonical)
    index += 3
  }
  if (!roots.has(primaryRoot)) return reject('bwrap policy does not grant the primary root')
  return { roots, additions: [] }
}

function landlockRootsToAdd(
  profileArgs: readonly string[],
  primaryRoot: string,
): { roots: Set<string>; additions: string[] } {
  const expectedPrefix = ['--ro', '/', '--rw', '/dev/null', '--rw', '/tmp', '--rw', primaryRoot]
  if (profileArgs.length < expectedPrefix.length
    || !expectedPrefix.every((arg, index) => profileArgs[index] === arg)) {
    return reject('Landlock profile does not match the supported confined policy')
  }

  const roots = new Set([primaryRoot, '/tmp'])
  let index = expectedPrefix.length
  while (index < profileArgs.length) {
    const [flag, path] = profileArgs.slice(index, index + 2)
    if (flag !== '--rw' || path === undefined) {
      return reject('Landlock profile contains an unsupported grant argument')
    }
    if (path !== '/dev/null') {
      const canonical = canonicalRoot(path, 'existing Landlock write root')
      if (path !== canonical) return reject('Landlock write roots must already be canonical')
      roots.add(canonical)
    }
    index += 2
  }
  return { roots, additions: [] }
}

function quoteSbpl(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

function splitSbplForms(profile: string): string[] {
  const forms: string[] = []
  let index = 0

  while (index < profile.length) {
    if (profile[index] !== '(') return reject('Seatbelt profile has an unsupported form')
    const start = index
    let depth = 0
    let inString = false
    let escaped = false

    for (; index < profile.length; index += 1) {
      const character = profile[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') inString = true
      else if (character === '(') depth += 1
      else if (character === ')') {
        depth -= 1
        if (depth === 0) {
          index += 1
          forms.push(profile.slice(start, index))
          break
        }
        if (depth < 0) return reject('Seatbelt profile has unbalanced parentheses')
      }
    }
    if (depth !== 0 || inString) return reject('Seatbelt profile has an unterminated form')
    if (index < profile.length) {
      if (profile[index] !== ' ') return reject('Seatbelt forms must use the supported single-space separator')
      index += 1
      if (index === profile.length) return reject('Seatbelt profile has trailing whitespace')
    }
  }

  if (forms.join(' ') !== profile) return reject('Seatbelt profile is not in the supported canonical form')
  return forms
}

function seatbeltSubpathRoots(form: string): string[] | undefined {
  const prefix = '(allow file-write* '
  if (!form.startsWith(prefix) || !form.endsWith(')')) return undefined

  const end = form.length - 1
  const roots: string[] = []
  let index = prefix.length
  while (index < end) {
    const subpathPrefix = '(subpath "'
    if (!form.startsWith(subpathPrefix, index)) return undefined
    index += subpathPrefix.length

    let path = ''
    let closedString = false
    while (index < end) {
      const character = form[index]
      index += 1
      if (character === '"') {
        closedString = true
        break
      }
      if (character === '\\') {
        const escaped = form[index]
        index += 1
        if (escaped !== '\\' && escaped !== '"') return undefined
        path += escaped
      } else {
        path += character
      }
    }
    if (!closedString || form[index] !== ')') return undefined
    index += 1
    roots.push(path)

    if (index < end) {
      if (form[index] !== ' ') return undefined
      index += 1
    }
  }
  return roots.length > 0 ? roots : undefined
}

function seatbeltRootsToAdd(profile: string, primaryRoot: string): Set<string> {
  const forms = splitSbplForms(profile)
  if (!SEATBELT_BASE_FORMS.every((form, index) => forms[index] === form)) {
    return reject('Seatbelt profile does not match the supported confined policy')
  }

  const roots = new Set<string>()
  for (const form of forms.slice(SEATBELT_BASE_FORMS.length)) {
    const parsedRoots = seatbeltSubpathRoots(form)
    if (parsedRoots === undefined) return reject('Seatbelt profile contains an unsupported write rule')
    for (const path of parsedRoots) {
      const canonical = canonicalRoot(path, 'existing Seatbelt write root')
      if (path !== canonical) return reject('Seatbelt write roots must already be canonical')
      roots.add(canonical)
    }
  }
  if (!roots.has(primaryRoot)) return reject('Seatbelt policy does not grant the primary root')
  return roots
}

/**
 * Extend an upstream-confined workspace-write argv with explicitly attached
 * source roots. Only the shipped bwrap, Landlock, and Seatbelt dialects are
 * accepted; unsupported platforms, commands, and policy shapes fail closed.
 *
 * @param confinedArgv - argv returned by the sandbox provider, including its `--` separator.
 * @param platform - host platform associated with that confined argv.
 * @param primaryRoot - the canonical workspace-write root already granted by the policy.
 * @param attachedRoots - additional existing directories to grant for this invocation.
 * @returns a fresh argv with any missing attached-root grants inserted before `--`.
 */
export function extendWorkspaceSourceSandbox(
  confinedArgv: readonly string[],
  platform: NodeJS.Platform,
  primaryRoot: string,
  attachedRoots: readonly string[],
): string[] {
  if (!Array.isArray(confinedArgv) || confinedArgv.length === 0
    || confinedArgv.some(argument => typeof argument !== 'string')) {
    return reject('confined argv must be a non-empty string array')
  }

  const runner = runnerKind(confinedArgv, platform)
  const separator = separatorIndex(confinedArgv)
  const canonicalPrimary = canonicalRoot(primaryRoot, 'primary root')
  const rootsToGrant = canonicalAttachedRoots(canonicalPrimary, attachedRoots)
  const profileArgs = confinedArgv.slice(1, separator)
  const additions: string[] = []

  if (runner === 'bwrap') {
    const { roots } = bwrapRootsToAdd(profileArgs, canonicalPrimary)
    for (const root of rootsToGrant) {
      if (root === '/tmp') return reject('the host /tmp cannot replace bwrap’s private /tmp mount')
      if (roots.has(root)) continue
      additions.push('--bind', root, root)
      roots.add(root)
    }
  } else if (runner === 'landlock') {
    const { roots } = landlockRootsToAdd(profileArgs, canonicalPrimary)
    for (const root of rootsToGrant) {
      if (roots.has(root)) continue
      additions.push('--rw', root)
      roots.add(root)
    }
  } else {
    const profile = profileArgs[1]
    if (profileArgs.length !== 2 || profileArgs[0] !== '-p' || profile === undefined) {
      return reject('Seatbelt argv must use the supported -p profile form')
    }
    const roots = seatbeltRootsToAdd(profile, canonicalPrimary)
    const newRoots = rootsToGrant.filter(root => !roots.has(root))
    if (newRoots.length > 0) {
      const grant = `(allow file-write* ${newRoots.map(root => `(subpath ${quoteSbpl(root)})`).join(' ')})`
      const updatedProfile = `${profile} ${grant}`
      return [
        ...confinedArgv.slice(0, separator - 1),
        updatedProfile,
        ...additions,
        ...confinedArgv.slice(separator),
      ]
    }
  }

  return [
    ...confinedArgv.slice(0, separator),
    ...additions,
    ...confinedArgv.slice(separator),
  ]
}
