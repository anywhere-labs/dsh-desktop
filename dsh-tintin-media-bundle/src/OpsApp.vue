<script setup lang="ts">
// 运营工具视图根组件：分组卡片网格 + 内嵌工具展开（模式对齐 App.vue 的媒体
// Launcher；SRC views/OpsTools.vue 三组结构 1:1，搬运基线 SRC 9ca9050）。
// 2026-09-25 用户裁决：产品资料卡随图像抠图一并移植（提前于 P3 ops-bundle），
// 其余 5 卡保持「建设中」占位（恢复一张加一张卡）；卡片清单位置/描述/配色
// 与 SRC GROUP_TOOLS 逐字对齐。占位网格（tintin-bundle chrome）在本视图
// 注册后被 provider 接管，P3 ops-bundle 落地时迁移注册权即可。
import { computed, onMounted, ref } from 'vue'
// 产品资料（2026-09-25 用户裁决移植）：仓库同步/树/表单增删改/智能挖掘/全量挖掘
// + 内嵌文案生成面板（OtCopywritingPanel）
import OtProductLibrary from './components/ops-tools/OtProductLibrary.vue'
// 自动上架（2026-09-29 用户裁决：UI 入口=运营工具卡；引擎=壳侧浏览器 fxg 分区）
import OtAutoListingPanel from './components/ops-tools/OtAutoListingPanel.vue'
// 视频反推提示词（2026-10-02 用户裁决启用）：走仿视频拆解接口一次返回脚本+提示词
import OtReversePromptVideo from './components/ops-tools/OtReversePromptVideo.vue'

interface ToolCard {
  id: string
  title: string
  desc: string
  emoji: string
  accent: string
  /** 建设中占位：不可点 */
  disabled?: boolean
}

const GROUPS: Array<{ group: string; tools: ToolCard[] }> = [
  {
    group: '产品知识',
    tools: [
      { id: 'product-library', title: '产品资料', desc: '品类/品牌/型号树状管理，服务端同步', emoji: '📦', accent: 'linear-gradient(135deg,#8B5CF6 0%,#EC4899 100%)' },
      { id: 'knowledge-base', title: '我的知识库', desc: '风格化画像 + 参考素材蒸馏', emoji: '📚', accent: 'linear-gradient(135deg,#0EA5E9 0%,#06B6D4 100%)', disabled: true },
    ],
  },
  {
    group: '提示词',
    tools: [
      { id: 'reverse-prompt-image', title: '图片反推提示词', desc: '上传图片，AI 生成绘画提示词', emoji: '🖼️', accent: 'linear-gradient(135deg,#10B981 0%,#14B8A6 100%)', disabled: true },
      { id: 'reverse-prompt-video', title: '视频反推提示词', desc: '拆解视频 → 脚本 + 反推提示词（仿视频拆解接口）', emoji: '🎬', accent: 'linear-gradient(135deg,#3B82F6 0%,#8B5CF6 100%)' },
    ],
  },
  {
    group: '视频运营',
    tools: [
      // 2026-09-29 用户裁决：自动上架 UI 入口=运营工具卡（引擎=壳侧浏览器 fxg 分区）
      { id: 'auto-listing', title: '自动上架', desc: '数据包校验 → 抖店工作台自动铺货（引擎在内置浏览器）', emoji: '🛒', accent: 'linear-gradient(135deg,#2563EB 0%,#7C3AED 100%)' },
      { id: 'video-score', title: '视频评价预测', desc: '关键帧 → 视觉模型预测视频表现', emoji: '📈', accent: 'linear-gradient(135deg,#F59E0B 0%,#EF4444 100%)', disabled: true },
      { id: 'video-marketing', title: '视频营销检测', desc: '研判是否营销视频 + 品类 + 改进建议', emoji: '🎯', accent: 'linear-gradient(135deg,#10B981 0%,#14B8A6 100%)', disabled: true },
    ],
  },
]

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools)
const active = ref<string | null>(null)
const activeTool = computed(() => ALL_TOOLS.find((t) => t.id === active.value) ?? null)

function openTool(t: ToolCard): void {
  if (t.disabled) return
  active.value = t.id
}

// 主题跟随宿主：源项目靠 <html class="dark">；面板注入宿主 DOM，取宿主
// dark 类 + 系统偏好一次性判定（挂载时求值，不做监听——面板生命周期短）。
const isDark = ref(false)
onMounted(() => {
  const hostDark = document.documentElement.classList.contains('dark')
  isDark.value = hostDark || window.matchMedia('(prefers-color-scheme: dark)').matches
})
</script>

<template>
  <!-- tintin-media-scope：搬运的 tokens/global css 的作用域根（见 src/styles/）；
       运营视图与媒体视图共用同一套令牌作用域 -->
  <div class="tintin-media-scope root" :class="{ dark: isDark }">
    <!-- ═══ 卡片网格 ═══（2026-09-25 空白修复：同 App.vue，去 out-in Transition 换同步交换） -->
    <div v-if="!active" class="page">
        <div class="head">
          <div class="title">运营工具</div>
          <div class="sub">产品资料 · 我的知识库 · 视频评价预测 · 视频营销检测 · 反推提示词</div>
        </div>
        <div v-for="g in GROUPS" :key="g.group" class="group-block">
          <div class="group-label">{{ g.group }}</div>
          <div class="grid">
            <button
              v-for="t in g.tools"
              :key="t.id"
              type="button"
              class="card"
              :class="{ 'is-disabled': t.disabled }"
              :style="{ '--card-accent': t.accent }"
              :disabled="t.disabled"
              @click="openTool(t)"
            >
            <span v-if="t.disabled" class="badge">建设中</span>
            <div class="card-top">
              <div class="icon" :style="{ background: t.accent }"><span>{{ t.emoji }}</span></div>
            </div>
            <div class="card-title">{{ t.title }}</div>
            <div class="card-desc">{{ t.desc }}</div>
            <div class="card-foot">
              <span class="arrow" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </button>
          </div>
        </div>
      </div>

    <!-- ═══ 工具详情（同面板内嵌展开，非弹窗） ═══ -->
    <div v-else class="page">
        <div class="bar">
          <button type="button" class="back" @click="active = null">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            返回运营工具
          </button>
          <div class="bar-title">
            <span class="bar-emoji">{{ activeTool?.emoji }}</span>
            {{ activeTool?.title }}
          </div>
        </div>
        <OtProductLibrary v-if="active === 'product-library'" />
        <OtAutoListingPanel v-else-if="active === 'auto-listing'" />
        <OtReversePromptVideo v-else-if="active === 'reverse-prompt-video'" />
      </div>
  </div>
