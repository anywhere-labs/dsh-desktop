// ═══════════════════════════════════════════════════════════════
// useVsrPreviewPane.ts — 视频去字幕·预览画布与选区交互编排（铁律 10 P7，2026-09-19）
// 自 SubtitleRemoval.vue 脚本整簇纯搬迁（IRON-02 五项 checklist；函数体逐字不变，
//  vm 编排实例改为参数注入）。返回 { ...vm, ...本簇绑定 }，父组件模板零改动。
// 职责：文件选择回填、预览帧抽取、抓帧源视频事件、逐帧 seek、画布坐标映射、
//   四边形拖拽/旋转/顶点调整（几何走 vsrQuadLogic 纯函数）、选区列表辅助、
//   提交/取消/结果状态文案。
// ═══════════════════════════════════════════════════════════════
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import type { SelectOption } from '../components/common/TSelect.vue'
import { useFilePicker } from './useFilePicker'
import { useVsrRemoval, type VsrMode } from './useVsrRemoval'
import { drawQuads } from '../components/media-tools/vsrQuadCanvas'
import {
  type Quad, type VsrPurpose,
  applyRotation, dragVertex, hitTestQuad, moveQuad, rotateHandleIndex, widgetToFrame,
} from './vsrQuadLogic'

export function useVsrPreviewPane(vm: ReturnType<typeof useVsrRemoval>) {
  const {
    mode, purpose, watermarkText, setMode, setPurpose,
    boxes, activeIndex, allowRotation, isSmart, isSelectMode,
    addBox, deleteActiveBox, setActiveIndex, updateActiveQuad, resetBoxes, boxLabel,
    canStart, cancelled, status, progress, errorMsg, resultUrl, resultFullUrl, resultPath, isProcessing, uploadPercent,
    submit, cancel, resetResult, setFrameSize, setFile,
    downloadResult, downloading, openResultDir, autoSaving,
  } = vm

/** 复制结果地址（不点下载也可自行取用；仿 AudioGen BGM 的 URL 展示口径） */
const urlCopied = ref(false)
async function copyResultUrl(): Promise<void> {
  if (!resultFullUrl.value) return
  try {
    await navigator.clipboard.writeText(resultFullUrl.value)
    urlCopied.value = true
    setTimeout(() => { urlCopied.value = false }, 1500)
  } catch (_) { /* 副本失败静默 */ }
}

// ── 模式/用途选项 ──
const modeOptions: SelectOption[] = [
  { label: '标注选区（在预览帧上框选）', value: 'select' },
  { label: '智能识别（服务端自动检测）', value: 'smart' },
]
const purposeOptions: SelectOption[] = [
  { label: '去字幕（轴对齐矩形）', value: 'subtitle' },
  { label: '去水印（可旋转四边形）', value: 'watermark' },
]
function onModeChange(v: string | number) { setMode(v as VsrMode) }
function onPurposeChange(v: string | number) { setPurpose(v as VsrPurpose) }

// ── 文件选择 + 预览帧抽取 ──
const framePath = ref('')
// 2026-09-06 用户要求：界面仅保留「抓帧预览 + 一个拖拽把手」，删除上方可见播放器。
// 隐藏 <video> 仅作为逐帧 seek 的抓帧源（无可见播放控件）。
const previewVideo = ref<HTMLVideoElement | null>(null)
const durationS = ref(0)
const currentT = ref(0)
const fps = ref(0) // 帧率（ffprobe 探测；>0 时把手按帧刻度细分，拖拽对齐到帧）

/** 重置框选预览：探测帧率（把手按帧刻度细分），清空选区与结果，等待预览视频按当前帧抓帧 */
async function extractPreviewFrame(path: string): Promise<void> {
  resetBoxes()
  framePath.value = ''
  currentT.value = 0
  resetResult()
  fps.value = 0
  try {
    const info = await window.tintin.ffmpeg.probe(path)
    fps.value = Number(info?.fps) || 0
    if (info?.duration) durationS.value = info.duration
  } catch (e) {
    fps.value = 0
  }
}

// ── 抓帧源视频事件（loadedmetadata → 时长；loadeddata → 首帧；seeked → 当前帧）──
function onPreviewLoaded(e: Event): void {
  durationS.value = (e.target as HTMLVideoElement).duration || 0
}
function onPreviewLoadedData(e: Event): void {
  void captureFrameFromVideo(e.target as HTMLVideoElement)
}
function onPreviewSeeked(e: Event): void {
  void captureFrameFromVideo(e.target as HTMLVideoElement)
}

/** 把预览视频当前帧绘制为 dataURL 作为框选帧（分辨率 = 视频真实分辨率，框坐标跨帧一致） */
async function captureFrameFromVideo(v: HTMLVideoElement): Promise<void> {
  if (!v || !v.videoWidth || !v.videoHeight) return
  try {
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, c.width, c.height)
    framePath.value = c.toDataURL('image/jpeg', 0.85)
    await nextTick()
    syncCanvas()
  } catch (err) {
    console.warn('[subtitle-removal] 抓取当前帧失败:', err)
  }
}

