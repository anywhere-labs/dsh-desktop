import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_ATTACHED_ROOTS = 32

interface SourceDocument {
  readonly version: 1
  readonly workspaces: Record<string, string[]>
  readonly selectedRoots: Record<string, string>
}

function fail(message: string): never {
  throw new Error(`dsh-plugin-desktop: ${message}`)
}

function canonicalDirectory(path: string, label: string): string {
  if (typeof path !== 'string' || path.trim().length === 0 || !isAbsolute(path) || /[\0-\x1f\x7f]/u.test(path)) {
    return fail(`${label} must be an absolute directory path`)
  }
  try {
    const canonical = realpathSync.native(path)
    if (!statSync(canonical).isDirectory()) return fail(`${label} is not a directory`)
    return canonical
  } catch (cause) {
    throw new Error(`dsh-plugin-desktop: ${label} is missing or inaccessible`, { cause })
  }
}

function pathKey(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function containsPath(parent: string, child: string): boolean {
  const parentKey = pathKey(parent)
  const childKey = pathKey(child)
  if (parentKey === childKey) return true
  const remainder = relative(parent, child)
  return remainder !== '' && remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder)
}

function overlaps(left: string, right: string): boolean {
  return containsPath(left, right) || containsPath(right, left)
}

function validateDocument(value: unknown): SourceDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('workspace source store is not an object')
  const input = value as Record<string, unknown>
  if (input.version !== 1 || typeof input.workspaces !== 'object' || input.workspaces === null || Array.isArray(input.workspaces)) {
    return fail('workspace source store has an unsupported format')
  }
  const workspaces: Record<string, string[]> = Object.create(null) as Record<string, string[]>
  for (const [workspace, paths] of Object.entries(input.workspaces as Record<string, unknown>)) {
    if (!isAbsolute(workspace) || /[\0-\x1f\x7f]/u.test(workspace) || !Array.isArray(paths)
      || paths.length > MAX_ATTACHED_ROOTS || paths.some(path => typeof path !== 'string' || !isAbsolute(path))) {
      return fail('workspace source store contains invalid paths')
    }
    workspaces[workspace] = [...paths] as string[]
  }
  const selectedRoots: Record<string, string> = Object.create(null) as Record<string, string>
  if (input.selectedRoots !== undefined) {
    if (typeof input.selectedRoots !== 'object' || input.selectedRoots === null || Array.isArray(input.selectedRoots)) {
      return fail('workspace source store contains invalid selected roots')
    }
    for (const [workspace, path] of Object.entries(input.selectedRoots as Record<string, unknown>)) {
      if (!isAbsolute(workspace) || typeof path !== 'string' || !isAbsolute(path)) {
        return fail('workspace source store contains invalid selected roots')
      }
      selectedRoots[workspace] = path
    }
  }
  return { version: 1, workspaces, selectedRoots }
}

/** Persistent Desktop-owned associations between a primary Workspace and independent source roots. */
export class WorkspaceSourceRoots {
  private document: SourceDocument

  constructor(private readonly filename: string) {
    if (existsSync(filename)) {
      try {
        this.document = validateDocument(JSON.parse(readFileSync(filename, 'utf8')) as unknown)
      } catch (cause) {
        throw new Error(`dsh-plugin-desktop: could not read workspace source store ${filename}`, { cause })
      }
    } else {
      this.document = {
        version: 1,
        workspaces: Object.create(null) as Record<string, string[]>,
        selectedRoots: Object.create(null) as Record<string, string>,
      }
    }
  }

  /** Return still-existing attached roots for a canonical primary Workspace path. */
  attachedRoots(workspacePath: string): readonly string[] {
    const primary = canonicalDirectory(workspacePath, 'Workspace path')
    const result: string[] = []
    for (const path of this.document.workspaces[primary] ?? []) {
      let canonical: string
      try {
        canonical = canonicalDirectory(path, 'attached source folder')
      } catch {
        continue
      }
      // Associations are persisted only after canonicalization. If a folder is
      // replaced with a symlink, do not silently transfer its old grant.
      if (pathKey(canonical) !== pathKey(path)) continue
      if (overlaps(primary, canonical) || result.some(existing => overlaps(existing, canonical))) {
        fail('workspace source store contains overlapping roots')
      }
      result.push(canonical)
    }
    return result
  }

  /** Return persisted source paths, including missing directories for repair/removal in the UI. */
  list(workspacePath: string): readonly string[] {
    const primary = canonicalDirectory(workspacePath, 'Workspace path')
    return [...(this.document.workspaces[primary] ?? [])]
  }

