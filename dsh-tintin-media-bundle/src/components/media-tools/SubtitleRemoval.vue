<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// SubtitleRemoval.vue — 视频去水印字幕（M4 quad 框选移植）UI 层
// 交互对齐原客户端 gui/subtitle_removal_page_v14.py（预览帧四点框选：
//   多框/拖拽移动/顶点调整/旋转/删除；用途全局二选一；sub_areas 契约
//   编组在 vsrQuadLogic.ts 纯函数）。
// 铁律 10 P7（2026-09-19）：预览画布/选区交互/提交编排整簇迁入
//   useVsrPreviewPane.ts（vm 参数注入，函数体逐字不变）；本组件保留
//   vm 创建与模板解构，模板与样式零改动。
// ═══════════════════════════════════════════════════════════════
import TButton from '@/components/common/TButton.vue'
import TSelect from '@/components/common/TSelect.vue'
import VsrFrameScrubber from '@/components/media-tools/VsrFrameScrubber.vue'
import { useVsrRemoval } from '@/composables/useVsrRemoval'
import { useVsrPreviewPane } from '@/composables/useVsrPreviewPane'
import { acceptFileDragOver } from '@/utils/fileUrl'

const vm = useVsrRemoval()
const pane = useVsrPreviewPane(vm)
const {
  mode,
  purpose,
  watermarkText,
  setMode,
  setPurpose,
  boxes,
  activeIndex,
  allowRotation,
  isSmart,
  isSelectMode,
  addBox,
  deleteActiveBox,
  setActiveIndex,
  updateActiveQuad, resetBoxes,
  boxLabel,
  canStart,
  cancelled,
  status,
  progress,
  errorMsg,
  resultUrl,
  resultFullUrl,
  resultPath,
  isProcessing,
  uploadPercent,
  submit,
  cancel,
  resetResult,
  setFrameSize,
  setFile,
  downloadResult,
  downloading,
  openResultDir,
  autoSaving,
  urlCopied,
  copyResultUrl,
  modeOptions,
  purposeOptions,
  onModeChange,
  onPurposeChange,
  framePath,
  previewVideo,
  durationS,
  currentT,
  fps,
  extractPreviewFrame,
  onPreviewLoaded,
  onPreviewLoadedData,
  onPreviewSeeked,
  captureFrameFromVideo,
  seekToTime,
  srcPath,
  fileName,
  isDragging,
  pickFile,
  onDrop,
  onDragOver,
  onDragLeave,
  resolveSrc,
  canvasRef,
  imgRef,
  onImgLoad,
  onDown,
  onMove,
  onUp,
  cursorStyle,
  removeBoxAt,
  statusText,
} = pane
</script>