function seekToTime(t: number): void {
  const v = previewVideo.value
  if (!v || !Number.isFinite(t)) return
  // 按帧量化：把任意时间对齐到最接近的帧（fps>0 时生效），实现逐帧拖拽
  let target = t
  if (fps.value > 0) target = Math.round(t * fps.value) / fps.value
  const clamped = Math.max(0, Math.min(target, durationS.value || 0))
  v.currentTime = clamped
  currentT.value = clamped
}

const { filePath: srcPath, fileName, isDragging, pickFile, onDrop, onDragOver, onDragLeave, resolveSrc } =
  useFilePicker({
    dialogTitle: '选择视频',
    filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }],
    onPicked: (path) => { setFile(path); void extractPreviewFrame(path) },
  })

// ── 画布与坐标映射（帧像素 = 预览图 natural 尺寸）──
const canvasRef = ref<HTMLCanvasElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
let resizeObserver: ResizeObserver | null = null

function displayMapping() {
  const canvas = canvasRef.value
  if (!canvas) return null
  return { w: canvas.width, h: canvas.height, offsetX: 0, offsetY: 0 }
}
function frameSizeNow() {
  const img = imgRef.value
  if (!img || !img.naturalWidth) return null
  return { w: img.naturalWidth, h: img.naturalHeight }
}

function onImgLoad(): void {
  const img = imgRef.value
  if (img) setFrameSize(img.naturalWidth, img.naturalHeight)
  syncCanvas()
  observeResize()
}

function syncCanvas(): void {
  const img = imgRef.value
  const canvas = canvasRef.value
  if (!img || !canvas) return
  canvas.width = img.clientWidth
  canvas.height = img.clientHeight
  redraw()
}

function observeResize(): void {
  const img = imgRef.value
  if (!img || resizeObserver || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => syncCanvas())
  resizeObserver.observe(img)
}
onBeforeUnmount(() => { resizeObserver?.disconnect(); resizeObserver = null })

/** 重绘全部选区（拖拽中绘制实时框） */
function redraw(): void {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  const display = displayMapping()
  const frame = frameSizeNow()
  if (!canvas || !ctx || !display || !frame) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!isSelectMode.value) return
  drawQuads(ctx, {
    boxes: boxes.value,
    activeIndex: activeIndex.value,
    display,
    frame,
    allowRotation: allowRotation.value,
    draggingQuad: draggingQuad.value,
  })
}

watch([boxes, activeIndex, isSelectMode, framePath], redraw, { deep: true })

