<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// VoiceClone.vue — 声音克隆（重新设计：样本下拉 + 底部上传）
// 布局：TTS引擎 → 样本选择(下拉) → 参考文本 → 待克隆文案 → 整体克隆
//       底部：上传新样本（音频+名称+文字 → 服务端 → 自动刷新下拉）
// 2026-09-29 用户裁决：删除「一键拆分填充」按钮与逐行文案表——整体克隆
// （服务端拆句拼接）已覆盖主路径，逐行模式无消费。
// ═══════════════════════════════════════════════════════════════
import { ref, computed, onMounted, watch } from 'vue'
import TButton from '@/components/common/TButton.vue'
import TSelect from '@/components/common/TSelect.vue'
import { useFilePicker } from '@/composables/useFilePicker'
import { useVoiceCloneStudio } from '@/composables/useVoiceCloneStudio'
import { acceptFileDragOver } from '@/utils/fileUrl'
import { clientError, clientInfo } from '@/utils/clientLog'
// whisper 响应多形态解析（2026-10-12 实障修复：服务端回 ct=text/plain 时响应经
// IPC 结构化克隆到渲染层是 Uint8Array，旧兜底 JSON.stringify(res) 把音频字节数组
// 序列化成 {"0":229,...} 塞进文稿框并随样本上传入库——识别统一走此解析器）
import { parseTranscriptionResponse, segmentsToPlainText } from '@/composables/srtUtils'

const s = useVoiceCloneStudio()

/** 本地通知（与 useVoiceCloneStudio 内同款；此前组件内未定义导致调用即 ReferenceError，2026-09-06 修复） */
function notify(title: string, body: string): void {
  try { window.tintin?.shell?.showNotification?.(title, body) } catch (_) {}
}
const {
  refText, transcribing, voiceOptions, samples, voice, selectedSampleId, ttsEngine, wholeEngine,
  ttsDurationFactor, ttsEmoText, ttsEmoAlpha,
  // Qwen3-TTS 专属（2026-09-20 用户裁决）
  qwen3Speaker, qwen3Instruct, qwen3Voices, qwen3VoicesLoading,
  wholeText, stageText,
  wholeTask, wholeProgress, uploadingSample,
  // 整体克隆：解包视图 + 合成进度 + 另存为（wholeTask 内嵌 ref 模板不解包，禁直接 wholeTask.xxx 判断）
  wholeStatus, wholeIsProcessing, wholeErrorMsg, wholeResultUrl, wholeResultPath,
  wholeSynthProgress, saveWholeAudioAs, uploadingToLib, uploadWholeToLibrary,
  refReady,
  samplePreviewUrl, samplePreviewLoading, loadSamplePreview,
  loadCatalog, selectSample, uploadNewSample, transcribeRefAudio,
  generateWhole,
} = s

/** 情感预设选项（IndexTTS emo_text 常用值） */
const EMO_OPTIONS = [
  { label: '开心', value: '开心' },
  { label: '悲伤', value: '悲伤' },
  { label: '激动', value: '激动' },
  { label: '温柔', value: '温柔' },
  { label: '愤怒', value: '愤怒' },
  { label: '恐惧', value: '恐惧' },
  { label: '惊讶', value: '惊讶' },
  { label: '厌恶', value: '厌恶' },
  { label: '平静', value: '平静' },
]

const isDragging = ref(false)

// ─ 样本试听：音频元素 + 样本切换/建�?URL 后自动播放 ──
const sampleAudioEl = ref<HTMLAudioElement | null>(null)

/** 媒体元素错误码 → 可读文案（HTMLMediaElement.error.code） */
const MEDIA_ERR_TEXT: Record<number, string> = {
  1: '加载被中止', 2: '网络错误', 3: '音频解码失败', 4: '格式或数据源不支持',
}

