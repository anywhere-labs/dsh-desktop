// ═══════════════════════════════════════════════════════════════
// vsrQuadLogic — 字幕/水印去除 quad 框选·纯函数逻辑（M4 移植）
// 移植自原客户端 gui/subtitle_removal_page_v14.py：
//   · 几何辅助 _quad_aabb/_rect_to_quad/_quad_to_relative_polygon L38-54
//   · 射线法命中 _point_in_quad L301-312
//   · 拖拽分支（移动/顶点/旋转）InteractivePreviewLabelV14 L402-517
//   · 选区管理 _add_box/_delete_box L1104-1131
//   · sub_areas 契约编组 _start_remote_removal L1294-1309
// 本模块零依赖（无 vue/IPC），绘制与事件转发在组件层；提交/轮询/取消
// 编排在 useVsrRemoval.ts。API-GUIDE 契约：POST /vsr/remove
//   sub_areas = ''（智能）| [[ymin,ymax,xmin,xmax],...]（矩形，相对坐标）
//             | [[[x,y]×4],...]（多边形，相对坐标）
// ═══════════════════════════════════════════════════════════════

/** 四点四边形（帧像素坐标，顺时针：左上→右上→右下→左下） */
export type Quad = Array<[number, number]>
/** 用途：去字幕 / 去水印（对照 _get_purpose L1033-1035） */
export type VsrPurpose = 'subtitle' | 'watermark'

export interface VsrFrameSize { w: number; h: number }
/** 预览显示区映射（widget 像素 ↔ 帧像素），offset 为帧图在容器内的留白 */
export interface VsrDisplayMapping { w: number; h: number; offsetX: number; offsetY: number }

/** 提交异常/取消的提示口径（对齐原客户端文案） */
export const USER_ABORT_MESSAGE = '用户终止运行。'          // worker L178
export const CANCELLED_STATUS_TEXT = '已被用户终止。'        // on_worker_finished L1388
export const SERVER_OFFLINE_MESSAGE = '服务端离线或网络异常，请检查服务端地址与网络连接。'
export const ERR_NO_VIDEO = '请先选择有效的输入视频或图片！'   // start_removal L1255
export const ERR_NO_BOXES = '请先设置至少一个擦除选区！'      // start_removal L1261

// ── 基础几何（对照 _quad_aabb / _rect_to_quad L38-49）─────────────

/** 四点四边形 → 轴对齐外接框 [x, y, w, h]（对照 _quad_aabb） */
export function quadAabb(quad: Quad): [number, number, number, number] {
  const xs = quad.map((p) => p[0])
  const ys = quad.map((p) => p[1])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return [x0, y0, x1 - x0, y1 - y0]
}

/** 矩形 [x,y,w,h] → 顺时针四点四边形（对照 _rect_to_quad） */
export function rectToQuad(x: number, y: number, w: number, h: number): Quad {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
}

/** 四点像素 → 相对坐标四点 [[x_rel,y_rel],...]（服务端 polygon 格式，对照 _quad_to_relative_polygon） */
export function quadToRelativePolygon(quad: Quad, fw: number, fh: number): Array<[number, number]> {
  return quad.map((p) => [round4(p[0] / fw), round4(p[1] / fh)] as [number, number])
}

/** 点是否在四边形内（射线法，对照 _point_in_quad L301-312） */
export function pointInQuad(px: number, py: number, quad: Quad): boolean {
  const n = quad.length
  let inside = false
  let j = n - 1
  for (let i = 0; i < n; i++) {
    const xi = quad[i][0]
    const yi = quad[i][1]
    const xj = quad[j][0]
    const yj = quad[j][1]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside
    }
    j = i
  }
  return inside
}

/** 视觉「右下角」顶点下标（x+y 最大）= 旋转把手；去字幕模式无旋转把手（对照 _rotation_vertex_index L314-332） */
export function rotateHandleIndex(quad: Quad, allowRotation: boolean): number {
  if (!allowRotation || quad.length === 0) return -1
  let best = 0
  let bestSum = quad[0][0] + quad[0][1]
  for (let i = 1; i < quad.length; i++) {
    const s = quad[i][0] + quad[i][1]
    if (s > bestSum) {
      best = i
      bestSum = s
    }
  }
  return best
}

function round4(v: number): number {
  return Number(v.toFixed(4))
}

// ── 坐标转换（对照 _widget_to_frame L293-299）─────────────────────

/** widget 像素 → 帧像素；显示尺寸非法时返回 null */
export function widgetToFrame(
  x: number, y: number, display: VsrDisplayMapping, frame: VsrFrameSize,
): { x: number; y: number } | null {
  if (display.w <= 0 || display.h <= 0 || frame.w <= 0 || frame.h <= 0) return null
  return {
    x: ((x - display.offsetX) * frame.w) / display.w,
    y: ((y - display.offsetY) * frame.h) / display.h,
  }
}

