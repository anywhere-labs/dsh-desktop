<script setup lang="ts">
// 媒体工具视图根组件（WP-3）：分组卡片网格 + 内嵌工具展开（全页视图，非弹窗）。
// 2026-09-24 用户裁决：分组对齐原客户端 views/MediaTools.vue（文案脚本模板/图形/
// 音频/视频 四组；智能混剪按 A1 裁决永久不移植故不列卡）；未移植卡以「建设中」
// 角标占位（不可点，恢复一张加一张卡）。已可用：文案混剪、剪映模板、声音克隆、
// 图像抠图、参考视频下载（2026-09-25 用户裁决随产品资料批次移植）；素材库
// （2026-09-29 由「音频生成」卡升级：视频/图片素材库 + 音频页原音频生成）。
import { computed, onMounted, ref, watch } from 'vue'
import CopywritingMontage from './components/media-tools/copywriting-montage/CopywritingMontage.vue'
// 剪映模板卡启用（2026-09-24 用户裁决：去掉「建设中」，可用）：组/子类目两级浏览 +
// 从剪映同步（预设/文字模板/花字/贴纸/转场/音频）+ 字体（剪映）上传
import JianYingTemplates from './components/media-tools/JianYingTemplates.vue'
// 声音克隆（2026-09-24 用户裁决移植）：样本库/Qwen3 音色/克隆合成/批量克隆
import VoiceClone from './components/media-tools/VoiceClone.vue'
// 图像抠图（2026-09-25 用户裁决移植）：POST /matting 同步抠图，PNG 落盘原图旁
import ImageMatting from './components/media-tools/ImageMatting.vue'
// 素材库（2026-09-29 用户裁决：原「音频生成」卡升级）——三 tab 视频/图片/音频：
// 图视域=服务端素材库检索/预览/多选/下载（形态对齐会话「选择素材」弹窗），
// 音频 tab=原音频生成界面与功能原样内嵌（AudioGen 随本组件挂载）
import MaterialLibrary from './components/media-tools/MaterialLibrary.vue'
// 参考视频下载（2026-09-25 用户裁决移植）：YouTube/Bilibili 链接解析 → 档位下载
// （yt-dlp 门 + 浏览器登录态 cookies）
import VideoDownload from './components/media-tools/VideoDownload.vue'
// 分镜脚本创作（2026-09-25 P2 恢复）：文案→分镜→引用素材→保存脚本库；消费产品资料卡草案信号
import OtStoryboard from './components/media-tools/OtStoryboard.vue'
// 视频转文字（2026-09-25 P2 恢复）：批量转写队列 + 听悟式字幕工作台 + 洗稿 + 四格式导出
import VideoTranscribe from './components/media-tools/VideoTranscribe.vue'
// 去水印字幕（2026-09-25 P2 恢复）：预览帧四点框选 + /vsr/remove
import SubtitleRemoval from './components/media-tools/SubtitleRemoval.vue'
// 仿视频（V3.5 · PRD-M-5，2026-10-02）：原视频→仿拍脚本→AI 素材→剪映草稿七步向导；
// 取代已退役的旧「仿爆款」卡（裁决 §11-15），整体方案与文案混剪对应（§5.3）
import ImitationVideo from './components/media-tools/ImitationVideo.vue'
// 直播切片（2026-09-25 P2 恢复）：热点发现→切片→封面/字幕（whisper+llmChat+liveclip 文件 I/O）
import LiveClip from './components/media-tools/LiveClip.vue'
// 封面制作（2026-09-25 用户裁决移植）：图层编辑 → /workflow/run + SSE 进度 →
// 结果画廊；AI 文案（/llm/chat/completions）可用，「开始生成」待服务端补
// cover 工作流端点（组件头注登记实测缺口）
import CoverMaker from './components/media-tools/CoverMaker.vue'
// 「前往分镜」跨视图跳转（2026-09-27）：产品资料文案面板写入 pendingStoryboard
// 信号后，本视图侦听并自动打开分镜脚本创作卡
import { pendingStoryboard } from './composables/pendingStoryboard'
// 工具内跨卡跳转（2026-10-09）：仿视频第 1 步「视频去字幕」等按钮写入
// 目标卡 id（pendingMediaTool），本视图侦听后切换 active（一次性消费）
import { pendingMediaTool } from './composables/pendingMediaTool'

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
    group: '文案脚本模板',
    tools: [
      { id: 'storyboard', title: '分镜脚本创作', desc: '文案 → 分镜 → 引用素材 → 保存脚本库', emoji: '🎬', accent: 'linear-gradient(135deg,#F97316 0%,#EC4899 100%)' },
      { id: 'jianying-templates', title: '剪映模板', desc: '从剪映同步的预设/文字模板/花字/贴纸/转场/音频，按分类浏览', emoji: '🎞️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#8B5CF6 100%)' },
      { id: 'video-transcribe', title: '视频转文字', desc: '视频语音自动转写', emoji: '📄', accent: 'linear-gradient(135deg,#6366F1 0%,#A855F7 100%)' },
    ],
  },
  {
    group: '图形',
    tools: [
      { id: 'cover-design', title: '封面制作', desc: '商品封面图快速制作', emoji: '🎨', accent: 'linear-gradient(135deg,#EC4899 0%,#F43F5E 100%)' },
      { id: 'image-matting', title: '图像抠图', desc: '智能抠图 / 去除背景', emoji: '✂️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#06B6D4 100%)' },
    ],
  },
  {
    group: '音频',
    tools: [
      { id: 'material-library', title: '素材库', desc: '视频 / 图片素材浏览下载，音频页含 AI 生成 BGM / 音效', emoji: '🗂️', accent: 'linear-gradient(135deg,#14B8A6 0%,#0EA5E9 100%)' },
      { id: 'voice-clone', title: '声音克隆', desc: '克隆音色生成配音', emoji: '🎵', accent: 'linear-gradient(135deg,#8B5CF6 0%,#EC4899 100%)' },
    ],
  },
  {
    group: '视频',
    tools: [
      { id: 'copywriting-montage', title: '文案混剪', desc: '按文案自动匹配素材，快速生成混剪成片', emoji: '📝', accent: 'linear-gradient(135deg,#10B981 0%,#0EA5E9 100%)' },
      { id: 'imitation-video', title: '仿爆款视频', desc: '原视频拆解 → 仿拍脚本 → AI 分镜生成 → 剪映草稿', emoji: '🎯', accent: 'linear-gradient(135deg,#F43F5E 0%,#F59E0B 100%)' },
      // 仿爆款旧卡已退役（2026-10-02 用户裁决：旧款未投产，V3.5 仿视频向导链取代；
      // 服务端 /viral/clone/* 契约面与类型保留，客户端 UI/composable/logic 移除）
      { id: 'live-slice', title: '直播切片', desc: '视频分析热点发现→切片与封面生成', emoji: '📡', accent: 'linear-gradient(135deg,#EF4444 0%,#DC2626 100%)' },
      // 视频修复占位卡已删（2026-10-06 用户裁决：卡片及功能移除；从未实现，仅禁用占位）
      { id: 'subtitle-removal', title: '视频去水印字幕', desc: '去除字幕 / 台标水印', emoji: '🔤', accent: 'linear-gradient(135deg,#F59E0B 0%,#EF4444 100%)' },
      { id: 'video-download', title: '参考视频下载', desc: '粘贴 YouTube/B 站 链接选档位下载', emoji: '⬇️', accent: 'linear-gradient(135deg,#0EA5E9 0%,#6366F1 100%)' },
    ],
  },
]