  /** Return the selected file-browser root, falling back to the primary Workspace. */
  selectedRoot(workspacePath: string): string {
    const primary = canonicalDirectory(workspacePath, 'Workspace path')
    const selected = this.document.selectedRoots[primary]
    if (selected === undefined || pathKey(selected) === pathKey(primary)) return primary
    try {
      const canonical = canonicalDirectory(selected, 'selected source folder')
      return this.attachedRoots(primary).some(path => pathKey(path) === pathKey(canonical))
        ? canonical
        : primary
    } catch {
      return primary
    }
  }

  /** Resolve a Renderer-selected root only when it is the primary Workspace or a currently authorized attachment. */
  resolveAuthorizedRoot(workspacePath: string, sourcePath: string): string {
    const primary = canonicalDirectory(workspacePath, 'Workspace path')
    const source = canonicalDirectory(sourcePath, 'selected source folder')
    if (pathKey(source) === pathKey(primary)) return primary
    if (!this.attachedRoots(primary).some(path => pathKey(path) === pathKey(source))) {
      fail('selected source folder is not attached to this Workspace')
    }
    return source
  }

  /** Select the file-browser root without changing Session cwd or Workspace identity. */
  select(workspacePath: string, sourcePath: string): string {
     const primary = canonicalDirectory(workspacePath, 'Workspace path')
    const source = canonicalDirectory(sourcePath, 'selected source folder')
    if (pathKey(source) !== pathKey(primary)
      && !this.attachedRoots(primary).some(path => pathKey(path) === pathKey(source))) {
      fail('selected source folder is not attached to this Workspace')
    }
    const selectedRoots = { ...this.document.selectedRoots, [primary]: source }
    this.document = { ...this.document, selectedRoots }
    this.persist()
    return source
  }

  /** Attach and select one independent directory without changing Workspace identity or Session cwd. */
  add(workspacePath: string, sourcePath: string): readonly string[] {
    const primary = canonicalDirectory(workspacePath, 'Workspace path')
    const source = canonicalDirectory(sourcePath, 'source folder')
    if (overlaps(primary, source)) fail('source folder must be separate from the primary Workspace folder')
    const current = this.document.workspaces[primary] ?? []
    const existing = current.some(path => pathKey(path) === pathKey(source))
    if (!existing && current.some(path => overlaps(path, source))) fail('source folders must not overlap')
    if (!existing && current.length >= MAX_ATTACHED_ROOTS) fail(`a Workspace can have at most ${MAX_ATTACHED_ROOTS} attached source folders`)

    const selectedRoots = { ...this.document.selectedRoots, [primary]: source }
    if (existing && pathKey(this.document.selectedRoots[primary] ?? primary) === pathKey(source)) return [...current]
    this.document = {
      ...this.document,
      workspaces: existing
        ? this.document.workspaces
        : { ...this.document.workspaces, [primary]: [...current, source] },
      selectedRoots,
    }
    this.persist()
    return [...this.document.workspaces[primary] ?? []]
  }

  /** Detach a source folder association; never removes or alters the real folder. */
  remove(workspacePath: string, sourcePath: string): readonly string[] {
    const primary = canonicalDirectory(workspacePath, 'Workspace path')
    if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)) fail('source folder path must be absolute')
    const current = this.document.workspaces[primary] ?? []
    const next = current.filter(path => pathKey(path) !== pathKey(sourcePath))
    if (next.length !== current.length) {
      const workspaces = { ...this.document.workspaces }
      if (next.length === 0) delete workspaces[primary]
      else workspaces[primary] = next
      const selectedRoots = { ...this.document.selectedRoots }
      const selected = selectedRoots[primary]
      if (selected !== undefined && !next.some(path => pathKey(path) === pathKey(selected))) {
        delete selectedRoots[primary]
      }
      this.document = { ...this.document, workspaces, selectedRoots }
      this.persist()
    }
    return [...next]
  }

  private persist(): void {
    mkdirSync(dirname(this.filename), { recursive: true, mode: 0o700 })
    const temporary = `${this.filename}.${process.pid}.${Date.now()}.tmp`
    let descriptor: number | undefined
    try {
      descriptor = openSync(temporary, 'wx', 0o600)
      writeFileSync(descriptor, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8')
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporary, this.filename)
    } catch (cause) {
      if (descriptor !== undefined) closeSync(descriptor)
      rmSync(temporary, { force: true })
      throw new Error(`dsh-plugin-desktop: could not persist workspace source associations to ${this.filename}`, { cause })
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopWorkspaceSourceRoots: WorkspaceSourceRoots
  }
}