/** 命中测试结果：handle ∈ 'vertex-N'（N=0..3，仅激活框）/ 'edge-N'（激活框第 N 条边，去字幕模式）/ 'move'（任意框内） */
export interface QuadHit { handle: string; index: number }

/** 点到线段的最短距离（widget 像素；边手柄命中用） */
function distanceToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 1e-12) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * 命中测试（对照 get_handle_under_mouse L370-400）：
 * 激活框优先；激活框先检测顶点手柄，再检测所有框内部（射线法）。
 * 2026-10-20 用户报障补齐：去字幕轴对齐模式（!allowRotation）下，激活框的
 * 四条边也是命中目标（'edge-N'，连接顶点 N→N+1）——原实现边/边框附近按下
 * 落入空白分支误触「拖动播放」，选区边框拉不动、时间轴反而动。
 */
export function hitTestQuad(args: {
  mx: number
  my: number
  boxes: Quad[]
  activeIndex: number
  display: VsrDisplayMapping
  frame: VsrFrameSize
  allowRotation: boolean
  /** 手柄命中阈值（widget 像素），原版 10 */
  threshold?: number
}): QuadHit | null {
  const { mx, my, boxes, activeIndex, display, frame, allowRotation } = args
  const threshold = args.threshold ?? 10
  if (frame.w <= 0 || frame.h <= 0 || display.w <= 0 || display.h <= 0 || boxes.length === 0) {
    return null
  }
  const ratioX = display.w / frame.w
  const ratioY = display.h / frame.h

  // 激活框优先（原 L381-384：activeIndex 移到遍历首位）
  const order = boxes.map((_, i) => i)
  if (activeIndex >= 0 && activeIndex < boxes.length) {
    order.splice(activeIndex, 1)
    order.unshift(activeIndex)
  }

  for (const idx of order) {
    const quad = boxes[idx]
    if (idx === activeIndex) {
      for (let vi = 0; vi < quad.length; vi++) {
        const rx = display.offsetX + quad[vi][0] * ratioX
        const ry = display.offsetY + quad[vi][1] * ratioY
        if (Math.abs(mx - rx) < threshold && Math.abs(my - ry) < threshold) {
          return { handle: `vertex-${vi}`, index: idx }
        }
      }
      if (!allowRotation) {
        for (let ei = 0; ei < quad.length; ei++) {
          const p1 = quad[ei]
          const p2 = quad[(ei + 1) % quad.length]
          const hit = distanceToSegment(
            mx, my,
            display.offsetX + p1[0] * ratioX, display.offsetY + p1[1] * ratioY,
            display.offsetX + p2[0] * ratioX, display.offsetY + p2[1] * ratioY,
          ) < threshold
          if (hit) return { handle: `edge-${ei}`, index: idx }
        }
      }
    }
    const fpt = widgetToFrame(mx, my, display, frame)
    if (fpt && pointInQuad(fpt.x, fpt.y, quad)) {
      return { handle: 'move', index: idx }
    }
  }
  return null
}

// ── 拖拽几何（对照 mouseMoveEvent 各分支 L426-497）────────────────

/** 整体平移：clamp 使 AABB 不出帧（对照 move 分支 L474-479，startQuad 为拖动起始四点） */
export function moveQuad(startQuad: Quad, dx: number, dy: number, frame: VsrFrameSize): Quad {
  const [ax, ay, aw, ah] = quadAabb(startQuad)
  const nx = Math.max(-ax, Math.min(dx, frame.w - ax - aw))
  const ny = Math.max(-ay, Math.min(dy, frame.h - ay - ah))
  return startQuad.map((p) => [p[0] + nx, p[1] + ny] as [number, number])
}

/** 拖顶点：去水印自由移动 / 去字幕轴对齐对角缩放（对照 vertex 分支 L480-496） */
export function dragVertex(
  startQuad: Quad, vi: number, fx: number, fy: number,
  frame: VsrFrameSize, allowRotation: boolean,
): Quad {
  const cur: [number, number] = [
    Math.max(0, Math.min(frame.w, fx)),
    Math.max(0, Math.min(frame.h, fy)),
  ]
  if (allowRotation) {
    const next = startQuad.map((p) => [p[0], p[1]] as [number, number])
    next[vi] = cur
    return next
  }
  // 去字幕：轴对齐矩形，拖角点 = 经典矩形缩放（对角固定）
  const opp = startQuad[(vi + 2) % 4]
  const x0 = Math.min(cur[0], opp[0])
  const y0 = Math.min(cur[1], opp[1])
  const x1 = Math.max(cur[0], opp[0])
  const y1 = Math.max(cur[1], opp[1])
  return rectToQuad(x0, y0, x1 - x0, y1 - y0)
}