const ALL_TOOLS = GROUPS.flatMap((g) => g.tools)
const active = ref<string | null>(null)
// 「前往分镜」跨视图跳转（2026-09-27）：产品资料·文案面板写入 pendingStoryboard
// 信号后自动打开分镜脚本创作卡（信号由 OtStoryboard 挂载/在位时消费）
watch(pendingStoryboard, (v) => { if (v) active.value = 'storyboard' })
// 工具内跨卡跳转（2026-10-09）：仿视频第 1 步「视频去字幕」等按钮写入目标卡
// id 后在此切卡；立即清空（一次性消费，防残留重复触发）
watch(pendingMediaTool, (id) => {
  if (!id) return
  active.value = id
  pendingMediaTool.value = null
})
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
  <!-- tintin-media-scope：搬运的 tokens/global css 的作用域根（见 src/styles/） -->
  <div class="tintin-media-scope root" :class="{ dark: isDark }">
    <!-- ═══ 卡片网格 ═══ -->
    <!-- 2026-09-25 用户报障「卡片返回后界面空白」：原 <Transition mode="out-in">
         依赖过渡结束检测（transitionend + 双 rAF 换类），高合成器负载（卡片光晕
         无限旋转）或帧饥饿时偶发停在 leave 阶段=整页空白。改为无 Transition 的
         同步 v-if 交换 + 纯 CSS 入场动画（page-in）：结构上无离开阶段，不可能卡死。 -->
    <div v-if="!active" class="page">
      <div class="head">
        <div class="title">媒体工具</div>
        <div class="sub">选择需要执行的 AI 生产能力</div>
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
          <span v-if="t.disabled" class="badge">即将上线</span>
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
          返回媒体工具
        </button>
        <div class="bar-title">
          <span class="bar-emoji">{{ activeTool?.emoji }}</span>
          {{ activeTool?.title }}
        </div>
      </div>
      <CopywritingMontage v-if="active === 'copywriting-montage'" />
      <ImitationVideo v-else-if="active === 'imitation-video'" />
      <JianYingTemplates v-else-if="active === 'jianying-templates'" />
      <VoiceClone v-else-if="active === 'voice-clone'" />
      <OtStoryboard v-else-if="active === 'storyboard'" />
      <VideoTranscribe v-else-if="active === 'video-transcribe'" />
      <SubtitleRemoval v-else-if="active === 'subtitle-removal'" />
      <LiveClip v-else-if="active === 'live-slice'" />
      <CoverMaker v-else-if="active === 'cover-design'" />
      <ImageMatting v-else-if="active === 'image-matting'" />
      <MaterialLibrary v-else-if="active === 'material-library'" />
      <VideoDownload v-else-if="active === 'video-download'" />
    </div>
  </div>
