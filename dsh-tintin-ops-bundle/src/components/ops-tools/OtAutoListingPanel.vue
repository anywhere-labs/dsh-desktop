<script setup lang="ts">
// OtAutoListingPanel.vue — 自动上架操作面板（SRC AutoListingView 移植；壳页面形态）。
// 2026-09-29 用户裁决：UI 入口=运营工具卡；引擎=壳侧浏览器 fxg 分区（autoListing:*
// 七通道 + 'auto-listing:progress' 订阅，经 tintin 桥 polyfill）。使用前置：在浏览器
// 窗口完成抖店登录（面板顶部提示指路）。
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface AutoListingRun {
  runId: string
  stage: string
  status: string
  ts: number
  sourceName?: string
  title?: string
}

const inputPath = ref('')
const shopKey = ref('juyou')
const publishAfterSave = ref(false)
const validating = ref(false)
const validateError = ref('')
const summary = ref<{ title?: string; skus?: string[]; runId?: string } | null>(null)
const running = ref(false)
const logs = ref<Array<{ ts: number; stage: string; message: string }>>([])
const runs = ref<AutoListingRun[]>([])
const lastRunId = ref('')
const panelRunId = ref('')

function tintin(): any {
  return (window as any).tintin
}

function logLine(stage: string, message: string, ts?: number): void {
  logs.value.push({ ts: ts || Date.now(), stage: stage || '…', message: message || '' })
}

function setBusy(busy: boolean): void {
  running.value = busy
}

function loadRuns(): void {
  const t = tintin()
  if (!t?.autoListingListRuns) return
  void t
    .autoListingListRuns()
    .then((r: { success?: boolean; data?: { runs?: AutoListingRun[] } }) => {
      runs.value = r?.data?.runs ?? []
      if (runs.value[0]) {
        lastRunId.value = runs.value[0].runId
        panelRunId.value = panelRunId.value || runs.value[0].runId
      }
    })
    .catch(() => {})
}

function validate(): void {
  const t = tintin()
  if (!t?.autoListingValidate || !inputPath.value.trim()) return
  validating.value = true
  validateError.value = ''
  summary.value = null
  void t
    .autoListingValidate({ inputPath: inputPath.value.trim() })
    .then((r: { success?: boolean; data?: { runId?: string; title?: string; skus?: string[] }; error?: string }) => {
      validating.value = false
      if (r?.success && r.data) {
        panelRunId.value = r.data.runId || ''
        summary.value = { title: r.data.title, skus: r.data.skus, runId: r.data.runId }
      } else {
        validateError.value = r?.error || '校验失败'
      }
    })
    .catch((e: Error) => {
      validating.value = false
      validateError.value = e?.message || String(e)
    })
}

function start(): void {
  const t = tintin()
  if (!t?.autoListingStart) return
  const payload: Record<string, unknown> = {
    shopKey: shopKey.value,
    publishAfterSave: publishAfterSave.value,
  }
  if (panelRunId.value) payload.runId = panelRunId.value
  else if (inputPath.value.trim()) payload.inputPath = inputPath.value.trim()
  void t
    .autoListingStart(payload)
    .then((r: { success?: boolean; error?: string }) => {
      if (r?.success) {
        logs.value = []
        setBusy(true)
      } else logLine('错误', r?.error || '启动失败')
    })
    .catch((e: Error) => logLine('错误', e?.message || String(e)))
}

function stop(): void {
  const t = tintin()
  if (!t?.autoListingStop) return
  void t
    .autoListingStop()
    .then(() => setBusy(false))
    .catch(() => {})
}

function resume(): void {
  const t = tintin()
  if (!t?.autoListingResume) return
  const runId = lastRunId.value || panelRunId.value
  if (!runId) {
    logLine('提示', '暂无可续跑的任务（先校验/启动一次）')
    return
  }
  void t
    .autoListingResume({ runId, publishAfterSave: publishAfterSave.value })
    .then((r: { success?: boolean; error?: string }) => {
      if (r?.success) {
        panelRunId.value = runId
        logs.value = []
        setBusy(true)
      } else logLine('错误', r?.error || '续跑失败')
    })
    .catch((e: Error) => logLine('错误', e?.message || String(e)))
}

function openResult(): void {
  const t = tintin()
  const runId = lastRunId.value || panelRunId.value
  if (t?.autoListingOpenResultDir && runId) void t.autoListingOpenResultDir(runId).catch(() => {})
}

let offProgress: (() => void) | null = null

