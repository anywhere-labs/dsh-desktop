/**
 * The installed program's directory and the folder choices that must stay clear of it (#1564).
 *
 * Updates replace the files in this directory and uninstalling removes it, so a data directory inside it
 * loses its data. On Windows the sandbox gives a workspace's whole folder tree an inheritable Low integrity
 * label; a program that inherits it starts at Low integrity, where Chromium cannot start its GPU process.
 */
import { realpathSync } from 'node:fs'
import { posix, win32 } from 'node:path'

/** How a chosen folder relates to the program directory. */
export type ProgramDirectoryOverlap = 'same' | 'inside' | 'contains'

/** What a folder is chosen for. */
export type ProgramDirectoryPurpose = 'workspace' | 'data'

/** Text of the native message box that refuses a folder choice. */
export interface ProgramDirectoryRefusal {
  readonly title: string
  readonly message: string
  readonly detail: string
  /** Choose again, then cancel. */
  readonly buttons: readonly [string, string]
}

function pathRules(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

/**
 * The directory an update replaces: the application bundle on macOS, the executable's directory elsewhere.
 * @param platform - Node platform.
 * @param executable - `process.execPath`.
 * @returns the program directory.
 */
export function programDirectory(platform: NodeJS.Platform, executable: string): string {
  const path = pathRules(platform)
  const directory = path.dirname(executable)
  const contents = path.dirname(directory)
  const bundle = path.dirname(contents)
  const inBundle = path.basename(directory) === 'MacOS' && path.basename(contents) === 'Contents' && bundle.endsWith('.app')
  return platform === 'darwin' && inBundle ? bundle : directory
}

/** The real path of an existing folder; any other path stays as given. */
function realDirectory(path: string): string {
  try { return realpathSync.native(path) } catch { return path }
}

/**
 * Relate a folder to the program directory as the file system resolves both, ignoring case on Windows.
 * @param choice - absolute folder path.
 * @param program - the program directory.
 * @param platform - Node platform, which decides the path rules.
 * @param real - resolves a folder to its real path; the file system's answer by default.
 * @returns the overlap, or undefined when neither folder contains the other.
 */
export function programDirectoryOverlap(choice: string, program: string, platform: NodeJS.Platform = process.platform,
  real: (path: string) => string = realDirectory): ProgramDirectoryOverlap | undefined {
  const path = pathRules(platform)
  const [chosen, installed] = [real(choice), real(program)]
  const below = (root: string, candidate: string): boolean => {
    const relation = path.relative(root, candidate)
    return relation !== '' && relation !== '..' && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation)
  }
  if (path.relative(installed, chosen) === '') return 'same'
  if (below(installed, chosen)) return 'inside'
  return below(chosen, installed) ? 'contains' : undefined
}

/**
 * The overlap that refuses a folder for a purpose. A workspace may not touch the program directory on
 * Windows, where only the sandbox labels folders; a data directory may not be or lie in it anywhere.
 * @param purpose - what the folder is chosen for.
 * @param choice - absolute folder path.
 * @param program - the program directory.
 * @param platform - Node platform.
 * @param real - resolves a folder to its real path; the file system's answer by default.
 * @returns the refusing overlap, or undefined when the folder is acceptable.
 */
export function refusedProgramDirectoryOverlap(purpose: ProgramDirectoryPurpose, choice: string, program: string,
  platform: NodeJS.Platform = process.platform, real?: (path: string) => string): ProgramDirectoryOverlap | undefined {
  if (purpose === 'workspace' && platform !== 'win32') return undefined
  const overlap = programDirectoryOverlap(choice, program, platform, real)
  return purpose === 'data' && overlap === 'contains' ? undefined : overlap
}

/**
 * Open folder dialogs until a choice is acceptable or the user stops.
 * @param pick - opens one folder dialog; undefined when it was dismissed.
 * @param refused - the overlap that refuses a choice, if any.
 * @param again - explains a refused choice; true opens the dialog again.
 * @returns the accepted folder, or undefined when the user dismissed the dialog or the explanation.
 */
export async function pickOutsideProgramDirectory(pick: () => Promise<string | undefined>,
  refused: (choice: string) => ProgramDirectoryOverlap | undefined,
  again: (overlap: ProgramDirectoryOverlap) => Promise<boolean>): Promise<string | undefined> {
  for (;;) {
    const choice = await pick()
    if (choice === undefined) return undefined
    const overlap = refused(choice)
    if (overlap === undefined) return choice
    if (!await again(overlap)) return undefined
  }
}

/**
 * Explain why a folder that overlaps the program directory cannot serve a purpose.
 * @param purpose - what the folder was chosen for.
 * @param overlap - how it overlaps the program directory.
 * @param program - the program directory.
 * @param language - message language.
 * @returns message box text.
 */
export function programDirectoryRefusal(purpose: ProgramDirectoryPurpose, overlap: ProgramDirectoryOverlap, program: string,
  language: 'zh' | 'en'): ProgramDirectoryRefusal {
  const t = (chinese: string, english: string): string => language === 'zh' ? chinese : english
  const relation = {
    same: t('所选文件夹就是 DSH NEXT 的安装目录。', 'The selected folder is the DSH NEXT installation folder.'),
    inside: t('所选文件夹位于 DSH NEXT 的安装目录中。', 'The selected folder is inside the DSH NEXT installation folder.'),
    contains: t('所选文件夹包含 DSH NEXT 的安装目录。', 'The selected folder contains the DSH NEXT installation folder.'),
  }[overlap]
  const reason = purpose === 'workspace'
    ? t('沙箱给工作区授予写权限时，会给整个目录树加上低完整性（Low）标签。安装目录中的程序带上这个标签后，DSH NEXT 将无法再启动。请选择安装目录以外的文件夹作为工作区。',
      'When the sandbox grants write access to a workspace, it gives the whole folder tree a Low integrity label. Once the program in the installation folder carries that label, DSH NEXT can no longer start. Choose a folder outside the installation folder as the workspace.')
    : t('更新会替换安装目录中的文件，卸载会删除整个安装目录，放在其中的数据会随之丢失。请选择安装目录以外的文件夹作为数据目录。',
      'Updates replace the files in the installation folder and uninstalling removes it, so data kept there would be lost. Choose a folder outside the installation folder as the data directory.')
  return {
    title: 'DSH NEXT',
    message: purpose === 'workspace' ? t('不能用这个文件夹作为工作区', 'This folder cannot be the workspace') : t('不能用这个文件夹作为数据目录', 'This folder cannot be the data directory'),
    detail: [relation, reason, t(`安装目录：${program}`, `Installation folder: ${program}`)].join('\n\n'),
    buttons: [t('重新选择', 'Choose another folder'), t('取消', 'Cancel')],
  }
}