<template>
  <div class="tool-form">
    <!-- 2026-09-07 用户裁决：整体 1:1 左右分栏——左栏全部为预览区（画面居中），
         右栏集中原来的上传/设置/选区/操作/进度/结果 -->
    <div class="vsr-split">
      <!-- 左栏：预览区（视频抓帧 + 框选图层 + 逐帧时间轴，画面在预览区内居中） -->
      <div class="vsr-preview">
        <div class="frame-stage">
          <!-- 隐藏抓帧源（仅逐帧 seek 用，界面不显示；用户要求只保留一个拖拽控制） -->
          <video
            v-if="srcPath"
            ref="previewVideo"
            class="preview-src"
            :src="resolveSrc(srcPath)"
            preload="auto"
            @loadedmetadata="onPreviewLoaded"
            @loadeddata="onPreviewLoadedData"
            @seeked="onPreviewSeeked"
          />
          <div v-if="framePath" class="frame-wrap">
            <img
              ref="imgRef"
              class="frame-img"
              :src="resolveSrc(framePath)"
              alt="帧预览"
              @load="onImgLoad"
            />
            <canvas
              ref="canvasRef"
              class="frame-canvas"
              :style="{ cursor: cursorStyle }"
              @pointerdown="onDown"
              @pointermove="onMove"
              @pointerup="onUp"
              @pointercancel="onUp"
              @pointerleave="onLeave"
            />
          </div>
          <div v-else class="frame-loading">{{ srcPath ? '等待视频就绪；拖动下方把手到目标帧后，可在此帧上框选' : '先在右侧选择视频，此处将显示预览帧' }}</div>
      <!-- 时间轴把手：已迁 VsrFrameScrubber.vue（铁律 10 P6 纯搬迁）；逐帧量化/预览视频 seek 留在本组件 -->
      <VsrFrameScrubber
        :duration-s="durationS"
        :fps="fps"
        :current-t="currentT"
        :disabled="!srcPath"
        @seek="seekToTime"
      />
        </div>
      </div>

      <!-- 右栏：控制区（上传 / 模式用途 / 水印文字 / 选区管理 / 操作 / 进度 / 结果） -->
      <div class="vsr-panel">
        <!-- 视频选择 -->
        <div
          class="dropzone"
          :class="{ 'is-active': isDragging, 'has-file': !!fileName }"
          @click="pickFile"
          @drop.prevent="onDrop"
          @dragover.prevent="acceptFileDragOver($event); onDragOver()"
          @dragleave.prevent="onDragLeave"
        >
          <svg v-if="!fileName" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <div class="dropzone__text">
            <template v-if="!fileName">
              <span class="dropzone__main">点击选择视频或拖拽到此处</span>
              <span class="dropzone__hint">支持 MP4 / MOV / WEBM / MKV / AVI</span>
            </template>
            <template v-else>
              <span class="dropzone__main">{{ fileName }}</span>
              <span class="dropzone__hint">点击重新选择</span>
            </template>
          </div>
        </div>

        <!-- 模式 / 用途 -->
        <div class="options-row">
          <div class="form-field">
            <label class="form-label">去除模式</label>
            <TSelect
              :model-value="mode"
              :options="modeOptions"
              :disabled="isProcessing"
              @update:model-value="onModeChange"
            />
          </div>
          <div class="form-field">
            <label class="form-label">用途（决定服务端 inpaint 策略）</label>
            <TSelect
              :model-value="purpose"
              :options="purposeOptions"
              :disabled="isProcessing"
              @update:model-value="onPurposeChange"
            />
          </div>
        </div>

        <!-- 水印文字（仅去水印显示，对照 watermark_container L1040） -->
        <div v-if="purpose === 'watermark'" class="form-field">
          <label class="form-label">水印文字（可选，辅助服务端精准定位）</label>
          <input
            v-model="watermarkText"
            type="text"
            class="text-input"
            placeholder="如：片头 LOGO 文字，留空则仅按框选区域移除"
            :disabled="isProcessing"
          />
        </div>

        <!-- 选区管理（标注选区模式；2026-09-07 用户裁决：卡片化统一风格） -->
        <div v-if="fileName && isSelectMode" class="regions-card">
          <div class="regions-card__head">
            <span class="regions-card__title">
              选区管理
              <span class="regions-card__count">{{ boxes.length }}</span>
              <span class="regions-card__hint">可拖拽移动 / 拖顶点调整<template v-if="allowRotation"> / 拖右下角把手旋转</template></span>
            </span>
            <span class="regions-card__actions">
              <button class="mini-btn mini-btn--primary" :disabled="isProcessing || !framePath" @click="addBox">＋ 添加选区</button>
              <button
                class="mini-btn mini-btn--danger"
                :disabled="isProcessing || boxes.length <= 1 || activeIndex < 0"
                @click="deleteActiveBox"
              >删除激活</button>
              <button class="mini-btn mini-btn--ghost" :disabled="isProcessing" @click="resetBoxes">清空</button>
            </span>
          </div>
          <div v-if="boxes.length" class="regions-card__list">
            <span
              v-for="(q, i) in boxes"
              :key="i"
              class="region-chip"
              :class="{ 'is-active': i === activeIndex }"
              @click="setActiveIndex(i)"
            >
              <span class="region-chip__idx">{{ i + 1 }}</span>
              <span class="region-chip__coord">{{ boxLabel(q) }}</span>
              <button
                class="region-chip__close"
                :disabled="isProcessing || boxes.length <= 1"
                title="删除该选区"
                @click.stop="removeBoxAt(i)"
              >×</button>
            </span>
          </div>
          <div v-else class="regions-card__empty">暂无选区，点击右上角「添加选区」开始标注</div>
        </div>

        <!-- 操作区 -->
        <div class="action-row">
          <TButton
            label="开始移除"
            icon="play"
            :disabled="!canStart"
            :loading="isProcessing"
            @click="submit"
          />
          <TButton
            v-if="isProcessing"
            label="终止"
            icon="close"
            variant="danger"
            @click="cancel"
          />
          <span v-if="statusText" class="status-badge" :class="`status-${status}`">{{ statusText }}</span>
        </div>

        <!-- 进度条（处理阶段） -->
        <div v-if="isProcessing" class="progress-bar">
          <div class="progress-bar__fill" :style="{ width: progress + '%' }" />
        </div>

        <!-- 错误提示 -->
        <div v-if="errorMsg" class="error-msg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{{ errorMsg }}</span>
        </div>

        <!-- 结果 -->
        <div v-if="status === 'done'" class="result">
          <div class="result__head">
            <span class="result__title">移除完成</span>
            <!-- 自动落盘后 → 打开目录；未落盘（含自动保存失败回退）→ 手动下载 -->
            <TButton v-if="resultPath" label="打开目录" icon="folder" size="small" @click="openResultDir" />
            <TButton v-else :label="downloading || autoSaving ? '保存中…' : '下载视频'" icon="download" size="small" :loading="downloading || autoSaving" @click="downloadResult" />
          </div>
          <video v-if="resultUrl" class="result-video" :src="resultFullUrl" controls />
          <!-- 本地保存位置（自动落盘后展示；仿 AudioGen BGM 结果文案口径） -->
          <p v-if="resultPath" class="result__save" :title="resultPath">已保存：{{ resultPath }}</p>
          <!-- 结果地址（2026-09-07 用户裁决：像 BGM 一样展示文件 URL，不点下载也可自行下载） -->
          <div v-if="resultFullUrl" class="result__url">
            <span class="result__url-text" :title="resultFullUrl">{{ resultFullUrl }}</span>
            <TButton :label="urlCopied ? '已复制' : '复制'" variant="ghost" size="small" @click="copyResultUrl" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