onMounted(() => {
  const t = tintin()
  if (!t) return
  if (t.onAutoListingProgress) {
    offProgress = t.onAutoListingProgress((p: { runId?: string; stage: string; message: string; ts: number }) => {
      logLine(p.stage, p.message, p.ts)
      if (p.runId) {
        lastRunId.value = p.runId
        panelRunId.value = p.runId
      }
      const st = String(p.stage || '').toLowerCase()
      if (st.includes('done') || st.includes('fail') || st.includes('finish') || st.includes('stop')) {
        setBusy(false)
        loadRuns()
      }
    })
  }
  void t
    .autoListingStatus?.()
    .then((r: { data?: { running: boolean; runId?: string } }) => {
      if (r?.data?.running) {
        setBusy(true)
        if (r.data.runId) panelRunId.value = r.data.runId
      }
    })
    .catch(() => {})
  loadRuns()
})

onBeforeUnmount(() => {
  offProgress?.()
  offProgress = null
})
</script>

<template>
  <div class="al">
    <div class="hint-bar">
      引擎在内置浏览器（抖店 fxg 分区）：请先在 TinTin 浏览器 → 自动上架 → 「打开抖店工作台」完成登录，再回到本面板操作。
    </div>

    <section class="card">
      <div class="label">① 数据包</div>
      <div class="row">
        <input v-model="inputPath" class="input grow" placeholder="数据包目录/压缩包路径" spellcheck="false" />
        <button class="btn" :disabled="validating" @click="validate">{{ validating ? '校验中…' : '校验' }}</button>
      </div>
      <div v-if="summary" class="summary">标题：{{ summary.title || '（未命名）' }}<br />SKU：{{ (summary.skus && summary.skus.length) || 0 }} 个</div>
      <div v-if="validateError" class="error">校验失败：{{ validateError }}</div>
    </section>

    <section class="card">
      <div class="label">② 执行</div>
      <div class="row wrap">
        <span class="mini">店铺</span>
        <select v-model="shopKey" class="sel"><option value="juyou">聚优</option></select>
        <label class="check"><input v-model="publishAfterSave" type="checkbox" /> 保存后直接上架</label>
        <span class="grow"></span>
        <button class="btn primary" :disabled="running" @click="start">开始任务</button>
        <button class="btn" :disabled="!running" @click="stop">停止</button>
        <button class="btn" @click="resume">续跑最近</button>
      </div>
    </section>

    <section class="card">
      <div class="label">③ 进度日志</div>
      <div class="log">
        <div v-for="(l, i) in logs" :key="i" class="log-line">[{{ new Date(l.ts).toTimeString().slice(0, 8) }}][{{ l.stage }}] {{ l.message }}</div>
        <div v-if="!logs.length" class="log-empty">尚无日志（启动任务后实时滚动）</div>
      </div>
    </section>

    <section class="card">
      <div class="label">④ 结果</div>
      <div class="mini">
        {{ running ? '任务运行中…' : lastRunId ? `最近任务：${lastRunId}` : '尚无运行记录' }}
      </div>
      <div class="row" style="margin-top: 8px">
        <button class="btn" :disabled="!lastRunId" @click="openResult">打开结果目录</button>
        <span class="mini grow">
          {{ runs.length ? `历史 ${runs.length} 次，最近：${runs[0]?.title || runs[0]?.runId}（${runs[0]?.status}）` : '' }}
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.al { display: flex; flex-direction: column; gap: var(--space-4); }
.hint-bar {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-left: 3px solid var(--primary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-body);
  color: var(--muted-foreground);
  background: var(--surface-container);
}
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  background: var(--card);
}
.label { font-size: 12px; font-weight: 700; color: var(--muted-foreground); margin-bottom: var(--space-3); }
.row { display: flex; align-items: center; gap: var(--space-3); }
.row.wrap { flex-wrap: wrap; }
.grow { flex: 1 1 auto; min-width: 0; }
.input {
  height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--background); color: var(--foreground); font-size: 13px; outline: none;
}
.btn {
  height: 30px; padding: 0 14px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--surface-container); color: var(--foreground); font: inherit; font-size: 12px; cursor: pointer;
}
.btn.primary { border: none; background: var(--primary); color: var(--primary-foreground); font-weight: 600; }
.btn:disabled { opacity: 0.45; cursor: default; }
.sel {
  height: 28px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--background); color: var(--foreground); font: inherit; font-size: 12px;
}
.check { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--foreground); cursor: pointer; }
.mini { font-size: 12px; color: var(--muted-foreground); }
.summary { margin-top: var(--space-3); font-size: var(--font-size-body); color: var(--foreground); white-space: pre-wrap; word-break: break-all; }
.error { margin-top: var(--space-3); font-size: var(--font-size-body); color: var(--destructive, #e5484d); white-space: pre-wrap; word-break: break-all; }
.log {
  height: 170px; overflow-y: auto; font: 11px/1.5 Consolas, monospace;
  background: var(--background); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 6px 8px;
  user-select: text;
}
.log-line { margin: 1px 0; color: var(--foreground); }
.log-empty { color: var(--muted-foreground); }
</style>