</template>

<style scoped>
/* 全页视图布局（2026-09-23 入口裁决）：容器 el 为 100% 宽 × 100% 高、
   overflow auto 的视图区（tintin-bundle Tab 栏传入），本组件铺满宽度、
   高度按内容增长，滚动交由容器。padding 对照源 MediaTools 页。 */
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

/* 分组（2026-09-24 对齐原 MediaTools 分组 Launcher） */
.group-block { margin-bottom: var(--space-6); }
.group-block:last-child { margin-bottom: 0; }
.group-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted-foreground); margin-bottom: var(--space-3);
}

/* 全宽自适应列（宽屏两卡铺开，窄屏自动单列） */
.grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); } /* 卡片 2/3（2026-10-14 用户裁决：列宽 300→200） */

/* 卡片视觉对照源 MediaTools.vue（accent 光晕 + hover 毛玻璃），压缩到面板尺寸 */
/* 入场 stagger + 光晕旋转（2026-09-25 用户报障「缺原客户端动画」补齐，
   SRC OtToolCard/MediaTools 口径：stagger-in .35s + 35ms 步进、aurora-spin 8s；
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
.grid .card:nth-child(5) { animation-delay: 140ms; }
.grid .card:nth-child(6) { animation-delay: 175ms; }
.grid .card:nth-child(7) { animation-delay: 210ms; }
.grid .card:nth-child(8) { animation-delay: 245ms; }
.grid .card:nth-child(n + 9) { animation-delay: 280ms; }
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

/* 工具详情顶栏（对照源 tool-bar 压缩版） */
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

/* 网格 ↔ 详情 切换（对照源 slide-up，缩短位移适配面板） */
</style>

<style>
/* 弹层定位说明（2026-09-24 二次修正）：向导弹层（高级脚本设置/选择分镜脚本/
   素材选择/删除确认等）teleport 到 `.tintin-media-scope` 根元素——不再用 body。
   原因：teleport 到 body 会脱离 .tintin-media-scope 令牌作用域，var(--card) 等
   全部解析为空 → 弹窗背景透明（第一版 body>modal-mask z-index 覆盖还曾因
   特异度低于 scoped 规则而失效，弹窗被覆盖层压住不可见）。改挂到 scope 根后
   令牌/暗色/全局样式自动继承；弹层 fixed 全屏、z 1002 在覆盖层堆叠上下文内
   高于向导内容。已知取舍：顶部 Tab 栏（9999）仍高于弹层蒙层，弹窗打开时
   Tab 栏不被蒙住（原版为全窗变暗，此处为作用域化的必要让步）。 */
</style>
