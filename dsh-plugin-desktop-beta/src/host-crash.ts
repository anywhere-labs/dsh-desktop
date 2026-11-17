/**
 * Upstream's fail-loud report in a Host's stderr, and the packages a stack runs through. When an unhandled
 * rejection or an uncaught exception reaches the DSH runtime's guard, it prints one block,
 * `<bin>: fatal load failure|uncaught exception: <util.inspect(error)>`, disposes the profile for at most two
 * seconds and exits with 1. Plugin teardown output can follow the block, so the block ends where the inspected
 * error ends: at the first line that is neither indented nor a closing bracket.
 */

/** The first line of the fail-loud report, such as `dsh: fatal load failure: Error: …`. */
export const FAIL_LOUD_LINE = /^[^\s:]+: fatal (load failure|uncaught exception): .*$/mu

/** Longest fail-loud block a Host crash carries, including the notice that it was cut. */
export const MAX_HOST_CRASH_CHARS = 32 * 1024

/** Most distinct packages named from one stack. */
const MAX_STACK_PACKAGES = 8

/** The fail-loud block a Host printed before it exited, with the packages its stack runs through. */
export interface HostCrash {
  /** Which process event reached the guard; upstream labels every unhandled rejection a load failure. */
  readonly label: 'load failure' | 'uncaught exception'
  /** The block from its first line. */
  readonly text: string
  /** Distinct packages in the stack frames, innermost first, as `name@version` where the path names the version. */
  readonly packages: readonly string[]
}

/** Lines `util.inspect` continues an error with: stack frames, properties, causes and their closing brackets. */
const CONTINUATION = /^(?:\s|[}\]])/u
/** The package a `node_modules` path segment names; `.pnpm` and other dot directories are skipped. */
const MODULE_PATH = /node_modules[\\/](@[^\\/\s:()]+[\\/][^\\/\s:()]+|[^@.\\/\s:()][^\\/\s:()]*)/gu
/** pnpm's store directory, which encodes the package and its version (`@scope+name@1.2.3_peers`). */
const PNPM_DIRECTORY = /[\\/]\.pnpm[\\/](@?[^\\/\s:()]+)/u

/**
 * Find the fail-loud block in the stderr a Host left behind.
 * @param stderr - The Host's retained stderr.
 * @returns The block with its packages, or `undefined` when the Host printed none.
 */
export function hostCrash(stderr: string): HostCrash | undefined {
  const match = FAIL_LOUD_LINE.exec(stderr)
  if (match === null) return undefined
  const lines = stderr.slice(match.index).split(/\r?\n/u)
  let end = 1
  while (end < lines.length && lines[end] !== '' && CONTINUATION.test(lines[end]!)) end++
  const block = lines.slice(0, end).join('\n')
  const notice = `\n… (Host fatal error cut at ${String(MAX_HOST_CRASH_CHARS)} characters)`
  const text = block.length <= MAX_HOST_CRASH_CHARS ? block
    : block.slice(0, MAX_HOST_CRASH_CHARS - notice.length).replace(/[\uD800-\uDBFF]$/u, '') + notice
  return { label: match[1] as HostCrash['label'], text, packages: stackPackages(block) }
}

/**
 * Name the packages a stack runs through, from the `node_modules` paths of its frames.
 * @param text - Text holding stack frames, such as an inspected error.
 * @returns Distinct packages, innermost first, as `name@version` where a pnpm store path names the version.
 */
export function stackPackages(text: string): string[] {
  const packages: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    if (!/^\s*at\s/u.test(line)) continue
    let name: string | undefined
    // The last segment is the innermost package: a dependency's own node_modules follows its parent's.
    for (const found of line.matchAll(MODULE_PATH)) name = found[1]
    if (name === undefined) continue
    name = name.replace('\\', '/')
    const version = pnpmVersion(line, name)
    const label = version === undefined ? name : `${name}@${version}`
    if (!packages.includes(label)) packages.push(label)
    if (packages.length === MAX_STACK_PACKAGES) break
  }
  return packages
}

/**
 * The first package that DeepSeek Harness does not publish, which is where a third-party plugin shows up.
 * @param packages - Packages from {@link stackPackages}, innermost first.
 * @returns The first one outside the `@deepseek-ai` scope, or `undefined`.
 */
export function outsidePackage(packages: readonly string[]): string | undefined {
  return packages.find(name => !name.startsWith('@deepseek-ai/'))
}

function pnpmVersion(line: string, name: string): string | undefined {
  const directory = PNPM_DIRECTORY.exec(line)?.[1]
  const encoded = `${name.replace('/', '+')}@`
  if (directory === undefined || !directory.startsWith(encoded)) return undefined
  return /^[^_(]+/u.exec(directory.slice(encoded.length))?.[0]
}
