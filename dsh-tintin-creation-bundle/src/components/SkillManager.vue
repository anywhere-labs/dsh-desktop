<!-- SkillManager.vue — 技能管理（2026-10-16 用户裁决：侧栏新增页）
     列服务端技能库（GET /skills），逐技能 安装/删除：
     安装=写入创作模式技能表（tintin.creationStudio.skills.v1，同 id 幂等），
     装完即可在「创作模式」用 /名称 调用；删除=按服务端 id 从创作技能表移除
     （只动安装来源 skill-srv-*，用户自建/内置芯片不碰）。不做服务端
     DELETE——注册表共享，客户端只读服务端。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  type ServerSkill,
  installServerSkill,
  isServerSkillInstalled,
  parseSkillsResponse,
  removeServerSkill,
  SERVER_SKILL_ID_PREFIX,
} from '../composables/skillManagerLogic'
import { loadSkills, saveSkills, type CreationSkill } from '../composables/creationStudioLogic'

/* 主题跟随宿主（同 App/OpsApp/CreationStudio 口径：宿主 dark 类 + 系统偏好，
   挂载时求值；缺 .tintin-media-scope 令牌作用域则卡片整体透明） */
const isDark = ref(false)

const loading = ref(false)
const error = ref('')
const skills = ref<ServerSkill[]>([])
const note = ref('')
const busyId = ref('')

const creationSkills = ref<CreationSkill[]>([])

function bridge(): Record<string, (path: string) => Promise<unknown>> {
  const s = (globalThis as unknown as { tintin?: { server?: Record<string, (...a: unknown[]) => Promise<unknown>> } }).tintin?.server
  if (!s) throw new Error('window.tintin.server 桥不可用（宿主未注入）')
  return s as Record<string, (path: string) => Promise<unknown>>
}

function syncInstalled(): void {
  creationSkills.value = loadSkills()
}

async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    syncInstalled()
    const res = await bridge().get('/skills')
    skills.value = parseSkillsResponse(res)
  } catch (e) {
    error.value = (e as Error).message || '服务端不可达'
    skills.value = []
  } finally {
    loading.value = false
  }
}

function installed(id: string): boolean {
  return isServerSkillInstalled(id, creationSkills.value)
}

async function install(skill: ServerSkill): Promise<void> {
  if (busyId.value) return
  busyId.value = skill.id
  try {
    // 安装升级（2026-10-16 用户裁决）=真技能包落盘+真实指令注册一体：宿主拉
    // GET /skills/{id}/download 解压到 <DSH_HOME>/skills/<id>/（重装覆盖），
    // 并带回 SKILL.md 正文——/技能名 发送即按完整说明书执行（当晚二次裁决）
    const r = await (globalThis as unknown as {
      tintin?: { server?: { skillsInstall?: (id: string) => Promise<{ error?: string; dir?: string; skillMd?: boolean; skillMdContent?: string }> } }
    }).tintin?.server?.skillsInstall?.(skill.id)
    const full = (r && !r.error && r.skillMdContent) || ''
    const pkgNote = r && !r.error
      ? `；技能包已落盘 ${r.dir}${r.skillMd ? '' : '（警告：包内缺 SKILL.md，harness 可能不识别）'}${full ? '，按完整说明书执行' : '，按注册表简介执行（包内无 SKILL.md 正文）'}`
      : `；技能包落盘失败：${r?.error || '桥不可用'}（技能按注册表简介注册可用）`
    saveSkills(installServerSkill(skill, loadSkills(), full))
    syncInstalled()
    note.value = `已安装「${skill.name}」——创作模式输入 /${skill.name} 调用${pkgNote}`
  } catch (e) {
    note.value = `安装失败：${(e as Error).message}`
  } finally {
    busyId.value = ''
  }
}

function remove(skill: ServerSkill): void {
  if (busyId.value) return
  busyId.value = skill.id
  try {
    saveSkills(removeServerSkill(skill.id, loadSkills()))
    syncInstalled()
    note.value = `已删除「${skill.name}」`
  } catch (e) {
    note.value = `删除失败：${(e as Error).message}`
  } finally {
    busyId.value = ''
  }
}

const installedCount = computed(() => skills.value.filter((s) => installed(s.id)).length)

/** 客户端技能（2026-10-16 用户裁决：两类分组）=创作技能表里非服务端派生的条目（内置+自定义） */
const clientSkills = computed(() => creationSkills.value.filter((s) => !s.id.startsWith(SERVER_SKILL_ID_PREFIX)))

onMounted(() => {
  const hostDark = document.documentElement.classList.contains('dark')
  isDark.value = hostDark || window.matchMedia('(prefers-color-scheme: dark)').matches
  void refresh()
})
</script>

