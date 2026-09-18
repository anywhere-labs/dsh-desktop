/** Localized copy for Windows workspace storage checks and directory selection. */

import type { DesktopLocale } from './runtime.ts'

export interface DesktopWorkspaceAdmissionCopy {
  readonly directoryPickerTitle: string
  readonly removableTitle: string
  readonly removableMessage: string
  readonly removableDetail: (path: string) => string
  readonly useFolder: string
  readonly chooseAnotherFolder: string
  readonly unsupportedTitle: string
  readonly unsupportedMessage: (fileSystem: string | undefined) => string
  readonly unsupportedDetail: (path: string) => string
}

const COPY: Record<DesktopLocale, DesktopWorkspaceAdmissionCopy> = {
  en: {
    directoryPickerTitle: 'Select Workspace Directory',
    removableTitle: 'Removable Workspace',
    removableMessage: 'This workspace is on a removable NTFS/ReFS drive.',
    removableDetail: path => `Disconnecting the drive while DSH Desktop is running can break commands or plugin operations. Keep it connected.\n\n${path}`,
    useFolder: 'Use This Folder',
    chooseAnotherFolder: 'Choose Another Folder',
    unsupportedTitle: 'Unsupported Workspace Storage',
    unsupportedMessage: fileSystem => `${fileSystem ?? 'This filesystem'} cannot safely host a DSH Desktop workspace.`,
    unsupportedDetail: path => `Choose a folder on a local NTFS or ReFS volume. exFAT, FAT32, network drives, and uninspectable volumes are not persisted as workspaces.\n\n${path}`,
  },
  zh: {
    directoryPickerTitle: '选择工作区目录',
    removableTitle: '外接工作区',
    removableMessage: '这个工作区位于可移除的 NTFS/ReFS 磁盘上。',
    removableDetail: path => `使用过程中拔出磁盘会导致命令或插件操作失败。请保持磁盘连接。\n\n${path}`,
    useFolder: '使用此文件夹',
    chooseAnotherFolder: '选择其他文件夹',
    unsupportedTitle: '不支持的工作区存储',
    unsupportedMessage: fileSystem => `${fileSystem ?? '当前文件系统'} 不能安全用作 DSH Desktop 工作区。`,
    unsupportedDetail: path => `请选择本地 NTFS 或 ReFS 磁盘上的文件夹。exFAT、FAT32、网络盘和无法检测的磁盘不会被保存为工作区。\n\n${path}`,
  },
  ru: {
    directoryPickerTitle: 'Выберите папку рабочей области',
    removableTitle: 'Рабочая область на съёмном диске',
    removableMessage: 'Эта рабочая область находится на съёмном диске с файловой системой NTFS или ReFS.',
    removableDetail: path => `Если отключить диск во время работы DSH Desktop, команды и операции с плагинами могут завершиться с ошибкой. Не отключайте диск.\n\n${path}`,
    useFolder: 'Использовать эту папку',
    chooseAnotherFolder: 'Выбрать другую папку',
    unsupportedTitle: 'Неподдерживаемое хранилище рабочей области',
    unsupportedMessage: fileSystem => fileSystem === undefined
      ? 'На этой файловой системе нельзя безопасно хранить рабочую область DSH Desktop.'
      : `На файловой системе «${fileSystem}» нельзя безопасно хранить рабочую область DSH Desktop.`,
    unsupportedDetail: path => `Выберите папку на локальном диске с файловой системой NTFS или ReFS. Диски с exFAT и FAT32, сетевые диски и тома, которые не удалось проверить, нельзя использовать как рабочие области DSH Desktop.\n\n${path}`,
  },
}

export function desktopWorkspaceAdmissionCopy(locale: DesktopLocale): DesktopWorkspaceAdmissionCopy {
  return COPY[locale]
}