</template>

<style scoped>
/* 全页视图布局：容器 el 为 100% 宽 × 100% 高、overflow auto 的视图区
   （tintin-bundle Tab 栏传入），本组件铺满宽度（样式与 App.vue 同基线）。 */
.root {
  width: 100%;
  min-height: 100%;
  padding: var(--space-6);
}

/* 页面入场（2026-09-25 空白修复）：无 Transition 的同步 v-if 交换 + 纯 CSS
   入场动画——离开零依赖，结构上不存在卡死点（原 out-in Transition 见上方注记） */
.page {
  display: flex;
  flex-direction: column;
  animation: page-in 0.2s var(--easing-out, cubic-bezier(0, 0, 0.2, 1));
}
@keyframes page-in {
  from { opacity: 0; transform: translateY(12px); }
}

.head { margin-bottom: var(--space-5); }
.title { margin: 0 0 var(--space-1); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--foreground); }
.sub { margin: 0; font-size: var(--font-size-body); color: var(--muted-foreground); }

.group-block { margin-bottom: var(--space-6); }
.group-block:last-child { margin-bottom: 0; }
.group-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground); margin-bottom: var(--space-3);
}

.grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); } /* 卡片 2/3（2026-10-14 用户裁决：列宽 300→200） */

/* 入场 stagger + 光晕旋转（2026-09-25 用户报障「缺原客户端动画」补齐，
   SRC OtToolCard/OpsTools 口径：stagger-in .35s + 35ms 步进、aurora-spin 8s；
   backwards 填充：延迟期显示 from 态，播完交还 transform 给 hover 抬升） */
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: calc(var(--space-5) * 2 / 3); /* 卡片 2/3（2026-10-14 用户裁决） */
  text-align: left;
  font: inherit;
  background: var(--card);
  border: none;
  border-radius: var(--radius-xl);
  cursor: pointer;
  animation: card-in 0.35s var(--easing-out, cubic-bezier(0, 0, 0.2, 1)) backwards;
  transition:
    transform var(--duration-normal) var(--easing-default),
    box-shadow var(--duration-normal) var(--easing-default),
    background var(--duration-fast);
}
.grid .card:nth-child(1) { animation-delay: 0ms; }
.grid .card:nth-child(2) { animation-delay: 35ms; }
.grid .card:nth-child(3) { animation-delay: 70ms; }
.grid .card:nth-child(4) { animation-delay: 105ms; }
.grid .card:nth-child(n + 5) { animation-delay: 140ms; }
@keyframes card-in {
  from { opacity: 0; transform: translateY(12px); }
}
.card::before {
  content: '';
  position: absolute;
  inset: -60%;
  z-index: 0;
  background: var(--card-accent, #6366f1);
  opacity: 0.07;
  filter: blur(40px);
  pointer-events: none;
  transition: opacity 0.4s;
  animation: aurora-spin 8s linear infinite;
}
@keyframes aurora-spin {
  to { transform: rotate(360deg); }
}
.card:hover::before { opacity: 0.16; }
.card > * { position: relative; z-index: 1; }
.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-3);
  background: color-mix(in srgb, var(--card) 62%, transparent);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
}
.card.is-disabled { cursor: not-allowed; }
.card.is-disabled .icon { filter: grayscale(0.6); opacity: 0.75; }
.card.is-disabled:hover { transform: none; box-shadow: none; }
.badge {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-foreground);
  background: var(--surface-container);
  border: 1px dashed var(--border);
  border-radius: 999px;
  padding: 2px 10px;
  pointer-events: none;
}
.card-top { display: flex; margin-bottom: var(--space-4); }
.icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  font-size: 26px;
  line-height: 1;
  color: #fff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
}
.card-title { margin-bottom: var(--space-2); font-size: var(--font-size-h3); font-weight: 700; line-height: var(--line-height-tight); color: var(--foreground); }
.card-desc { flex: 1 1 auto; margin: 0; font-size: var(--font-size-body); line-height: var(--line-height-body); color: var(--muted-foreground); }
.card-foot { display: flex; justify-content: flex-end; margin-top: -2px; }
.arrow {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--primary);
  background: var(--surface-container);
  transition: transform var(--duration-fast), background var(--duration-fast);
}
.card:hover:not(.is-disabled) .arrow { transform: translateX(2px); background: var(--primary); color: var(--primary-foreground); }

.bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 var(--space-3);
  font-size: 13px;
  font-weight: 500;
  color: var(--foreground);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--duration-fast);
}
.back:hover { border-color: var(--primary); color: var(--primary); }
.bar-title { display: flex; align-items: center; gap: var(--space-2); font-size: 20px; font-weight: 700; color: var(--foreground); }
.bar-emoji { font-size: 22px; line-height: 1; }

</style>