// ── 拖拽状态（绘制层临时态；提交数据仍以 boxes 为准）──
type DragMode = null | 'move' | 'rotate' | 'scrub' | `vertex-${number}`
const dragMode = ref<DragMode>(null)
let dragStartQuad: Quad | null = null
let dragStartWidget: { x: number; y: number } | null = null
let rotateStartAngle = 0
const draggingQuad = ref<Quad | null>(null)
const hoverHandle = ref('')
// 空白处拖动=拖动视频播放的锚点（2026-10-12 用户裁决：标注层只是透明标注层，
// 与拖动播放无关——空白按下以当前时间+水平位置为锚，水平位移线性映射时间轴）
let scrubAnchorX = 0
let scrubAnchorT = 0

function relPos(e: PointerEvent): { x: number; y: number } {
  const rect = canvasRef.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  if (!framePath.value || isProcessing.value || isSmart.value) return
  const display = displayMapping()
  const frame = frameSizeNow()
  if (!display || !frame) return
  // 指针捕获：拖拽中指针移出画布（甚至窗口边缘）事件仍派发给画布，
  // 选区编辑/拖动播放都不会中断（2026-10-12 用户裁决：拖出画面不断）
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  const { x: mx, y: my } = relPos(e)
  const hit = hitTestQuad({
    mx, my, boxes: boxes.value, activeIndex: activeIndex.value,
    display, frame, allowRotation: allowRotation.value,
  })
  if (!hit) {
    // 空白处按下=进入拖动播放（原版为无动作；2026-10-12 用户裁决改：标注层
    // 只做标注，拖预览区即拖时间轴，选区/把手命中才走标注编辑）
    dragMode.value = 'scrub'
    scrubAnchorX = mx
    scrubAnchorT = currentT.value
    return
  }
  if (hit.index !== activeIndex.value) setActiveIndex(hit.index)
  dragStartQuad = boxes.value[hit.index].map((p) => [p[0], p[1]] as [number, number])
  dragStartWidget = { x: mx, y: my }
  const handle = hit.handle as 'move' | `vertex-${number}`
  dragMode.value = handle
  // 右下角顶点 = 旋转把手：进入整体旋转模式（对照 mousePressEvent L413-424）
  if (handle.startsWith('vertex-')) {
    const vi = Number(handle.split('-')[1])
    if (vi === rotateHandleIndex(dragStartQuad, allowRotation.value)) {
      dragMode.value = 'rotate'
      const cx = dragStartQuad.reduce((s, p) => s + p[0], 0) / 4
      const cy = dragStartQuad.reduce((s, p) => s + p[1], 0) / 4
      const fpt = widgetToFrame(mx, my, display, frame)
      if (fpt) rotateStartAngle = Math.atan2(fpt.y - cy, fpt.x - cx)
    }
  }
}

function onMove(e: PointerEvent): void {
  if (!framePath.value || isProcessing.value || isSmart.value) return
  const display = displayMapping()
  const frame = frameSizeNow()
  if (!display || !frame) return
  const { x: mx, y: my } = relPos(e)

  // 拖拽中：几何计算全部走 vsrQuadLogic 纯函数（对照 mouseMoveEvent L426-498）
  const mode = dragMode.value
  if (mode === 'scrub') {
    // 空白拖动=播放进度：水平位移 ÷ 预览宽 × 总时长（seekToTime 内部做帧量化+钳制）
    seekToTime(scrubAnchorT + ((mx - scrubAnchorX) / Math.max(1, display.w)) * durationS.value)
    return
  }
  if (mode !== null && dragStartQuad && dragStartWidget) {
    const curF = widgetToFrame(mx, my, display, frame)
    const startF = widgetToFrame(dragStartWidget.x, dragStartWidget.y, display, frame)
    if (!curF || !startF) return
    if (mode === 'rotate') {
      const cx = dragStartQuad.reduce((s, p) => s + p[0], 0) / 4
      const cy = dragStartQuad.reduce((s, p) => s + p[1], 0) / 4
      const delta = Math.atan2(curF.y - cy, curF.x - cx) - rotateStartAngle
      draggingQuad.value = applyRotation(dragStartQuad, delta, frame)
    } else if (mode === 'move') {
      draggingQuad.value = moveQuad(dragStartQuad, curF.x - startF.x, curF.y - startF.y, frame)
    } else {
      draggingQuad.value = dragVertex(
        dragStartQuad, Number(mode.split('-')[1]), curF.x, curF.y, frame, allowRotation.value,
      )
    }
    redraw()
    return
  }

  // 悬停光标提示（对照 L500-517）
  const hit = hitTestQuad({
    mx, my, boxes: boxes.value, activeIndex: activeIndex.value,
    display, frame, allowRotation: allowRotation.value,
  })
  hoverHandle.value = hit ? hit.handle : ''
}