/* 拖拽上传区（2026-09-07 用户裁决：全程序拖拽上传区高度统一 min-height 120px，
   以智能混剪选择素材原高 ≈80px 基准 +1/2） */
.dropzone {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 120px;
  padding: var(--space-5);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-container));
  border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border));
  border-radius: var(--radius-lg);
  color: var(--muted-foreground);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default);
}

.dropzone:hover,
.dropzone.is-active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, var(--surface-container));
}

.dropzone.has-file {
  border-style: solid;
  color: var(--foreground);
}

.dropzone__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dropzone__main {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-medium);
  color: var(--foreground);
}

.dropzone__hint {
  font-size: var(--font-size-caption);
  color: var(--muted-foreground);
}

/* 模式/用途行 */
.options-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-label {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  color: var(--foreground-muted);
}

.text-input {
  width: 100%;
  height: var(--size-input-height);
  padding: 0 var(--space-3);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--foreground);
  font-size: var(--font-size-body);
  outline: none;
  transition: border-color var(--duration-fast) var(--easing-default),
    box-shadow var(--duration-fast) var(--easing-default);
}

.text-input::placeholder {
  color: var(--muted-foreground);
}

.text-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--ring);
}

.text-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 预览 + 控制：左右两栏（2026-09-07 用户裁决：左栏全部为预览区，右栏集中控制，1:1 均分） */
.vsr-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-4);
  /* 2026-09-07 用户裁决：预览区定高 800px（不再随右栏拉伸）——
     视频加载后整体可见，时间轴不用滚动即可拖拽 */
  align-items: start;
}

.vsr-preview {
  min-width: 0;
  min-height: 0;
  /* 2026-09-07 用户裁决：自适应上限——默认 800px；窗口不够高时收缩到可视区，
     保证视频 + 时间轴不用滚动即可完整拖拽（
     顶部固定占用 ≈ title-bar 36 + app-header 64 + 页面 padding 48 + 工具栏 66 ≈ 214px，留 6px 余量） */
  --vsr-h: min(800px, calc(100vh - 220px));
  height: var(--vsr-h);
  display: flex;
  flex-direction: column;
}

.vsr-panel {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 隐藏抓帧源视频（须参与渲染否则 drawImage 取帧会空白：不可 display:none，用移出视口方式） */
.preview-src {
  position: fixed;
  left: -9999px;
  top: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* 帧预览与框选画布 */
.frame-stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* 2026-09-07 用户裁决：帧 + 时间轴整组在预览区内垂直居中；
     帧本身由 .frame-wrap 的 align-self 水平居中 */
  justify-content: center;
  background: var(--surface-container);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-3);
}

.frame-loading {
  padding: var(--space-8);
  text-align: center;
  font-size: var(--font-size-caption);
  color: var(--muted-foreground);
}

.frame-wrap {
  position: relative;
  /* 画面尺寸规则（2026-09-07 用户裁决）：等比缩放，横屏不超预览区宽度、
     竖屏不超预览区高度，边距由 .frame-stage 的 padding 提供 */
  max-width: 100%;
  align-self: center;
  line-height: 0;
}

