<script setup lang="ts">
// ═════════════════════════════════════════════════════════════
// ImitationFxStep.vue — 仿视频第 5 步 特效包装：整套嵌入文案混剪第 4 步面板
// （CopywritingStep4Panel 本体：上部脚本+逐镜视频，下部花字/字体模板/关键词
//  标注/字幕样式/BGM/音效 + 导出与合成——2026-10-06 用户裁决整套嵌入）。
// 数据面=useCopywritingMontage 独立实例；装载=把仿视频脚本（同库 storyboard
// 脚本）经 选择脚本链（refreshScriptOptions→selectScriptOption→
// applySelectedScript）灌入文案混剪状态机——与「选择分镜脚本」同口径。
// ═════════════════════════════════════════════════════════════
import { computed, onMounted, provide, ref, watch } from 'vue'
import { useCopywritingMontage } from '@/composables/useCopywritingMontage'
import { createMontageSharedRuntime } from '@/composables/copywritingMontage/context'
import { copywritingMontageShellKey } from './copywriting-montage/copywritingMontageUiContext'
import ImitationFxPackPanel from './ImitationFxPackPanel.vue'
import TButton from '@/components/common/TButton.vue'

const props = defineProps<{ scriptId: string; section: 'fx' | 'export' }>()
const emit = defineEmits<{ (e: 'back'): void; (e: 'next'): void }>()

const s = useCopywritingMontage()
const { toAbsolute } = createMontageSharedRuntime()
const loadState = ref<'' | 'loading' | 'ok' | 'error'>('')
/** 口播放条数据：脚本绑定的口播音频（voice_audio_id → 素材库 serve 流；无绑定=不显示，2026-10-13 用户需求） */
const voiceAudioUrl = ref('')
const loadErr = ref('')

async function loadImitationScript(): Promise<void> {
  if (!props.scriptId) { loadErr.value = '缺少脚本 id（先完成前面步骤）'; loadState.value = 'error'; return }
  loadState.value = 'loading'
  loadErr.value = ''
  try {
    await s.refreshScriptOptions()
    const opt = s.scriptPickDlg.value.options.find((o) => o.id === props.scriptId)
    if (!opt) throw new Error(`脚本库里没找到该脚本（${props.scriptId}）`)
    s.selectScriptOption(props.scriptId)
    // selectScriptOption 异步填 pickDetail——轮询至加载完成（最长 ~10s）
    for (let i = 0; i < 50; i++) {
      if (!s.pickDetail.value.loading) break
      await new Promise((r) => setTimeout(r, 200))
    }
    if (s.pickDetail.value.loading) throw new Error('脚本详情加载超时')
    if (!s.pickDetail.value.detail) throw new Error(s.pickDetail.value.error || '脚本详情为空')
    // 仿视频装载=以服务端脚本为准静默重建：先移除本脚本旧 tab（持久化恢复的 tab
    // 会让 applySelectedScript 走「已切换分镜」分支=误导性提示+绑定可能过期）
    s.storyboards.value = s.storyboards.value.filter((t) => t.scriptId !== props.scriptId)
    // 等绑定恢复入池完成（2026-10-06：交付步装载后要按绑定自动生成合成方案）
    await s.applySelectedScript({ silent: true })
    // 只保留本仿视频脚本的分镜 tab——文案混剪状态可能残留其他脚本的旧 tab
    //（词表按全部分镜 tab 构建，旧旁白会混进词条预览；运行时剔除，服务端脚本库不受影响）
    const keep = s.storyboards.value.find((t) => t.scriptId === props.scriptId)
    if (keep) {
      s.storyboards.value = [keep]
      s.activeStoryboardId.value = keep.id
    }
    // 口播放条：读脚本绑定的口播音频（voice_audio_id=0/缺字段=无口播，行不显示）
    try {
      const resp = (await window.tintin.server.get(`/api/storyboard/scripts/${props.scriptId}`)) as Record<string, unknown> | null
      const data = (resp && ((resp as Record<string, unknown>).data ?? resp)) as Record<string, unknown> | null
      const vid = Number(data?.voice_audio_id ?? 0)
      // voice_audio_id 是音频库 id（/audio/library/upload 返回）——取流必须走音频库
      // 端点；此前误用 /material/serve（素材库命名空间）→ 5026 解析成图片，口播条
      // 恒 0:00/0:00 无声（2026-10-13 实测：audio/library/5026/file=200 audio/x-wav 3.18MB）
      if (vid > 0) voiceAudioUrl.value = toAbsolute(`/audio/library/${vid}/file`)
    } catch { /* 静默：取不到就不显示口播条 */ }
    // 第④步进入加载：文字模板库/花字 lanes/字幕样式/voiceRows 重扫（漏跑=模板库空、词条全空）
    await s.enterStep4()
    // 字幕样式/字体库预载（2026-10-06 用户报障"字幕样本太少"：对齐文案混剪 enterStepVoice——
    // 漏跑=样式恒 6 条本地兜底（服务端 /subtitle_styles 有 30 条）、字体缺服务端 /config/fonts 库）
    void s.refreshSubtitleStyles()
    void s.refreshFonts()
    // 交付步：按当前绑定自动重建合成方案（2026-10-06 用户报障"第5步已确认合成，第6步
    // 仍报没有剪辑方案"根因=5/6 步是独立实例、方案不跨步存活；方案=虚拟时间轴秒级
    // 确定性生成，绑定一致则与第 5 步「确认合成视频脚本」结果相同）
    if (props.section === 'export') await autoBuildMontagePlan()
    loadState.value = 'ok'
  } catch (e) {
    loadErr.value = (e as Error).message || String(e)
    loadState.value = 'error'
  }
}

