// ═══════════════════════════════════════════════════════════════
// useFilePicker — 文件选择 + 拖拽上传 + 本地路径预览（媒体工具共享）
// 职责：openFile 对话框 / drop 拖入 / path→file:// 预览 URL；
//       选中后的组件自定义动作（清结果、抽帧等）走 onPicked 钩子
// 来源：自 media-tools 各工具的 pickFile/setFile/onDrop/resolveSrc
//       四件套重复实现收敛而来（行为不变，IRON-08）
// ═══════════════════════════════════════════════════════════════

import { ref } from 'vue'
import { toFileUrl, filePathOf } from '@/utils/fileUrl'

export interface FileDialogFilter {
  name: string
  extensions: string[]
}

export interface UseFilePickerOptions {
  /** 对话框标题，如「选择图片」 */
  dialogTitle: string
  /** 扩展名过滤 */
  filters?: FileDialogFilter[]
  /** 文件被选中后的钩子（清结果/抽帧等组件自定义动作） */
  onPicked?: (path: string) => void
}

export function useFilePicker(opts: UseFilePickerOptions) {
  const filePath = ref('')   // 本地完整路径
  const fileName = ref('')   // 用于展示的文件名
  const isDragging = ref(false)

  /** 打开选择对话框 */
  async function pickFile(): Promise<void> {
    const res = await window.tintin.dialog.openFile({
      title: opts.dialogTitle,
      filters: opts.filters,
    })
    if (res) setFile(res)
  }

  /** 设置文件并触发选中钩子 */
  function setFile(path: string): void {
    filePath.value = path
    fileName.value = path.split(/[\\/]/).pop() || path
    // 用户显式选择的文件可能在工作区/缓存白名单之外（桌面等），预览走
    // /tintin/media 前先经宿主 media:unlock 单文件登记（fire-and-forget，
    // 2026-09-25 图像抠图卡引入；宿主侧存在性校验 + FIFO 上限）。
    void window.tintin?.media?.unlock?.(path)
    opts.onPicked?.(path)
  }

  /** 清空所选文件 */
  function clearFile(): void {
    filePath.value = ''
    fileName.value = ''
  }

  // ── 拖拽上传 ──
  function onDrop(e: DragEvent): void {
    isDragging.value = false
    const f = e.dataTransfer?.files?.[0]
    // 2026-09-24：Electron 43 移除 File.path，改经桌面 preload webUtils 桥解析
    if (f) {
      const p = filePathOf(f)
      if (p) setFile(p)
    }
  }
  function onDragOver(): void {
    isDragging.value = true
  }
  function onDragLeave(): void {
    isDragging.value = false
  }

  /** 本地路径转可显示 URL（file:/// 三斜杠，2026-09-10 回退 media:// 链路） */
  function resolveSrc(src: string): string {
    return toFileUrl(src)
  }

  return {
    filePath,
    fileName,
    isDragging,
    pickFile,
    setFile,
    clearFile,
    onDrop,
    onDragOver,
    onDragLeave,
    resolveSrc,
  }
}