.frame-img {
  /* 竖屏时高度上限 = 预览区定高 − 时间轴与内边距（约 96px），宽度随等比自动收 */
  max-width: 100%;
  max-height: calc(var(--vsr-h) - 96px);
  border-radius: var(--radius-md);
  display: block;
}

.frame-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 指针拖拽（选区编辑/空白拖动播放）不触发触摸滚动；配合 pointer capture 拖出画面不断 */
  touch-action: none;
}

/* 选区管理卡片（2026-09-07 用户裁决：与整体卡片风格统一） */
.regions-card {
  padding: var(--space-3) var(--space-4);
  background: var(--card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.regions-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-bottom: var(--space-2);
}

.regions-card__title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
  color: var(--foreground);
}

.regions-card__count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--primary);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.regions-card__hint {
  font-weight: var(--font-weight-regular);
  color: var(--muted-foreground);
}

.regions-card__actions {
  display: inline-flex;
  gap: var(--space-2);
}

.regions-card__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border-subtle);
}

.regions-card__empty {
  padding: var(--space-3) 0 var(--space-2);
  font-size: var(--font-size-caption);
  color: var(--muted-foreground);
  text-align: center;
}

/* 区块内小按钮（添加/删除/清空统一形态） */
.mini-btn {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: var(--font-weight-medium);
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-container);
  color: var(--foreground);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default),
    color var(--duration-fast) var(--easing-default);
}

.mini-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mini-btn--primary {
  border-color: color-mix(in srgb, var(--primary) 40%, transparent);
  background: color-mix(in srgb, var(--primary) 10%, var(--surface-container));
  color: var(--primary);
}

.mini-btn--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--primary) 18%, var(--surface-container));
}

.mini-btn--danger {
  color: var(--error);
}

.mini-btn--danger:hover:not(:disabled) {
  border-color: var(--error);
  color: var(--error);
  background: color-mix(in srgb, var(--error) 8%, var(--surface-container));
}

.mini-btn--ghost {
  background: transparent;
  color: var(--muted-foreground);
}

.mini-btn--ghost:hover:not(:disabled) {
  color: var(--foreground);
  border-color: var(--foreground-muted);
}

.region-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 3px 6px 3px 4px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-caption);
  color: var(--foreground);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default),
    box-shadow var(--duration-fast) var(--easing-default);
}

.region-chip:hover {
  border-color: color-mix(in srgb, var(--primary) 50%, var(--border));
}

.region-chip.is-active {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-container));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 16%, transparent);
}

.region-chip__idx {
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--surface-container-high);
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.region-chip.is-active .region-chip__idx {
  background: var(--primary);
  color: var(--primary-foreground);
}

.region-chip__coord {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.region-chip__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--muted-foreground);
  border-radius: var(--radius-full);
  font-size: 14px;
  line-height: 1;
  transition: color var(--duration-fast) var(--easing-default),
    background var(--duration-fast) var(--easing-default);
}

.region-chip__close:hover:not(:disabled) {
  color: var(--error);
  background: color-mix(in srgb, var(--error) 12%, transparent);
}

.region-chip__close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 操作区 */
.action-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.status-badge {
  margin-left: auto;
  padding: 2px var(--space-3);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  border-radius: var(--radius-full);
  background: var(--surface-container-high);
  color: var(--foreground-muted);
}

.status-badge.status-processing {
  color: var(--info);
  background: rgba(59, 130, 246, 0.15);
}

.status-badge.status-done {
  color: var(--success);
  background: rgba(16, 185, 129, 0.15);
}

.status-badge.status-failed {
  color: var(--error);
  background: rgba(239, 68, 68, 0.15);
}

/* 进度条 */
.progress-bar {
  height: 6px;
  background: var(--surface-container);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.progress-bar__fill {
  height: 100%;
  background: var(--primary);
  border-radius: var(--radius-full);
  transition: width var(--duration-slow) var(--easing-default);
}

/* 错误提示 */
.error-msg {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-md);
  color: var(--error);
  font-size: var(--font-size-caption);
}

/* 结果区 */
.result {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface-container);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.result__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.result__title {
  font-size: var(--font-size-lead);
  font-weight: var(--font-weight-semibold);
  color: var(--foreground);
}

.result__save {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  font-size: var(--font-size-caption);
  color: var(--foreground-muted);
}

.result__url {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.result__url-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;             /* 长路径尾部省略，保留文件名可读 */
  text-align: left;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--foreground-muted);
}

.result-video {
  width: 100%;
  max-height: 360px;
  border-radius: var(--radius-md);
  background: #000;
}
</style>