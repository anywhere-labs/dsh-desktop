import { describe, expect, it, vi } from 'vitest'
import {
  ElectronWorkspaceAdmission,
  type ElectronWorkspaceAdmissionOptions,
} from '../src/workspace-admission.ts'

function admission(overrides: Partial<ElectronWorkspaceAdmissionOptions> = {}) {
  const options: ElectronWorkspaceAdmissionOptions = {
    platform: 'win32',
    canPickDirectory: true,
    locale: () => 'en',
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
    logError: vi.fn(),
    volumeQuery: () => ({ root: 'C:\\', fileSystem: 'NTFS', driveType: 3 }),
    ...overrides,
  }
  return { options, admission: new ElectronWorkspaceAdmission(options) }
}

describe('Electron workspace admission', () => {
  it('coalesces concurrent native selections and releases the task after completion', async () => {
    let finish: ((value: { canceled: false; filePaths: string[] }) => void) | undefined
    const showOpenDialog = vi.fn<ElectronWorkspaceAdmissionOptions['showOpenDialog']>(() => new Promise((resolve) => {
      finish = resolve
    }))
    const { admission: subject } = admission({ showOpenDialog })

    const first = subject.pickDirectory()
    const second = subject.pickDirectory()
    expect(showOpenDialog).toHaveBeenCalledOnce()
    finish?.({ canceled: false, filePaths: ['C:\\Work'] })

    await expect(Promise.all([first, second])).resolves.toEqual(['C:\\Work', 'C:\\Work'])
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(subject.pickDirectory()).resolves.toBeNull()
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })

  it('rejects native selection on a platform without the capability', async () => {
    const showOpenDialog = vi.fn()
    const { admission: subject } = admission({
      platform: 'linux',
      canPickDirectory: false,
      showOpenDialog,
    })

    await expect(subject.pickDirectory()).rejects.toThrow('native workspace picker is unavailable on linux')
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it('allows a fixed NTFS workspace without prompting or logging', async () => {
    const { admission: subject, options } = admission()

    await expect(subject.validateDirectory('C:\\repo')).resolves.toBe(true)
    expect(options.showMessageBox).not.toHaveBeenCalled()
    expect(options.logError).not.toHaveBeenCalled()
  })

  it('blocks unsupported storage and records the decision', async () => {
    const { admission: subject, options } = admission({
      volumeQuery: () => ({ root: 'E:\\', fileSystem: 'EXFAT', driveType: 2 }),
    })

    await expect(subject.validateDirectory('E:\\repo')).resolves.toBe(false)
    expect(options.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('EXFAT'),
    }))
    expect(options.logError).toHaveBeenLastCalledWith(
      'dsh-plugin-desktop: workspace volume decision=blocked path=E:\\repo',
    )
  })

  it.each([
    [1, false, 'cancelled'],
    [0, true, 'confirmed'],
  ] as const)('requires an explicit decision for removable NTFS (response %s)', async (response, allowed, decision) => {
    const { admission: subject, options } = admission({
      showMessageBox: vi.fn(async () => ({ response, checkboxChecked: false })),
      volumeQuery: () => ({ root: 'E:\\', fileSystem: 'NTFS', driveType: 2 }),
    })

    await expect(subject.validateDirectory('E:\\repo')).resolves.toBe(allowed)
    expect(options.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      defaultId: 1,
      cancelId: 1,
    }))
    expect(options.logError).toHaveBeenLastCalledWith(
      `dsh-plugin-desktop: workspace volume decision=${decision} path=E:\\repo`,
    )
  })

  it('admits an existing folder named by a launch without prompting', async () => {
    const { admission: subject, options } = admission({
      inspectPath: () => ({ directory: true }),
    })

    await expect(subject.admitWorkspacePath('C:\\repo')).resolves.toBe(true)
    expect(options.showMessageBox).not.toHaveBeenCalled()
    expect(options.logError).not.toHaveBeenCalled()
  })

  it('reports a launch folder that is not there, without consulting storage policy', async () => {
    const volumeQuery = vi.fn(() => ({ root: 'C:\\', fileSystem: 'NTFS', driveType: 3 }))
    const { admission: subject, options } = admission({
      inspectPath: () => undefined,
      volumeQuery,
    })

    await expect(subject.admitWorkspacePath('C:\\gone')).resolves.toBe(false)
    expect(volumeQuery).not.toHaveBeenCalled()
    expect(options.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      title: 'Cannot Open Workspace',
      message: 'This folder could not be found.',
      detail: expect.stringContaining('C:\\gone'),
      noLink: true,
    }))
    expect(options.logError).toHaveBeenCalledWith(
      'dsh-plugin-desktop: launch workspace path is missing: C:\\gone',
    )
  })

  it('refuses a launch path that names a file rather than a folder', async () => {
    const { admission: subject, options } = admission({
      inspectPath: () => ({ directory: false }),
    })

    await expect(subject.admitWorkspacePath('C:\\repo\\readme.md')).resolves.toBe(false)
    expect(options.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Only a folder can be registered as a workspace.',
    }))
  })

  it('renders the launch failure in the active locale', async () => {
    const { admission: subject, options } = admission({
      locale: () => 'zh',
      inspectPath: () => undefined,
    })

    await expect(subject.admitWorkspacePath('C:\\gone')).resolves.toBe(false)
    expect(options.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: '无法打开工作区',
      message: '找不到这个文件夹。',
    }))
  })

  it('refuses a relative launch path silently', async () => {
    const inspectPath = vi.fn()
    const { admission: subject, options } = admission({ inspectPath })

    await expect(subject.admitWorkspacePath('work\\repo')).resolves.toBe(false)
    expect(inspectPath).not.toHaveBeenCalled()
    expect(options.showMessageBox).not.toHaveBeenCalled()
    expect(options.logError).toHaveBeenCalledWith(
      'dsh-plugin-desktop: launch workspace path is not absolute: work\\repo',
    )
  })

  it('still applies storage policy to an existing launch folder', async () => {
    const { admission: subject, options } = admission({
      inspectPath: () => ({ directory: true }),
      volumeQuery: () => ({ root: 'E:\\', fileSystem: 'EXFAT', driveType: 2 }),
    })

    await expect(subject.admitWorkspacePath('E:\\repo')).resolves.toBe(false)
    expect(options.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('EXFAT'),
    }))
  })

  it('judges absoluteness with the semantics of the running platform', async () => {
    const { admission: subject, options } = admission({
      platform: 'linux',
      canPickDirectory: false,
      inspectPath: () => ({ directory: true }),
    })

    await expect(subject.admitWorkspacePath('/home/anna/work')).resolves.toBe(true)
    expect(options.showMessageBox).not.toHaveBeenCalled()
  })

  it('fails closed when the selected volume disappears during inspection', async () => {
    const { admission: subject, options } = admission({
      volumeQuery: () => { throw new Error('drive disconnected') },
    })

    await expect(subject.validateDirectory('E:\\repo')).resolves.toBe(false)
    expect(options.logError).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('drive disconnected'),
    )
  })

  it('asks the picker for several folders and admits each one', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['C:\\repo', 'C:\\docs', 'C:\\fixtures'],
    }))
    const { admission: subject } = admission({ showOpenDialog })

    await expect(subject.pickDirectories()).resolves.toEqual(['C:\\repo', 'C:\\docs', 'C:\\fixtures'])
    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent'],
    }))
  })

  it('keeps the single-folder picker free of multiSelections', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['C:\\repo', 'C:\\docs'] }))
    const { admission: subject } = admission({ showOpenDialog })

    await expect(subject.pickDirectory()).resolves.toBe('C:\\repo')
    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ['openDirectory', 'dontAddToRecent'],
    }))
  })

  it('drops a refused folder instead of failing the whole multi-selection', async () => {
    const showOpenDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ['C:\\repo', 'E:\\exfat-repo', 'C:\\docs'],
    }))
    const { admission: subject, options } = admission({
      showOpenDialog,
      volumeQuery: path => path.startsWith('E:\\')
        ? { root: 'E:\\', fileSystem: 'EXFAT', driveType: 2 }
        : { root: 'C:\\', fileSystem: 'NTFS', driveType: 3 },
    })

    await expect(subject.pickDirectories()).resolves.toEqual(['C:\\repo', 'C:\\docs'])
    expect(options.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('EXFAT'),
    }))
  })

  it('reports a cancelled multi-selection as no folders', async () => {
    const { admission: subject } = admission()

    await expect(subject.pickDirectories()).resolves.toEqual([])
  })

  it('coalesces concurrent multi-selections without reusing the single-folder task', async () => {
    const finishes: ((value: { canceled: false; filePaths: string[] }) => void)[] = []
    const showOpenDialog = vi.fn<ElectronWorkspaceAdmissionOptions['showOpenDialog']>(() => new Promise((resolve) => {
      finishes.push(resolve)
    }))
    const { admission: subject } = admission({ showOpenDialog })

    const single = subject.pickDirectory()
    const first = subject.pickDirectories()
    const second = subject.pickDirectories()
    // Three dialogs: one for the single-folder request and one for the
    // multi-folder pair. The two shapes never share an in-flight task.
    expect(showOpenDialog).toHaveBeenCalledTimes(2)

    finishes[0]?.({ canceled: false, filePaths: ['C:\\Single'] })
    finishes[1]?.({ canceled: false, filePaths: ['C:\\Many', 'D:\\More'] })

    await expect(Promise.all([single, first, second]))
      .resolves.toEqual(['C:\\Single', ['C:\\Many', 'D:\\More'], ['C:\\Many', 'D:\\More']])
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })

  it('releases the multi-selection task after completion', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['C:\\repo'] }))
    const { admission: subject } = admission({ showOpenDialog })

    await subject.pickDirectories()
    await subject.pickDirectories()
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })

  it('rejects the multi-selection picker on a platform without the capability', async () => {
    const showOpenDialog = vi.fn()
    const { admission: subject } = admission({
      platform: 'linux',
      canPickDirectory: false,
      showOpenDialog,
    })

    await expect(subject.pickDirectories()).rejects.toThrow('native workspace picker is unavailable on linux')
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})