/** 指针离开画布：仅悬停态清光标提示；拖拽中因指针捕获不会收到 leave，不会打断 */
function onLeave(): void {
  if (!dragMode.value) hoverHandle.value = ''
}

function onUp(e?: PointerEvent): void {
  if (e?.currentTarget instanceof Element && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
    e.currentTarget.releasePointerCapture(e.pointerId)
  }
  if (draggingQuad.value) updateActiveQuad(draggingQuad.value)
  dragMode.value = null
  dragStartQuad = null
  dragStartWidget = null
  draggingQuad.value = null
  scrubAnchorX = 0
  scrubAnchorT = 0
  redraw()
}

const cursorStyle = computed(() => {
  if (isSmart.value || isProcessing.value) return 'default'
  if (dragMode.value === 'rotate') return 'grabbing'
  if (dragMode.value === 'scrub') return 'ew-resize'
  if (hoverHandle.value === 'move') return 'move'
  if (hoverHandle.value.startsWith('vertex-')) {
    const quad = boxes.value[activeIndex.value]
    if (!quad) return 'crosshair'
    const vi = Number(hoverHandle.value.split('-')[1])
    if (vi === rotateHandleIndex(quad, allowRotation.value)) return 'grab'
    const cx = quad.reduce((s, p) => s + p[0], 0) / 4
    const cy = quad.reduce((s, p) => s + p[1], 0) / 4
    return (quad[vi][0] - cx) * (quad[vi][1] - cy) >= 0 ? 'nwse-resize' : 'nesw-resize'
  }
  return 'ew-resize' // 空白处=可拖动播放（2026-10-12 裁决）
})

// ── 选区列表辅助 ──
function removeBoxAt(i: number): void {
  setActiveIndex(i)
  deleteActiveBox()
}

// ── 提交 / 取消 / 结果 ──
const statusText = computed(() => {
  if (cancelled.value) return vm.CANCELLED_STATUS_TEXT
  switch (status.value) {
    case 'queued':
      return uploadPercent.value < 100 ? `上传中 ${uploadPercent.value}%` : '排队中'
    case 'processing':
      // 服务端已把编码/写盘段映射进 90-100（2026-10-13 对齐）——≥98% 出现在
      // 真实收尾阶段，文案「收尾中」与实际语义一致
      return progress.value >= 98 ? '收尾中——服务端正在编码输出…' : `处理中 ${progress.value}%`
    case 'done':
      return '已完成'
    case 'failed':
      return '失败'
    default:
      return ''
  }
})


  return {
    ...vm,
    // 本簇绑定
    urlCopied, copyResultUrl,
    modeOptions, purposeOptions, onModeChange, onPurposeChange,
    framePath, previewVideo, durationS, currentT, fps, extractPreviewFrame,
    onPreviewLoaded, onPreviewLoadedData, onPreviewSeeked, captureFrameFromVideo, seekToTime,
    srcPath, fileName, isDragging, pickFile, onDrop, onDragOver, onDragLeave, resolveSrc,
    canvasRef, imgRef, onImgLoad, onDown, onMove, onUp, cursorStyle, removeBoxAt, statusText,
  }
}