// 文案混剪内部步序（0 基：0 文案编写/1 口播配音/2 视频素材/3 特效包装）——直接落在特效包装
const cwStep = ref(3)
function go(i: number): void { cwStep.value = Math.max(0, Math.min(3, i)) }

/** 面板与 Storyboard 组件经 inject 取状态——shell 必须提供（缺=脚本/视频组件崩溃不渲染） */
provide(copywritingMontageShellKey, {
  s,
  step: cwStep,
  go,
  steps: ['1. 文案编写', '2. 口播配音', '3. 视频素材', '4. 特效包装'],
  vdLeftStyle: computed(() => ({ flex: '1' })),
  onSplitDown: (_e: MouseEvent) => {},
  previewAspect: computed(() => '9 / 16'),
})

const montageStepProps = computed(() => ({ s }))

// ── 确认合成视频脚本（2026-10-06 用户裁决：对齐文案混剪「视频素材·生成剪辑方案」——
//    嵌入面板无内部步条，方案生成收拢为本按钮；交付步的导出/服务端合成消费同一 assemblePlans）──
const planBusy = computed(() => s.concatBusy.value)
const planReady = computed(() => s.assemblePlans.value.length > 0 && !s.hasUnconfirmed.value)
const planNote = ref('')
function montageTabs() {
  return s.storyboards.value.map((t) => ({
    id: t.id, name: t.name, narrative: t.narrative, voiceDurSec: t.voiceDurSec,
    shots: t.shots, clipGroups: t.clipGroups.map((g) => g.slice()),
  }))
}
async function confirmVideoScript(): Promise<void> {
  if (s.concatBusy.value) return
  const tabs = montageTabs()
  const ok = await s.runConcatFromAllStoryboards(tabs)
  planNote.value = ok
    ? `合成方案已生成（${tabs.length} 个分镜）——可进「交付」导出剪映草稿或服务端合成。`
    : '合成方案未生成——请检查每镜绑定素材（有分镜未绑定素材时不能生成）。'
}
/** 交付步装载尾自动重建方案（同 confirmVideoScript 链；失败经 toast 可见、不阻断页面） */
async function autoBuildMontagePlan(): Promise<void> {
  if (!s.storyboards.value.length || s.concatBusy.value) return
  await s.runConcatFromAllStoryboards(montageTabs())
}

onMounted(() => { void loadImitationScript() })
watch(() => props.scriptId, () => { void loadImitationScript() })

</script>

<template>
  <div class="iv-panel">
    <div v-if="loadState === 'loading'" class="muted">正在装载仿视频脚本到特效包装链…</div>
    <div v-else-if="loadState === 'error'" class="iv-err">脚本装载失败：{{ loadErr }}</div>
    <template v-else>
      <div class="row">
        <span class="muted">特效包装（文案混剪同款面板——脚本/视频在上，字体模板/关键词标注/字幕样式/BGM 在下；导出为客户端剪映草稿）</span>
        <span class="spacer"></span>
      </div>
      <ImitationFxPackPanel :s="s" :section="section" :voice-audio-url="voiceAudioUrl" />
      <!-- 确认合成视频脚本（整行；文案混剪同口径=生成剪辑方案，供交付步导出/合成消费） -->
      <TButton
        v-if="section === 'fx'"
        :label="planReady ? '确认合成视频脚本（方案已生成，可重新生成）' : '确认合成视频脚本'"
        style="width: 100%"
        :loading="planBusy"
        :icon="planReady ? 'check' : ''"
        title="按每镜绑定素材生成合成方案（同文案混剪「生成剪辑方案」）；交付步的导出与服务端合成依赖此方案"
        @click="confirmVideoScript"
      />
      <div v-if="planNote" class="muted">{{ planNote }}</div>
    </template>
    <div class="row">
      <TButton label="← 上一步" variant="primary" @click="emit('back')" />
      <span class="spacer"></span>
      <!-- 交付（export）步是最后一步：无下一步（2026-10-06 用户裁决） -->
      <TButton v-if="section === 'fx'" label="下一步：交付" @click="emit('next')" />
    </div>
  </div>
</template>

<style scoped>
.iv-panel { display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.spacer { flex: 1; }
.muted { color: var(--muted-foreground); font-size: 12px; }
.iv-err { color: var(--danger, #e74c3c); font-size: 12px; }
</style>