/** 拖边：去字幕轴对齐矩形，拖第 ei 条边（连接顶点 ei→ei+1）沿法向拉伸，对边固定
 *  （2026-10-20 用户报障补齐；轴对齐判定按两端坐标差，越界钳制到帧内，
 *   与对边交叉时经 rectToQuad 归一化，最小边 2px 防退化，对照 dragVertex 口径） */
export function dragEdge(
  startQuad: Quad, ei: number, fx: number, fy: number, frame: VsrFrameSize,
): Quad {
  const nx0 = Math.max(0, Math.min(frame.w, fx))
  const ny0 = Math.max(0, Math.min(frame.h, fy))
  const a = startQuad[ei]
  const b = startQuad[(ei + 1) % startQuad.length]
  if (!a || !b) return startQuad
  const xs = startQuad.map((p) => p[0])
  const ys = startQuad.map((p) => p[1])
  const vertical = Math.abs(a[0] - b[0]) <= Math.abs(a[1] - b[1]) // 两端 x 相近 = 竖边（左右拉伸）
  if (vertical) {
    const x0 = Math.min(nx0, ...xs)
    const x1 = Math.max(nx0, ...xs)
    if (x1 - x0 < 2) return startQuad
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    return rectToQuad(x0, y0, x1 - x0, y1 - y0)
  }
  const y0 = Math.min(ny0, ...ys)
  const y1 = Math.max(ny0, ...ys)
  if (y1 - y0 < 2) return startQuad
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  return rectToQuad(x0, y0, x1 - x0, y1 - y0)
}

/**
 * 整体旋转：绕起始四点质心旋转 delta（弧度），随后平移使外接框尽量留在画面内
 * （对照 rotate 分支 L433-465：放得下 → 整体贴边；放不下 → 上/左缘贴边）。
 */
export function applyRotation(startQuad: Quad, delta: number, frame: VsrFrameSize): Quad {
  const cx = startQuad.reduce((s, p) => s + p[0], 0) / startQuad.length
  const cy = startQuad.reduce((s, p) => s + p[1], 0) / startQuad.length
  const cosD = Math.cos(delta)
  const sinD = Math.sin(delta)
  const rotated: Quad = startQuad.map((p) => {
    const ox = p[0] - cx
    const oy = p[1] - cy
    return [cx + ox * cosD - oy * sinD, cy + ox * sinD + oy * cosD] as [number, number]
  })
  const [ax, ay, aw, ah] = quadAabb(rotated)
  let tx = 0
  if (aw <= frame.w) {
    if (ax < 0) tx = -ax
    else if (ax + aw > frame.w) tx = frame.w - ax - aw
  } else {
    tx = ax < 0 ? -ax : 0
  }
  let ty = 0
  if (ah <= frame.h) {
    if (ay < 0) ty = -ay
    else if (ay + ah > frame.h) ty = frame.h - ay - ah
  } else {
    ty = ay < 0 ? -ay : 0
  }
  return rotated.map((p) => [p[0] + tx, p[1] + ty] as [number, number])
}

// ── 选区管理（对照 _add_box L1104-1121 / _delete_box L1123-1130）──

/** 新增框默认位：首个=底部字幕区；后续与上一框同宽、上移 40px 避免完全重叠 */
export function defaultNewQuad(prevQuad: Quad | null, frame: VsrFrameSize): Quad {
  if (!prevQuad) {
    const x = Math.round(frame.w * 0.05)
    const y = Math.round(frame.h * 0.78)
    const w = Math.round(frame.w * 0.9)
    const h = Math.round(frame.h * 0.21)
    return rectToQuad(x, y, w, h)
  }
  const [lx, ly, lw, lh] = quadAabb(prevQuad)
  const y = Math.max(0, ly - 40)
  return rectToQuad(lx, y, lw, lh)
}

/** 选区数量约束（对照 _delete_box L1124：≤1 个时禁止删除） */
export function canDeleteBox(count: number): boolean {
  return count > 1
}

/** 用途切换规范化：切到去字幕时把已有四边形规范为轴对齐矩形（对照 _on_purpose_changed L1043-1045） */
export function normalizeQuadsForPurpose(boxes: Quad[], purpose: VsrPurpose): Quad[] {
  if (purpose !== 'subtitle') return boxes.map((q) => q.map((p) => [p[0], p[1]] as [number, number]))
  return boxes.map((q) => {
    const [x, y, w, h] = quadAabb(q)
    return rectToQuad(x, y, w, h)
  })
}

// ── sub_areas 契约编组（核心入参，对照 _start_remote_removal L1294-1309）──

export interface BuildSubAreasOptions {
  isSmart: boolean
  purpose: VsrPurpose
  frame: VsrFrameSize
}