/** <audio> 加载/解码错误：此前无 handler 完全静默，用户看到的就是"点击没反应"（2026-09-06 铁律补探针）
 *  守卫：v-show 常挂载后 URL 为空时 src 为空也会触发 error，不能误报 */
function onSampleAudioError(e: Event): void {
  if (!samplePreviewUrl.value) return
  const el = e.target as HTMLAudioElement
  const code = el?.error?.code ?? 0
  const text = MEDIA_ERR_TEXT[code] || `未知媒体错误(code=${code})`
  clientError('voice-clone', `试听音频元素错误：${text}（blob 长度 ${samplePreviewUrl.value?.length ?? 0} 字符）`, el?.error)
  notify('提示', `试听失败：${text}`)
}

/** 播放结束留痕：保留播放条（用户可点播放条重播），不再清 URL（2026-09-07） */
function onSampleAudioEnded(): void {
  clientInfo('voice-clone', '试听：播放结束')
}

/** 载体探针：媒体元数据加载成功（时长可得） */
function onSampleAudioMeta(): void {
  const el = sampleAudioEl.value
  clientInfo('voice-clone', `试听：媒体元数据已加载，duration=${el?.duration}`)
}

// 载体看门狗：src 就绪 2.5s 后报告元素真实加载状态——定位“播放条 0:00/0:00 但零错误”（2026-09-07）
watch(samplePreviewUrl, (u) => {
  if (!u) return
  window.setTimeout(() => {
    const el = sampleAudioEl.value
    if (!el) return
    clientInfo('voice-clone', `播放条载体状态：readyState=${el.readyState} networkState=${el.networkState} duration=${el.duration} err=${el.error?.code ?? '无'} src=${el.currentSrc.slice(0, 48)}`)
  }, 2500)
})

// ─ 底部上传新样本 ──
const newSampleFilePath = ref('')
const newSampleFileName = ref('')
const newSampleName = ref('')
const newSampleText = ref('')
const newSampleError = ref('')
const newSampleSuccess = ref('')

const {
  filePath: uploadFilePath,
  fileName: uploadFileName,
  pickFile: pickUploadFile,
  onDrop,
  onDragOver,
  onDragLeave,
  resolveSrc,
} = useFilePicker({
  dialogTitle: '选择音频文件上传为样本',
  filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg'] }],
  onPicked: (p) => {
    newSampleFilePath.value = p
    newSampleFileName.value = p.split('\\').pop()?.split('/').pop() || ''
    // 自动用文件名作为样本名称（去掉扩展名）
    const base = newSampleFileName.value.replace(/\.[^.]+$/, '')
    if (base && !newSampleName.value) newSampleName.value = base
  },
})

function onDropForward(e: DragEvent): void {
  onDrop(e)
  isDragging.value = false
}

async function onUploadNewSample(): Promise<void> {
  newSampleError.value = ''
  newSampleSuccess.value = ''
  if (!newSampleFilePath.value) { newSampleError.value = '请先选择音频文件'; return }
  if (!newSampleName.value.trim()) { newSampleError.value = '请输入样本名称'; return }
  const result = await uploadNewSample(newSampleFilePath.value, newSampleName.value, newSampleText.value)
  if (result.ok) {
    newSampleSuccess.value = `样本「${newSampleName.value}」上传成功，已自动选中`
    newSampleFilePath.value = ''
    newSampleFileName.value = ''
    newSampleName.value = ''
    newSampleText.value = ''
  } else {
    newSampleError.value = result.error || '上传失败'
  }
}

