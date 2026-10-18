<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════
// OtCopywritingPanel.vue — 文案生成面板（运营工具·产品资料 · 内嵌面板）
// SRC components/ops-tools/OtCopywritingPanel.vue 移植（搬运基线 SRC 9ca9050）。
// 2026-09-05 用户裁决：自媒体工具「产品知识」页迁入产品资料页底部。
// 产品上下文不再自带检索 UI：由产品资料页树选中（editingId/form）经
// props 单向同步进 useOpsCopywriting；性能参数/核心卖点的编辑入口
// 即上方「智能挖掘」表单（保存才落库，维持「临时编辑」语义）。
// 分层（IRON-06）：业务全在 useOpsCopywriting；本组件只绘制 + 同步 + 转发。
// 移植差异：SRC 经 vue-router 跳媒体工具分镜卡——本包无路由且分镜脚本
// 创作卡为 P2 批次未移植，跳转改为写入 pendingStoryboard 信号 + 状态
// 提示（信号本体与一次性消费时序不变，卡片移植后恢复导航）。
// ═══════════════════════════════════════════════════════════════

import { watch } from 'vue'
import {
  PLATFORM_OPTIONS,
  STRUCTURE_OPTIONS,
  TAG_OPTIONS,
  TONE_OPTIONS,
} from '@/composables/opsCopywritingLogic'
import { useOpsCopywriting } from '@/composables/useOpsCopywriting'

const props = defineProps<{
  /** 产品资料页当前编辑条目 id（新增模式为 ''，此时生成被前置校验拦截） */
  productId: string
  /** 智能挖掘表单的性能参数（随表单编辑实时同步） */
  features: string
  /** 智能挖掘表单的核心卖点 */
  sellingPoints: string
  /** 表单全量字段（category/brand/model/goods_no/spec_name…）供 prompt 基础行与分镜上下文 */
  product: Record<string, unknown>
}>()

const C = useOpsCopywriting()

/* 产品上下文同步：树选中 / 表单编辑 → 文案域状态（单向；资料表单为唯一编辑入口） */
watch(
  () => [props.productId, props.features, props.sellingPoints, props.product] as const,
  ([pid, feats, points, prod]) => {
    C.selectedProductId.value = pid
    C.currentProduct.value = prod
    C.features.value = feats
    C.sellingPoints.value = points
  },
  { immediate: true },
)

/** 携带文案→分镜卡（goToStoryboard 写入 pendingStoryboard 信号；分镜卡 P2 消费）。
 *  2026-09-27 打通跳转：写入后经顶部 Tab 切到「媒体工具」并打开分镜脚本创作卡
 *  （App.vue 侦听信号自动开卡；tab 切换沿用 chrome 的 DOM 点击口径）。 */
function goStoryboard(): void {
  if (!C.goToStoryboard()) return
  document.querySelector<HTMLElement>('#tintin-top-tabs button[data-view="media"]')?.click()
  C.status.value = '已切换到「媒体工具 → 分镜脚本创作」，文案自动带入。'
}
</script>

<template>
  <section class="ocp">
    <!-- 风格化（可选）：知识库模块分批实施中，占位口径与原页面一致 -->
    <div class="card">
      <div class="card-title">风格化（可选）</div>
      <p class="hint">知识库模块分批实施中，风格化条目暂不可选；生成流程为纯产品驱动。</p>
    </div>

    <div class="card">
      <div class="settings-grid">
        <label class="field">
          <span class="lbl">平台</span>
          <select class="input" v-model="C.platform.value">
            <option v-for="o in PLATFORM_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">语气</span>
          <select class="input" v-model="C.tone.value">
            <option v-for="o in TONE_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">结构</span>
          <select class="input" v-model="C.structure.value">
            <option v-for="o in STRUCTURE_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
        <label class="field">
          <span class="lbl">话题标签</span>
          <select class="input" v-model="C.tags.value">
            <option v-for="o in TAG_OPTIONS" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>
      </div>
      <label class="check-row">
        <input type="checkbox" v-model="C.avoidBanned.value" />
        规避平台违禁词 / 极限词
      </label>

      <label class="field">
        <span class="lbl">附加提示词（可选）</span>
        <textarea
          class="input ta short"
          placeholder="可输入额外要求，例如：时长约60秒 / 针对年轻女性 / 偏硬核测评风格 / 避免夸大词…"
          v-model="C.extraPrompt.value"
        ></textarea>
      </label>

      <div class="btn-row">
        <button class="btn" :disabled="C.generating.value" @click="C.checkExtreme">极端词检测</button>
        <button class="btn primary" :disabled="C.generating.value" @click="C.generate">
          {{ C.generating.value ? 'AI 正在创作文案…' : '生成文案' }}
        </button>
      </div>

      <label class="field">
        <span class="lbl">视频文案（可编辑）</span>
        <textarea
          class="input ta copy"
          placeholder="根据产品卖点（和可选风格化）生成的文案显示在这里；生成后可直接编辑。"
          v-model="C.copyText.value"
        ></textarea>
      </label>

      <div class="btn-row">
        <button class="btn" @click="C.copyToClipboard">复制文案</button>
        <button class="btn primary" @click="goStoryboard">前往分镜脚本设计 →</button>
      </div>

      <div v-if="C.status.value" class="status">{{ C.status.value }}</div>
    </div>
  </section>
</template>

<style scoped>
/* 左：风格化占位卡（窄）；右：生成设置/文案（宽）——沿用原页面 1:3 比例 */
.ocp { display: grid; grid-template-columns: minmax(220px, 1fr) 3fr; gap: var(--space-4); }

.card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: var(--space-4);
  display: flex; flex-direction: column; gap: var(--space-3);
}
.card-title { font-size: 14px; font-weight: 700; color: var(--foreground); }
.hint { font-size: 12px; color: var(--muted-foreground); }

.input {
  height: 32px; padding: 0 10px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--background);
  color: var(--foreground); font-size: 13px; width: 100%; box-sizing: border-box;
}
.ta { height: 96px; padding: 8px 10px; resize: vertical; line-height: 1.5; }
.ta.short { height: 64px; }
.ta.copy { height: 280px; }

.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.lbl { font-size: 12px; color: var(--muted-foreground); }
.check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--foreground); }

.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); }

.btn-row { display: flex; align-items: center; gap: var(--space-3); justify-content: flex-end; }
.btn {
  height: 32px; padding: 0 14px; border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--surface-container);
  color: var(--foreground); font-size: 13px; font-weight: 500; cursor: pointer;
  transition: all var(--duration-fast); white-space: nowrap;
}
.btn:hover { border-color: var(--primary); color: var(--primary); }
.btn.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.btn.primary:hover { opacity: 0.9; }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }

.status { font-size: 12px; color: var(--muted-foreground); line-height: 1.5; word-break: break-all; }

@media (max-width: 1000px) {
  .ocp { grid-template-columns: 1fr; }
  .settings-grid { grid-template-columns: 1fr; }
}
</style>