/**
 * 框数据 → sub_areas 契约字符串：
 * - 智能模式 → ''（服务端自动检测）
 * - 去水印 → 可旋转四边形相对坐标 [[[x_rel,y_rel]×4], ...]
 * - 去字幕 → 轴对齐矩形相对坐标 [[ymin,ymax,xmin,xmax], ...]（四边形先取 AABB）
 */
export function buildSubAreas(boxes: Quad[], opts: BuildSubAreasOptions): string {
  if (opts.isSmart) return ''
  const { w: fw, h: fh } = opts.frame
  if (opts.purpose === 'watermark') {
    return JSON.stringify(boxes.map((q) => quadToRelativePolygon(q, fw, fh)))
  }
  const rects = boxes.map((q) => {
    const [x0, y0, w, h] = quadAabb(q)
    return [round4(y0 / fh), round4((y0 + h) / fh), round4(x0 / fw), round4((x0 + w) / fw)]
  })
  return JSON.stringify(rects)
}

/** 去水印→sttn_auto(整框重绘)，去字幕→sttn_det(精准检测)；具体模型服务端匹配（对照 L1291-1292） */
export function buildInpaintMode(purpose: VsrPurpose): string {
  return purpose === 'watermark' ? 'sttn_auto' : 'sttn_det'
}

// ── 提交字段编组 + 参数校验（对照 start_removal L1252-1262）────────

export interface VsrSubmitFields {
  /** 本地视频路径（主进程按 API-GUIDE 契约以 multipart 字段 `file` 读取上传） */
  video: string
  inpaint_mode: string
  sub_areas: string
  purpose: VsrPurpose
  watermark_text: string
}

export type BuildVsrFieldsResult =
  | { ok: true; fields: VsrSubmitFields }
  | { ok: false; error: string }

export interface BuildVsrFieldsInput {
  videoPath: string
  isSmart: boolean
  purpose: VsrPurpose
  watermarkText: string
  boxes: Quad[]
  frame: VsrFrameSize
}

/** 校验并编组 /vsr/remove 提交字段；失败返回原客户端同口径错误文案 */
export function buildVsrFields(input: BuildVsrFieldsInput): BuildVsrFieldsResult {
  if (!input.videoPath) {
    return { ok: false, error: ERR_NO_VIDEO }
  }
  if (!input.isSmart && input.boxes.length === 0) {
    return { ok: false, error: ERR_NO_BOXES }
  }
  return {
    ok: true,
    fields: {
      video: input.videoPath,
      inpaint_mode: buildInpaintMode(input.purpose),
      sub_areas: buildSubAreas(input.boxes, {
        isSmart: input.isSmart,
        purpose: input.purpose,
        frame: input.frame,
      }),
      purpose: input.purpose,
      watermark_text: input.purpose === 'watermark' ? input.watermarkText.trim() : '',
    },
  }
}

// ── 提交错误映射 / 取消（对照 RemoteVSRWorkerV14 异常分支 L159-229）──

/**
 * 提交响应 → 错误（成功响应请勿调用）：
 * - null：主进程判为离线（isExpectedOfflineError）→ 网络失败口径
 * - {error}：主进程已组装（HTTP 状态 + 响应体截断）→ 服务端 5xx/422 口径
 * - 无 task_id：服务端未返回任务 ID（对照 worker L163-166）
 */
export function toSubmitError(res: unknown): Error {
  if (res == null) return new Error(SERVER_OFFLINE_MESSAGE)
  const r = res as { error?: string; task_id?: string }
  if (r.error) return new Error(r.error)
  if (!r.task_id) return new Error(`服务端未返回任务 ID: ${JSON.stringify(res).slice(0, 300)}`)
  return new Error(SERVER_OFFLINE_MESSAGE)
}

/** 是否需要向服务端发取消请求（对照 worker.stop L106：有 task_id 才尽力 DELETE） */
export function shouldCancelServerTask(taskId: string | null | undefined): boolean {
  return !!taskId
}

/**
 * 服务端 output_path → 相对下载 URL（2026-09-07 /vsr/remove 400 后续修复）。
 * 契约：GET /tasks/{id} 的 result 不含 result_url/download_url，仅 result.output_path
 * （服务端本地路径，如 /home/.../output/vsr/xxx.mp4）。
 * 对照原客户端 RemoteVSRWorkerV14（L208-222）：优先 download_url，缺省拼
 * {base_url}/vsr/download/{filename}（vsr 域专用端点，实测 200 video/mp4）；
 * 文件名含中文需编码（Node http path 不接受非 ASCII）。
 */
export function outputPathToUrl(outputPath: string): string {
  const p = String(outputPath || '').replace(/\\/g, '/')
  const name = p.split('/').pop() || ''
  return name ? `/vsr/download/${encodeURIComponent(name)}` : ''
}