<template>
  <!-- tintin-media-scope：搬运 tokens/global css 的作用域根（同 App/OpsApp/CreationStudio） -->
  <div class="tintin-media-scope skm" :class="{ dark: isDark }">
    <div class="page">
      <div class="head">
        <div class="title">技能管理</div>
        <div class="sub">服务端技能库（{{ skills.length }}）· 已安装 {{ installedCount }} · 客户端技能 {{ clientSkills.length }} —— 安装后在「创作模式」输入 /技能名 调用</div>
      </div>
      <div class="toolbar">
        <button type="button" class="refresh" :disabled="loading" @click="refresh">{{ loading ? '加载中…' : '刷新' }}</button>
        <span v-if="note" class="note">{{ note }}</span>
      </div>
      <div v-if="error" class="banner error">加载失败：{{ error }}</div>
      <div v-if="!loading && !error && skills.length === 0" class="banner">服务端技能库为空（或不可达）——点「刷新」重试。</div>

      <div class="section-title">服务端技能（GET /skills）</div>
      <div class="list">
        <div v-for="s in skills" :key="s.id" class="row">
          <div class="emoji">🧩</div>
          <div class="body">
            <div class="line1">
              <span class="name">{{ s.name }}</span>
              <span v-if="s.version" class="chip">v{{ s.version }}</span>
              <span class="chip" :title="'执行方：' + (s.executor || 'client_tool')">{{ s.executor || 'client_tool' }}</span>
              <span v-if="installed(s.id)" class="chip installed">✓ 已安装</span>
            </div>
            <div class="desc" :title="s.description">{{ s.description || '（无描述）' }}</div>
          </div>
          <div class="actions">
            <button v-if="!installed(s.id)" type="button" class="btn primary" :disabled="busyId === s.id" @click="install(s)">
              {{ busyId === s.id ? '安装中…' : '安装' }}
            </button>
            <button v-else type="button" class="btn danger" :disabled="busyId === s.id" @click="remove(s)">
              {{ busyId === s.id ? '处理中…' : '删除' }}
            </button>
          </div>
        </div>
      </div>

      <div class="section-title">客户端技能（创作模式芯片行里的内置与自定义条目）</div>
      <div class="list">
        <div v-for="c in clientSkills" :key="c.id" class="row">
          <div class="emoji">{{ c.emoji || '🧩' }}</div>
          <div class="body">
            <div class="line1">
              <span class="name">/{{ c.name }}</span>
              <span class="chip">{{ c.builtin ? '内置' : '自定义' }}</span>
              <span class="chip">{{ c.backend === 'voiceover' ? '口播' : c.backend === 'copy' ? '复制' : 'LLM' }}</span>
            </div>
            <div class="desc" :title="c.template">{{ c.template }}</div>
          </div>
        </div>
        <div v-if="clientSkills.length === 0" class="banner">客户端暂无技能（内置芯片被清空且无自定义）——到「创作模式 · 更多技能」添加。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.root { width: 100%; min-height: 100%; }
.page { width: 100%; min-height: 100%; padding: var(--space-6); box-sizing: border-box; }
.head { margin-bottom: var(--space-4); }
.title { margin: 0 0 var(--space-1); font-size: 24px; font-weight: 700; line-height: 1.2; color: var(--foreground); }
.sub { margin: 0; font-size: var(--font-size-body); color: var(--muted-foreground); }

.toolbar { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
.refresh {
  border: 1px solid var(--border); background: var(--card); color: var(--foreground);
  border-radius: var(--radius-md); padding: 6px 14px; font: inherit; cursor: pointer;
}
.refresh:disabled { opacity: 0.6; cursor: default; }
.note { font-size: 12px; color: var(--muted-foreground); }

.banner {
  border: 1px dashed var(--border); border-radius: var(--radius-md);
  padding: 12px 14px; margin-bottom: var(--space-4);
  font-size: var(--font-size-body); color: var(--muted-foreground);
}
.banner.error { color: var(--danger, #e74c3c); border-color: var(--danger, #e74c3c); }

.list { display: flex; flex-direction: column; gap: var(--space-3); }
.section-title { margin: var(--space-4) 0 var(--space-2); font-size: var(--font-size-body); font-weight: 700; color: var(--foreground); }
.row {
  display: flex; align-items: center; gap: var(--space-4);
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl);
  padding: calc(var(--space-4) * 3 / 4) var(--space-4);
}
.emoji { font-size: 28px; line-height: 1; }
.body { flex: 1 1 auto; min-width: 0; }
.line1 { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.name { font-size: var(--font-size-h4); font-weight: 700; color: var(--foreground); }
.chip {
  font-size: 11px; color: var(--muted-foreground);
  background: rgba(127, 127, 127, 0.14); border-radius: 999px; padding: 1px 8px;
}
.chip.installed { color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); font-weight: 600; }
.desc {
  margin-top: 2px; font-size: var(--font-size-body); line-height: var(--line-height-body);
  color: var(--muted-foreground);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.actions { flex: 0 0 auto; }
.btn {
  font: inherit; border-radius: var(--radius-md); padding: 6px 16px; cursor: pointer;
  border: 1px solid transparent;
}
.btn:disabled { opacity: 0.6; cursor: default; }
.btn.primary { background: var(--primary); color: var(--primary-foreground); }
.btn.danger { background: transparent; color: var(--danger, #e74c3c); border-color: var(--danger, #e74c3c); }
</style>