/** 上传样本时 ASR 识别音频文字 */
async function transcribeForNewSample(): Promise<void> {
  if (!newSampleFilePath.value) return
  transcribing.value = true
  newSampleError.value = ''
  try {
    const res = await window.tintin.server.asrTranscribe({
      audio: { path: newSampleFilePath.value } as unknown as Blob,
      language: 'zh',
      format: 'txt',
    } as any)
    if (!res || (res as any).error) throw new Error((res as any)?.error || '识别失败')
    // 契约 /whisper/transcribe：fmt=json 返回 {segments,text,language}，fmt=txt 回纯文本
    // （ct=text/plain → 渲染层收到 Uint8Array）；解析器统一兼容三形态，禁止再 JSON.stringify 字节
    const segments = parseTranscriptionResponse(res)
    const text = segmentsToPlainText(segments)
    if (!text) throw new Error('未从音频中识别到文字（音频可能为空或无语音）')
    newSampleText.value = text
  } catch (err) {
    newSampleError.value = `文字识别失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    transcribing.value = false
  }
}

/** 克隆成功徽标的引擎名（2026-10-12 修复：此前写死 IndexTTS，切 VoxCPM2/Qwen3 后显示错档） */
const wholeEngineLabel = computed(() =>
  wholeEngine.value === 'qwen3' ? 'Qwen3-TTS' : wholeEngine.value === 'voxcpm' ? 'VoxCPM2' : 'IndexTTS')

/** 克隆成功后显示的文件名 */
const wholeFileName = computed(() => {
  const p = wholeResultPath.value
  if (!p) return ''
  return p.includes('\\') ? p.split('\\').pop()! : p.split('/').pop()!
})

onMounted(loadCatalog)
</script>

<template>
  <div class="tool-form">

    <!-- ① 声音样本（下拉选择） -->
    <div class="form-field">
      <label class="form-label">声音样本</label>
      <div class="sample-row">
        <TSelect
          :model-value="selectedSampleId"
          :options="samples.map((s) => ({ label: s.name, value: s.id }))"
          placeholder="选择声音样本"
          @update:model-value="(v: string | number) => selectSample(String(v))"
        />
      </div>
      <!-- 选中样本即自动加载（2026-09-07 用户要求：选择样本时显示播放条，不再单独点试听按钮） -->
      <span v-if="samplePreviewLoading" class="preview-hint">正在加载样本音频…</span>
      <!-- 播放条常驻（2026-09-07 用户裁决：不判断显示隐藏，选样本只是换 src 加载） -->
      <audio ref="sampleAudioEl" :src="samplePreviewUrl || undefined" controls preload="auto" class="sample-audio" @loadedmetadata="onSampleAudioMeta" @ended="onSampleAudioEnded" @error="onSampleAudioError" />
    </div>

    <!-- ③ 样本参考文本（选择样本后自动填充） -->
    <div class="form-field">
      <div class="field-head">
        <label class="form-label">样本参考文本</label>
        <TButton
          :label="transcribing ? '正在识别...' : '识别参考音频文本'"
          icon="search"
          size="small"
          :disabled="transcribing || !refReady"
          :loading="transcribing"
          @click="transcribeRefAudio"
        />
      </div>
      <textarea
        v-model="refText"
        class="text-area"
        rows="3"
        placeholder="选择样本后自动填充；也可手动编辑"
      />
    </div>

    <!-- ③ 克隆模型（2026-09-20 用户裁决：QwenTTS 启用——服务端 TTS 统一入口
         engine=qwen3 已上线；克隆必填参考音频文稿 ref_text，缺失服务端 400；
         2026-09-28 服务端恢复 VoxCPM2（engine=voxcpm），加为第三选项） -->
    <div class="form-field">
      <label class="form-label">克隆模型</label>
      <div class="segmented">
        <!-- 2026-09-20 用户裁决：QwenTTS 为默认引擎，tab 置顶 -->
        <button
          class="segmented__btn"
          :class="{ 'is-active': ttsEngine === 'qwen3' }"
          type="button"
          title="Qwen3-TTS：克隆需在下方填写参考音频文稿"
          @click="ttsEngine = 'qwen3'"
        >QwenTTS（Qwen3-TTS）</button>
        <button
          class="segmented__btn"
          :class="{ 'is-active': ttsEngine === 'voxcpm' }"
          type="button"
          title="VoxCPM2：克隆需在下方填写参考音频文稿"
          @click="ttsEngine = 'voxcpm'"
        >VoxCPM2</button>
        <button
          class="segmented__btn"
          :class="{ 'is-active': ttsEngine === 'indextts' }"
          type="button"
          @click="ttsEngine = 'indextts'"
        >IndexTTS（快速/情感）</button>
      </div>
      <span class="form-hint">{{ ttsEngine === 'indextts'
        ? '当前使用 IndexTTS；整体克隆与逐行生成都用此模型与下方参数'
        : '当前引擎克隆必须填写参考音频文稿（参考文本），缺失服务端 400' }}</span>
    </div>

    <!-- ③+ 引擎参数（2026-09-20 用户裁决：按引擎显示各自设置——
         IndexTTS=语速/情感/强度；QwenTTS=预置音色/指令文本。
         此前 qwen3 下仍显示 IndexTTS 滑杆且参数被服务端忽略，致「变速不起作用」；
         2026-09-28：VoxCPM2（engine=voxcpm）=仅 ref_text（铁律），无数值参数，时长契约无上限） -->
    <div class="engine-params" v-if="ttsEngine === 'indextts'">
      <div class="form-field">
        <div class="field-head">
          <label class="form-label">语速（duration_factor）</label>
          <span class="param-value">{{ ttsDurationFactor.toFixed(1) }}x</span>
        </div>
        <input
          type="range"
          class="slider"
          min="0.5"
          max="2.0"
          step="0.1"
          v-model.number="ttsDurationFactor"
        />
        <div class="slider-labels">
          <span>0.5x 慢</span>
          <span>1.0x 正常</span>
          <span>2.0x 快</span>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">情感选择（emo_text，可选）</label>
        <TSelect
          :model-value="ttsEmoText"
          :options="EMO_OPTIONS"
          placeholder="不选择则使用样本默认情感"
          @update:model-value="(v: string | number) => (ttsEmoText = String(v))"
        />
      </div>
      <div class="form-field">
        <div class="field-head">
          <label class="form-label">情感强度（emo_alpha）</label>
          <span class="param-value">{{ ttsEmoAlpha.toFixed(1) }}</span>
        </div>
        <input
          type="range"
          class="slider"
          min="0"
          max="1"
          step="0.1"
          v-model.number="ttsEmoAlpha"
        />
      </div>
    </div>

    <!-- ③+ QwenTTS（Qwen3-TTS）专属参数（2026-09-20 用户裁决）：
         预置音色（speaker，与参考样本克隆二选一）+ 指令文本（instruct，可用自然语言描述语气/语速） -->
    <div class="engine-params" v-else-if="ttsEngine === 'qwen3'">
      <div class="form-field">
        <label class="form-label">预置音色（speaker，可选）</label>
        <TSelect
          :model-value="qwen3Speaker"
          :options="qwen3Voices"
          :loading="qwen3VoicesLoading"
          placeholder="不选择则按参考样本克隆音色"
          @update:model-value="(v: string | number) => (qwen3Speaker = String(v))"
        />
        <span class="form-hint">选择预置音色后由 QwenTTS 直出；留空则按参考样本克隆（需参考音频文稿）</span>
      </div>
      <div class="form-field">
        <label class="form-label">指令文本（instruct，可选）</label>
        <input
          v-model="qwen3Instruct"
          class="text-input"
          type="text"
          placeholder="用自然语言描述语气/语速，如：用轻快的语速说"
        />
        <span class="form-hint">QwenTTS 不支持 IndexTTS 的语速/情感数值参数，语气与语速请用指令文本描述</span>
      </div>
    </div>

    <!-- ③+ VoxCPM2 专属说明（2026-09-28 服务端恢复 engine=voxcpm）：
         仅 ref_text（铁律，上方「样本参考文本」即其来源）；无数值参数；
         契约未声明时长上限，长文案由宿主按句拆分拼接 -->
    <div class="engine-params" v-else-if="ttsEngine === 'voxcpm'">
      <div class="form-field">
        <span class="form-hint">
          VoxCPM2 克隆参数只有「样本参考文本」（ref_text，必填——上方文本框即其来源，
          可选样本后自动填充或手填）。不支持 IndexTTS 的语速/情感数值参数，也不支持
          QwenTTS 的预置音色/指令文本。合成时长契约无上限声明，长文案会按句拆分拼接。
        </span>
      </div>
    </div>

    <!-- ④ 待克隆整体文案 -->
    <div class="form-field">
      <label class="form-label">待克隆整体文案</label>
      <textarea
        v-model="wholeText"
        class="text-area"
        rows="5"
        placeholder="输入要合成语音的文本；每段文本合成时长不超过 20 秒"
      />
      <div class="action-row">
        <TButton
          label="整体克隆人声"
          icon="play"
          :disabled="!wholeText.trim() || !refReady"
          @click="generateWhole"
        />
      </div>
      <!-- 合成进度（服务端同步等待无真实进度：缓动假进度，完成置 100） -->
      <div v-if="wholeIsProcessing" class="synth-progress">
        <div class="synth-progress__track">
          <div class="synth-progress__bar" :style="{ width: Math.round(wholeSynthProgress) + '%' }" />
        </div>
        <span class="synth-progress__text">正在合成克隆人声… {{ Math.round(wholeSynthProgress) }}%{{ wholeSynthProgress >= 92 ? '（长文案合成需稍等）' : '' }}</span>
      </div>
      <span v-if="wholeErrorMsg" class="form-error">{{ wholeErrorMsg }}</span>
      <audio
        v-if="wholeStatus === 'done' && (wholeResultUrl || wholeResultPath)"
        class="audio-player"
        :src="resolveSrc(wholeResultUrl) || resolveSrc(wholeResultPath)"
        controls
      />
      <!-- 成功提示 + 上传配音库 + 下载 + 打开目录（内嵌 audio 播放器即播放控制，不另设播放按钮） -->
      <div v-if="wholeStatus === 'done'" class="success-info">
        <span class="success-icon">✓</span>
        <span class="success-text">克隆成功</span>
        <span class="success-engine">{{ wholeEngineLabel }}</span>
        <span v-if="wholeFileName" class="success-file">{{ wholeFileName }}</span>
        <div class="success-actions">
          <button class="action-btn" :disabled="uploadingToLib" @click="uploadWholeToLibrary" title="上传到素材库（音频库·配音分类）">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>
            {{ uploadingToLib ? '上传中…' : '上传配音到素材库' }}
          </button>
          <button class="action-btn" @click="saveWholeAudioAs" title="另存为到指定位置">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
            下载
          </button>
          <!-- 2026-09-19 用户裁决：打开目录按钮删除——克隆产物尚未下载落盘，
               该按钮指向的是服务端固定输出目录，对用户无意义 -->
        </div>
      </div>
    </div>

    <!-- 阶段提示 -->
    <div v-if="stageText" class="stage-line">{{ stageText }}</div>

    <!-- ⑥ 底部：上传新样本 -->
    <div class="upload-section">
      <div class="upload-section__title">没有想要的样本？上传音频创建新样本</div>
      <div
        class="dropzone"
        :class="{ 'is-active': isDragging, 'has-file': !!newSampleFilePath }"
        @click="pickUploadFile"
        @drop.prevent="onDropForward"
        @dragover.prevent="acceptFileDragOver($event); onDragOver(); isDragging = true"
        @dragleave.prevent="onDragLeave(); isDragging = false"
      >
        <svg v-if="!newSampleFilePath" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
        </svg>
        <div class="dropzone__text">
          <template v-if="!newSampleFilePath">
            <span class="dropzone__main">点击选择音频或拖拽到此处</span>
            <span class="dropzone__hint">支持 MP3 / WAV / M4A / FLAC</span>
          </template>
          <template v-else>
            <span class="dropzone__main">{{ newSampleFileName }}</span>
            <span class="dropzone__hint">点击重新选择</span>
          </template>
        </div>
      </div>
      <div v-if="newSampleFilePath" class="upload-fields">
        <div class="form-field">
          <label class="form-label">样本名称 *</label>
          <input
            v-model="newSampleName"
            class="text-input"
            placeholder="例：小美-温柔女声"
          />
        </div>
        <div class="form-field">
          <div class="field-head">
            <label class="form-label">对应文字（可选）</label>
            <TButton
              label="识别参考文字"
              size="small"
              :loading="transcribing"
              :disabled="!newSampleFilePath"
              @click="transcribeForNewSample"
            />
          </div>
          <textarea
            v-model="newSampleText"
            class="text-area text-area--sm"
            rows="2"
            placeholder="与参考音频一致的文字；也可点击右侧按钮自动识别"
          />
        </div>
        <div class="upload-actions">
          <TButton
            label="上传为样本"
            icon="upload"
            :loading="uploadingSample"
            :disabled="!newSampleFilePath || !newSampleName.trim()"
            @click="onUploadNewSample"
          />
        </div>
        <div v-if="newSampleError" class="form-error">{{ newSampleError }}</div>
        <div v-if="newSampleSuccess" class="form-success">{{ newSampleSuccess }}</div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.tool-form { display: flex; flex-direction: column; gap: var(--space-5); }

.form-field { display: flex; flex-direction: column; gap: var(--space-2); }
.form-label { font-size: var(--font-size-caption); font-weight: var(--font-weight-medium); color: var(--foreground-muted); }
.form-hint { font-size: var(--font-size-caption); color: var(--muted-foreground); }
.form-error { font-size: var(--font-size-caption); color: var(--error); }
.form-success { font-size: var(--font-size-caption); color: var(--success); }
.field-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }

/* 样本选择行：下拉框 + 试听按钮（同一行，2026-09-06 用户要求） */
.sample-row { display: flex; align-items: center; gap: var(--space-2); }
.sample-row > :first-child { flex: 1 1 auto; min-width: 0; }
.sample-audio {
  height: 32px;
  width: 100%;
  max-width: 480px;
  margin-top: var(--space-2);
}
.preview-hint { font-size: 12px; color: var(--muted); }
.sample-audio::-webkit-media-controls-panel { background: var(--muted); }

/* 分段切换 */
.segmented {
  display: inline-flex; padding: 2px; background: var(--surface-container);
  border: 1px solid var(--border); border-radius: var(--radius-md); align-self: flex-start;
}
.segmented__btn {
  padding: 0 var(--space-4); height: var(--size-button-height-sm);
  font-size: var(--font-size-caption); font-weight: var(--font-weight-medium);
  color: var(--muted-foreground); border-radius: var(--radius-sm);
  transition: background var(--duration-fast), color var(--duration-fast);
}
.segmented__btn.is-active { background: var(--primary); color: var(--primary-foreground); }
.segmented__btn:disabled { opacity: 0.45; cursor: not-allowed; text-decoration: line-through; }

/* 拖拽上传区（2026-09-07 用户裁决：全程序拖拽上传区高度统一 min-height 120px，
   以智能混剪选择素材原高 ≈80px 基准 +1/2） */
.dropzone {
  display: flex; align-items: center; gap: var(--space-3); min-height: 120px; padding: var(--space-5);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-container)); border: 1.5px dashed color-mix(in srgb, var(--primary) 40%, var(--border));
  border-radius: var(--radius-lg); color: var(--muted-foreground); cursor: pointer;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}
.dropzone:hover, .dropzone.is-active { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, var(--surface-container)); }
.dropzone.has-file { border-style: solid; color: var(--foreground); }
.dropzone__text { display: flex; flex-direction: column; gap: 2px; }
.dropzone__main { font-size: var(--font-size-body); font-weight: var(--font-weight-medium); color: var(--foreground); }
.dropzone__hint { font-size: var(--font-size-caption); color: var(--muted-foreground); }

/* 上传区域 */
.upload-section {
  margin-top: var(--space-2);
  padding: var(--space-5);
  background: var(--surface-container);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}
.upload-section__title {
  font-size: var(--font-size-lead);
  font-weight: var(--font-weight-semibold);
  color: var(--foreground);
  margin-bottom: var(--space-4);
}
.upload-fields { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-4); }
.upload-actions { display: flex; justify-content: flex-end; }

/* 文本域 */
.text-area {
  width: 100%; padding: var(--space-3); background: var(--surface-container);
  border: 1px solid var(--border); border-radius: var(--radius-md);
  color: var(--foreground); font-size: var(--font-size-body);
  line-height: var(--line-height-relaxed); outline: none; resize: vertical;
  box-sizing: border-box;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.text-area::placeholder { color: var(--muted-foreground); }
.text-area:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--ring); }
.text-area--sm { min-height: 56px; }

.text-input {
  width: 100%; padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-body); color: var(--foreground);
  background: var(--surface-container); border: 1px solid var(--border);
  border-radius: var(--radius-sm); outline: none;
}
.text-input:focus { border-color: var(--primary); }

.action-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.upload-progress { font-size: var(--font-size-caption); color: var(--muted-foreground); }
/* 整体克隆合成进度条（缓动假进度：无真实进度可拉，前快后慢逼近 92%，完成置 100） */
.synth-progress { display: flex; align-items: center; gap: var(--space-3); }
.synth-progress__track {
  flex: 1; max-width: 320px; height: 6px; border-radius: 3px;
  background: var(--surface-container); overflow: hidden;
}
.synth-progress__bar {
  height: 100%; border-radius: 3px; background: var(--primary);
  transition: width 150ms linear;
}
.synth-progress__text { font-size: var(--font-size-caption); color: var(--muted-foreground); white-space: nowrap; }
.audio-player { width: 100%; }
.stage-line { font-size: var(--font-size-caption); color: var(--foreground-muted); }

/* 引擎参数区 */
.engine-params {
  padding: var(--space-4);
  background: var(--surface-container);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  display: flex; flex-direction: column; gap: var(--space-3);
}
.param-value {
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-medium);
  color: var(--primary);
  min-width: 40px;
  text-align: right;
}
.slider {
  width: 100%; height: 6px;
  -webkit-appearance: none; appearance: none;
  background: var(--border); border-radius: 3px; outline: none;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--primary); cursor: pointer;
}
.slider-labels {
  display: flex; justify-content: space-between;
  font-size: var(--font-size-caption); color: var(--muted-foreground);
}

/* 成功提示 */
.success-info {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-3); margin-top: var(--space-3);
  background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: var(--radius-md);
}
.success-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--success); color: white; font-size: 12px; font-weight: bold;
}
.success-text { font-size: var(--font-size-caption); color: var(--success); font-weight: var(--font-weight-medium); }
.success-engine {
  font-size: var(--font-size-caption); padding: 1px 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary);
  white-space: nowrap;
}
.success-file {
  font-size: var(--font-size-caption); color: var(--foreground-muted);
  font-family: var(--font-mono); max-width: 200px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.success-actions {
  display: flex; align-items: center; gap: var(--space-1); margin-left: auto;
}
.action-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  font-size: var(--font-size-caption); color: var(--foreground-muted);
  background: var(--surface-container); border: 1px solid var(--border);
  border-radius: var(--radius-sm); cursor: pointer;
  transition: all var(--duration-fast);
}
.action-btn:hover { color: var(--foreground); border-color: var(--primary); background: var(--surface-container-high); }
</style>
