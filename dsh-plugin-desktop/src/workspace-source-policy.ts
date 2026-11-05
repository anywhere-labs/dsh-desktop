import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { WorkspaceFileScope, WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import type { SandboxExecutionPolicy, SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { WorkspaceSourceRoots } from './workspace-source-roots.ts'
import { extendWorkspaceSourceSandbox } from './workspace-source-sandbox.ts'

function pathIsInside(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate)
  return remainder === '' || (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder))
}

function remapAbsolutePath(path: string, primaryRoot: string, selectedRoot: string): string {
  if (!isAbsolute(path) || resolve(primaryRoot) === resolve(selectedRoot)) return path
  const primary = resolve(primaryRoot)
  const candidate = resolve(path)
  if (!pathIsInside(primary, candidate)) return path
  return join(resolve(selectedRoot), relative(primary, candidate))
}

type SandboxOperations = Pick<SandboxProvider, 'confine'>
type FilesystemOperations = Pick<FileSystem, 'resolve' | 'contains' | 'writeText' | 'editText'>
type WorkspaceFileOperations = Pick<WorkspaceFiles, 'read' | 'readBytes' | 'stat' | 'list' | 'changes'>

/** Install Desktop source-root extensions around the existing enforcing providers. */
export function installWorkspaceSourcePolicy(
  sandbox: SandboxOperations,
  fs: FilesystemOperations,
  workspaceFiles: WorkspaceFileOperations,
  resolvePolicy: () => SandboxExecutionPolicy,
  sourceRoots: WorkspaceSourceRoots,
  platform: NodeJS.Platform = process.platform,
): () => void {
  const sandboxDescriptor = Object.getOwnPropertyDescriptor(sandbox, 'confine')
  const originalConfine = sandbox.confine.bind(sandbox)
  const confineReplacement: SandboxProvider['confine'] = async (argv, policy, signal) => {
    const result = await originalConfine(argv, policy, signal)
    if (policy.mode !== 'workspace-write') return result
    const attached = sourceRoots.attachedRoots(policy.workspaceRoot)
    if (platform === 'win32' || attached.length === 0) return result
    return {
      ...result,
      argv: extendWorkspaceSourceSandbox(result.argv, platform, policy.workspaceRoot, attached),
    }
  }
  Object.defineProperty(sandbox, 'confine', {
    configurable: true,
    writable: true,
    value: confineReplacement,
  })

  const fsWriteDescriptor = Object.getOwnPropertyDescriptor(fs, 'writeText')
  const fsEditDescriptor = Object.getOwnPropertyDescriptor(fs, 'editText')
  const originalWrite = fs.writeText.bind(fs)
  const originalEdit = fs.editText.bind(fs)
  const policyFor = (policy: Parameters<FileSystem['writeText']>[4]): SandboxExecutionPolicy => policy ?? resolvePolicy()
  const workspaceRootForTarget = async (
    targetPath: string,
    policy: SandboxExecutionPolicy,
  ): Promise<string | undefined> => {
    if (policy.mode !== 'workspace-write') return undefined
    const attached = sourceRoots.attachedRoots(policy.workspaceRoot)
    if (attached.length === 0 || platform === 'win32') return undefined
    const target = await fs.resolve(targetPath)
    for (const rootPath of attached) {
      const root = await fs.resolve(rootPath)
      if (fs.contains(root, target)) return rootPath
    }
    return undefined
  }

  const writeReplacement: FileSystem['writeText'] = async (target, content, expected, signal, policy) => {
    const effective = policyFor(policy)
    const sourceRoot = await workspaceRootForTarget(target.displayPath, effective)
    return originalWrite(target, content, expected, signal,
      sourceRoot === undefined ? policy : { ...effective, workspaceRoot: sourceRoot })
  }
  const editReplacement: FileSystem['editText'] = async (target, edit, expected, signal, policy) => {
    const effective = policyFor(policy)
    const sourceRoot = await workspaceRootForTarget(target.displayPath, effective)
    return originalEdit(target, edit, expected, signal,
      sourceRoot === undefined ? policy : { ...effective, workspaceRoot: sourceRoot })
  }
  Object.defineProperty(fs, 'writeText', { configurable: true, writable: true, value: writeReplacement })
  Object.defineProperty(fs, 'editText', { configurable: true, writable: true, value: editReplacement })

  const workspaceFileDescriptors = {
    read: Object.getOwnPropertyDescriptor(workspaceFiles, 'read'),
    readBytes: Object.getOwnPropertyDescriptor(workspaceFiles, 'readBytes'),
    stat: Object.getOwnPropertyDescriptor(workspaceFiles, 'stat'),
    list: Object.getOwnPropertyDescriptor(workspaceFiles, 'list'),
    changes: Object.getOwnPropertyDescriptor(workspaceFiles, 'changes'),
  }
  const originalRead = workspaceFiles.read.bind(workspaceFiles)
  const originalReadBytes = workspaceFiles.readBytes.bind(workspaceFiles)
  const originalStat = workspaceFiles.stat.bind(workspaceFiles)
  const originalList = workspaceFiles.list.bind(workspaceFiles)
  const originalChanges = workspaceFiles.changes.bind(workspaceFiles)
  const selectedRootFor = (primaryRoot: string): string =>
    platform === 'win32' ? primaryRoot : sourceRoots.selectedRoot(primaryRoot)
  const selectedScope = (scope: WorkspaceFileScope): WorkspaceFileScope => ({
    ...scope,
    workspaceRoot: selectedRootFor(scope.workspaceRoot),
  })
  const mapPath = (scope: WorkspaceFileScope, path: string): string =>
    remapAbsolutePath(path, scope.workspaceRoot, selectedRootFor(scope.workspaceRoot))

  const readReplacement: WorkspaceFiles['read'] = (scope, path, range, signal) =>
    originalRead(selectedScope(scope), mapPath(scope, path), range, signal)
  const readBytesReplacement: WorkspaceFiles['readBytes'] = (scope, path, options, signal) => {
    const mappedOptions = options.baseFile === undefined
      ? options
      : { ...options, baseFile: mapPath(scope, options.baseFile) }
    return originalReadBytes(selectedScope(scope), mapPath(scope, path), mappedOptions, signal)
  }
  const statReplacement: WorkspaceFiles['stat'] = (scope, path, signal) =>
    originalStat(selectedScope(scope), mapPath(scope, path), signal)
  const listReplacement: WorkspaceFiles['list'] = (scope, path, signal) =>
    originalList(selectedScope(scope), mapPath(scope, path), signal)
  const changesReplacement: WorkspaceFiles['changes'] = (scope, path, signal) =>
    originalChanges(selectedScope(scope), mapPath(scope, path), signal)

  Object.defineProperties(workspaceFiles, {
    read: { configurable: true, writable: true, value: readReplacement },
    readBytes: { configurable: true, writable: true, value: readBytesReplacement },
    stat: { configurable: true, writable: true, value: statReplacement },
    list: { configurable: true, writable: true, value: listReplacement },
    changes: { configurable: true, writable: true, value: changesReplacement },
  })

  return () => {
    if (sandbox.confine === confineReplacement) restore(sandbox, 'confine', sandboxDescriptor)
    if (fs.writeText === writeReplacement) restore(fs, 'writeText', fsWriteDescriptor)
    if (fs.editText === editReplacement) restore(fs, 'editText', fsEditDescriptor)
    if (workspaceFiles.read === readReplacement) restore(workspaceFiles, 'read', workspaceFileDescriptors.read)
    if (workspaceFiles.readBytes === readBytesReplacement) restore(workspaceFiles, 'readBytes', workspaceFileDescriptors.readBytes)
    if (workspaceFiles.stat === statReplacement) restore(workspaceFiles, 'stat', workspaceFileDescriptors.stat)
    if (workspaceFiles.list === listReplacement) restore(workspaceFiles, 'list', workspaceFileDescriptors.list)
    if (workspaceFiles.changes === changesReplacement) restore(workspaceFiles, 'changes', workspaceFileDescriptors.changes)
  }
}

function restore(target: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) delete (target as Record<string, unknown>)[key]
  else Object.defineProperty(target, key, descriptor)
}
