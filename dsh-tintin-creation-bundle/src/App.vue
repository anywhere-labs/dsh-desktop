<!-- CreationStudio.vue — 创作模式（2026-10-16，按即梦真身逆向重建）
     逆向依据：即梦桌面端 1.0.53 运行态 CDP 提取（composer DOM/技能市场字典/
     创作类型下拉「Agent 模式/图片生成/视频生成/音乐生成/音频生成/数字人/动作
     模仿」），视觉基准 D:/tmp/jimeng-entry-reference.png；字典条目=即梦技能
     市场真实数据（creationStudioLogic.CREATION_CATALOG）。
     功能后端=本服务端（用户裁决）：Agent 模式→/llm/chat/completions（已接）、
     口播技能→/copywriting/voiceover（已接）；图片/视频等类型输出该类型的
     创作提示词方案（媒体生成服务端对接见需求文档 P4）。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useHostDark } from './composables/hostTheme'
// 服务端桥与产品库访问：创作包独立域（creationServer），URL 拼装只在本层
import {
  fetchProducts,
  fetchSubjectProductDetail,
  fetchVoiceoverCandidates,
  getTintin,
  searchErrorText,
  type PickerItem,
  type VoiceoverCandidate,
} from './composables/creationServer'
import {
  BUILTIN_CREATION_SKILLS,
  CREATION_CATALOG,
  CREATION_CATALOG_CATEGORIES,
  CREATION_TYPES,
  type CreationCatalogEntry,
  type CreationSkill,
  type CreationSubject,
  autoChipLabel,
  buildLlmMessages,
  buildVoiceoverRequest,
  catalogToSkill,
  completeAtMention,
  completeSlashMention,
  activeTokenAt,
  composeCreationPrompt,
  creationSystemPrompt,
  effectiveBackend,
  filterSkills,
  findSkillByName,
  llmTextFromResponse,
  loadSkills,
  loadCreationPrefs,
  newSkillId,
  resetSkills,
  saveSkills,
  saveCreationPrefs,
  TOOL_OPTIONS,
  toolLabel,
  CREATION_RATIOS,
  type CreationPrefs,
} from './composables/creationStudioLogic'
// 上传引用池：独立域（缩略图行 + 可能@的菜单 + 对话框），逻辑见 creationReferenceLogic
import CreationReferences from './components/CreationReferences.vue'
import {
  type CreationReference,
  atQueryFrom,
  mergeReferencePaths,
  referencesBlock,
} from './composables/creationReferenceLogic'
// 会话历史：读写收在 creationHistoryLogic（本地存储；服务端端点就绪后只换那一层）
import CreationHistory from './components/CreationHistory.vue'
import {
  type CreationHistoryEntry,
  appendCreationHistory,
  buildHistoryEntry,
  clearCreationHistory,
  loadCreationHistory,
  saveCreationHistory,
} from './composables/creationHistoryLogic'
import { SERVER_SKILL_ID_PREFIX } from './composables/skillManagerLogic'

/* 主题跟随宿主（2026-10-18 报障修正）：原生有效暗色=body[data-ds-dark-theme]
   （应用内偏好可≠系统偏好），旧 html.dark 链原生从不打——useHostDark 判定
   +监听。缺了 .tintin-media-scope 令牌作用域，--card/--border 等全部未定义，
   输入会话卡片会整体透明——2026-10-16 用户报障「没有输入框」的根因之一。 */
const isDark = useHostDark()
onMounted(() => {
  skills.value = loadSkills()
  // 会话历史恢复（2026-10-18 用户裁决）：重载后最近一轮结果自动回浮层
  history.value = loadCreationHistory()
  const last = history.value[0]
  if (last?.resultText) { previewText.value = last.resultText; previewOpen.value = true }
  // 技能管理「＋ 添加 skill」跨视图跳转（2026-10-18 改版）：打开技能市场
  window.__tintinBus?.on('tintin:open-market', () => openMarket())
})

/* ── 技能预设（芯片行=用户已添加；字典=内置市场目录） ── */
const skills = ref<CreationSkill[]>([])
function persist(): void { saveSkills(skills.value) }
function isAdded(entry: CreationCatalogEntry): boolean {
  return skills.value.some((s) => s.name === entry.name)
}
function toggleCatalogSkill(entry: CreationCatalogEntry): void {
  if (isAdded(entry)) {
    skills.value = skills.value.filter((s) => s.name !== entry.name)
    if (selectedSkillId.value === `skill-${entry.id}`) selectedSkillId.value = null
  } else {
    skills.value.push(catalogToSkill(entry))
  }
  persist()
}

/* ── 编辑器状态 ── */
const input = ref('')
const selectedSkillId = ref<string | null>(null)
const subjects = ref<CreationSubject[]>([])
const creationTypeId = ref('agent')
const creationTypeLabel = computed(() => CREATION_TYPES.find((t) => t.id === creationTypeId.value)?.label ?? 'Agent 模式')
const selectedSkill = computed<CreationSkill | null>(
  () => skills.value.find((s) => s.id === selectedSkillId.value) ?? null,
)

/* ── / 技能下拉 ── */
const skillMenuOpen = ref(false)
const skillQuery = ref('')
const filteredSkills = computed(() => filterSkills(skills.value, skillQuery.value))
// 技能下拉两类（2026-10-16 用户裁决）：服务端=skill-srv 派生条目；客户端=内置+自定义
const filteredServerSkills = computed(() => filteredSkills.value.filter((s) => s.id.startsWith(SERVER_SKILL_ID_PREFIX)))
const filteredClientSkills = computed(() => filteredSkills.value.filter((s) => !s.id.startsWith(SERVER_SKILL_ID_PREFIX)))

// ── 生成偏好（2026-10-16 用户裁决：「自动」可点选——即梦生成偏好面板同款；
//    状态持久化，P4 媒体生成对接后作为生成参数消费）──
const autoMenuOpen = ref(false)
const prefs = ref<CreationPrefs>(loadCreationPrefs())
/** 菜单开关统一 toggle（2026-10-17 用户裁决：点一次开、再点关、再点开） */
function openAutoMenu(): void {
  if (autoMenuOpen.value) { autoMenuOpen.value = false; return }
  typeMenuOpen.value = false
  skillMenuOpen.value = false
  subjectMenuOpen.value = false
  atMenuOpen.value = false
  autoMenuOpen.value = true
}
function setPrefs(patch: Partial<CreationPrefs>): void {
  prefs.value = { ...prefs.value, ...patch }
  saveCreationPrefs(prefs.value)
}
function openSkillMenu(): void {
  if (skillMenuOpen.value) { skillMenuOpen.value = false; return } // toggle（2026-10-17 用户裁决）
  skillQuery.value = ''
  autoMenuOpen.value = false
  atMenuOpen.value = false
  typeMenuOpen.value = false
  subjectMenuOpen.value = false
  skillMenuOpen.value = true
}
function onInputChange(e?: Event): void {
  // / 与 @ 双触发（2026-10-17 用户裁决：/ =技能，@=引用/主体）。方案 1+4 落地
  // （同日裁决）：提及常驻文本，触发只认光标处活跃词——已完成的提及不再把
  // 菜单随按键反复唤起；@ 菜单=上传引用+产品库混合（产品侧同步搜产品库）。
  const el = e?.target as HTMLTextAreaElement | null
  const caret = el && typeof el.selectionStart === 'number' ? el.selectionStart : input.value.length
  autoMenuOpen.value = false
  typeMenuOpen.value = false
  subjectMenuOpen.value = false
  const token = activeTokenAt(input.value, caret)
  if (token.startsWith('/')) {
    atMenuOpen.value = false
    skillQuery.value = token.slice(1)
    skillMenuOpen.value = true
  } else if (token.startsWith('@')) {
    skillMenuOpen.value = false
    atMenuOpen.value = true
    subjectQuery.value = token.slice(1)
    void searchSubjects()
  } else {
    skillMenuOpen.value = false
    atMenuOpen.value = false
  }
}
function chooseSkill(skill: CreationSkill): void {
  selectedSkillId.value = skill.id
  skillMenuOpen.value = false
  // 方案 1（2026-10-17 用户裁决）：/ 选中=内联补全技能引用（与 @ 对称），
  // 不再剥令牌；模板组包机制不变——提及只是文本里的可见指针。
  input.value = completeSlashMention(input.value, skill.name)
}
function toggleSkillByName(name: string): void {
  const hit = findSkillByName(skills.value, name)
  if (hit) chooseSkill(hit)
}

/* ── 创作类型下拉（即梦「Agent 模式」select 同款字典） ── */
const typeMenuOpen = ref(false)
function openTypeMenu(): void {
  autoMenuOpen.value = false
  atMenuOpen.value = false
  skillMenuOpen.value = false
  subjectMenuOpen.value = false
  typeMenuOpen.value = !typeMenuOpen.value
}
function chooseType(id: string): void {
  creationTypeId.value = id
  typeMenuOpen.value = false
}

/* ── 输入 @ = 从上传引用选择（2026-10-17 用户裁决，即梦「可能@的内容」同款）：
 *    菜单与引用池缩略图行自包含在 CreationReferences 子组件（独立域不与本
 *    文件交织）；本层只持池状态、@ 过滤词与四类接线。工具栏 @ 按钮=选择
 *    产品（产品库），两条 @ 线路语义不同、互不混用。 ── */
const atMenuOpen = ref(false)
const atQuery = computed(() => atQueryFrom(input.value))
function insertAtReference(name: string): void {
  input.value = completeAtMention(input.value, name)
  atMenuOpen.value = false
}
function onRefAdd(paths: string[]): void {
  references.value = mergeReferencePaths([], paths)
}
function onRefRemove(path: string): void {
  references.value = references.value.filter((x) => x.path !== path)
}
function onRefCreate(name: string): void {
  addSubject(name)
  input.value = completeAtMention(input.value, name)
  atMenuOpen.value = false
}
/** 产品主体入池缩略卡（2026-10-18 用户裁决：文件池统一出预览——产品=六视图
 *  封面，详情未回前 📦 占位；名称主体无图不出卡，芯片行仍是身份锚）。 */
const attachedProducts = computed(() => subjects.value
  .filter((s) => s.product?.id)
  .map((s) => ({ id: s.id, name: s.name, cover: s.product?.sixViews?.[0]?.url })))
function onRefProductRemove(id: string): void {
  subjects.value = subjects.value.filter((s) => s.id !== id)
}

/* ── @ 主体（产品库搜索 + 手动兜底） ── */
const subjectMenuOpen = ref(false)
const subjectQuery = ref('')
const subjectLoading = ref(false)
const subjectError = ref('')
const subjectHits = ref<Array<{ id: string; name: string; item: PickerItem }>>([])
async function searchSubjects(): Promise<void> {
  const kw = subjectQuery.value.trim()
  subjectLoading.value = true
  subjectError.value = ''
  try {
    const items: PickerItem[] = await fetchProducts(kw)
    subjectHits.value = items.slice(0, 50).map((it, i) => ({
      id: String(it.id ?? it.product_id ?? `p-${i}`),
      name: String(it.name ?? it.model ?? it.brand ?? `主体${i + 1}`),
      item: it,
    }))
    if (subjectHits.value.length === 0) subjectError.value = kw ? '没有匹配的产品，可直接回车手动添加' : '产品库为空，可直接回车手动添加'
  } catch (error) {
    subjectError.value = searchErrorText(error)
    subjectHits.value = []
  } finally {
    subjectLoading.value = false
  }
}
function openSubjectMenu(): void {
  if (subjectMenuOpen.value) { subjectMenuOpen.value = false; return } // toggle（2026-10-17 用户裁决）
  autoMenuOpen.value = false
  atMenuOpen.value = false
  typeMenuOpen.value = false
  skillMenuOpen.value = false
  subjectQuery.value = ''
  subjectHits.value = []
  subjectError.value = ''
  subjectMenuOpen.value = true
  void searchSubjects()
}
function addSubject(name: string): void {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return
  if (subjects.value.some((s) => s.name === trimmed)) return
  subjects.value.push({ id: `sub-${Date.now().toString(36)}-${subjects.value.length}`, name: trimmed })
}
/** 选主体（带产品档案，2026-10-16 用户裁决）：芯片立即可见（型号级），详情
 *  （卖点/参数/六视图）异步补齐——接口失败只影响该芯片的悬停卡（2026-10-12 裁决口径） */
function addSubjectFromHit(hit: { id: string; name: string; item: PickerItem }): void {
  const name = String(hit.name ?? '').trim()
  if (!name || subjects.value.some((s) => s.name === name)) return
  const productId = String(hit.item.id ?? hit.item.product_id ?? hit.id)
  const subject: CreationSubject = { id: `sub-${Date.now().toString(36)}-${subjects.value.length}`, name, product: { id: productId } }
  const model = String(hit.item.model ?? '').trim()
  if (model) subject.product!.model = model
  subjects.value.push(subject)
  void fillSubjectProduct(subject)
}
/** @ 菜单选产品（2026-10-17 方案 4 用户裁决）：内联补全 @提及 + 落主体芯片。
 *  上下文注入仍走 subjectsBlock 单一真源，内联提及只是文本里的可见指针。 */
function pickAtProduct(p: { id: string; name: string }): void {
  const hit = subjectHits.value.find((h) => h.id === p.id)
  if (hit) addSubjectFromHit(hit)
  input.value = completeAtMention(input.value, p.name)
  atMenuOpen.value = false
}
/** @ 主体产品档案：详情+六视图 URL 绝对化在 creationServer.fetchSubjectProductDetail
 *  （URL 拼装只在该层，IRON-06）；失败保持型号级档案不冲界面（2026-10-12 裁决） */
async function fillSubjectProduct(subject: CreationSubject): Promise<void> {
  if (!subject.product?.id) return
  try {
    const detail = await fetchSubjectProductDetail(subject.product.id)
    const target = subjects.value.find((s) => s.id === subject.id)
    if (!target) return
    target.product = { ...target.product, ...detail }
  } catch { /* 详情拉取失败：保持型号级档案，不冲界面 */ }
}
function addSubjectFromQuery(): void {
  addSubject(subjectQuery.value)
  subjectQuery.value = ''
}

/* ── 发送：后端路由（llm / voiceover / copy）+ 创作类型 ── */
const notice = ref('')
const noticeOk = ref(false)
const generating = ref(false)

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (_) {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch (_) {
      return false
    }
  }
}

function failNotice(message: string): void {
  noticeOk.value = false
  notice.value = message
}

async function generateViaLlm(prompt: string): Promise<string> {
  // 桥契约：llmChat 挂在 server 命名空间（window.tintin.server.llmChat，client.js
  // server 块），顶层无此成员——2026-10-18 报障：顶层检查恒空把连接正常误报成
  // 「服务端 LLM 不可用」，与识别/克隆/混剪等已验证调用方同口径改 server 路径。
  const t = getTintin()
  if (!t?.server?.llmChat) throw new Error('服务端 LLM 不可用，请检查「设置 → 服务端」的连接。')
  const system = creationSystemPrompt(creationTypeId.value, creationTypeLabel.value)
  const res = await t.server.llmChat({ messages: buildLlmMessages(prompt, system) })
  if (res && typeof res === 'object' && 'error' in (res as Record<string, unknown>)) {
    throw new Error(String((res as Record<string, unknown>).error || '生成失败'))
  }
  const text = llmTextFromResponse(res)
  if (!text) throw new Error('生成结果为空，请重试或改写输入。')
  return text
}

const voiceoverCandidates = ref<VoiceoverCandidate[]>([])
const voiceoverPickedIdx = ref(0)

async function generateViaVoiceover(): Promise<string> {
  const req = buildVoiceoverRequest({ skill: selectedSkill.value!, input: input.value, subjects: subjects.value })
  const { candidates, failedFormulas } = await fetchVoiceoverCandidates(req)
  if (candidates.length === 0) {
    const failed = failedFormulas.length > 0 ? `（失败写法：${failedFormulas.join('、')}）` : ''
    throw new Error(`口播生成无可用结果${failed}`)
  }
  voiceoverCandidates.value = candidates
  voiceoverPickedIdx.value = 0
  return candidates.length > 1 ? '' : candidates[0]!.text
}

const previewOpen = ref(false)
const previewText = ref('')

/* ── 会话历史（2026-10-18 用户裁决：结果本地保存）——记录/持久化在发送链，
 *    列表回看/重开/清空在 CreationHistory 子组件；存储实现=creationHistoryLogic
 *    （服务端 /api/creation/sessions 就绪后只换那一层，调用方不动） ── */
const history = ref<CreationHistoryEntry[]>([])
/** 入史附带的发送上下文（可选字段空值不出键——exactOptional 口径） */
function historyContext(): { skillName?: string; typeLabel?: string; subjects?: string[]; references?: string[] } {
  const skillName = selectedSkill.value?.name
  const typeLabel = creationTypeId.value === 'agent' ? undefined : creationTypeLabel.value
  return {
    ...(skillName ? { skillName } : {}),
    ...(typeLabel ? { typeLabel } : {}),
    subjects: subjects.value.map((s) => s.name),
    references: references.value.map((r) => r.name),
  }
}
function recordHistory(source: CreationHistoryEntry['source'], resultText: string, extra?: { formula?: string }): void {
  history.value = appendCreationHistory(history.value, buildHistoryEntry({
    source,
    input: input.value.trim(),
    resultText,
    ...historyContext(),
    ...(extra?.formula ? { formula: extra.formula } : {}),
  }))
  saveCreationHistory(history.value)
}
function reopenHistory(entry: CreationHistoryEntry): void {
  previewText.value = entry.resultText
  previewOpen.value = true
}
function clearHistory(): void {
  history.value = []
  clearCreationHistory()
}

const references = ref<CreationReference[]>([])
/** 引用池缩略图/上下文附注由 CreationReferences 子组件 + 本层四接线承担；
 *  预览 URL/类型判定/@ 解析/组包在 creationReferenceLogic（独立域） */
/** 上传参考（2026-10-16 用户报障：+ 按钮不起作用）——多选图片/视频入参考列表；
 *  发送时作为上下文附注进提示词，媒体生成对接（P4）后直接作为生成输入 */
async function send(): Promise<void> {
  if (generating.value) return
  const backend = effectiveBackend(selectedSkill.value)
  const prompt = composeCreationPrompt({ skill: selectedSkill.value, input: input.value, subjects: subjects.value })
    + referencesBlock(references.value.map((r) => r.name))
  if (!prompt.trim() && backend !== 'voiceover') {
    failNotice('先写点想法，或选一个技能再发送')
    return
  }
  if (backend === 'copy') {
    const copied = await copyText(prompt)
    noticeOk.value = true
    notice.value = copied ? '提示词已复制到剪贴板。' : '提示词已生成（复制失败，可在下方手动复制）。'
    previewText.value = prompt
    previewOpen.value = true
    recordHistory('copy', prompt)
    return
  }
  generating.value = true
  noticeOk.value = true
  notice.value = backend === 'voiceover' ? '正在生成口播文案…' : 'AI 正在创作…'
  previewOpen.value = false
  try {
    let text: string
    if (backend === 'voiceover') {
      text = await generateViaVoiceover()
      if (!text) {
        noticeOk.value = true
        notice.value = `已生成 ${voiceoverCandidates.value.length} 稿，点击挑选一条。`
        return
      }
    } else {
      text = await generateViaLlm(prompt)
    }
    recordHistory(backend, text)
    noticeOk.value = true
    notice.value = (await copyText(text)) ? '已生成并复制到剪贴板。' : '已生成（复制失败，可在下方手动复制）。'
    previewText.value = text
    previewOpen.value = true
  } catch (error) {
    failNotice(error instanceof Error ? error.message : String(error))
  } finally {
    generating.value = false
  }
}

function pickVoiceoverCandidate(): void {
  const c = voiceoverCandidates.value[voiceoverPickedIdx.value]
  if (!c) return
  recordHistory('voiceover', c.text, c.formula ? { formula: c.formula } : undefined)
  noticeOk.value = true
  notice.value = (c.formula ? `已选「${c.formula}」，` : '') + '可复制或重新挑选。'
  previewText.value = c.text
  previewOpen.value = true
}

function regenerate(): void {
  if (generating.value) return
  void send()
}

/** 打开技能绑定的工具卡（跨视图：先切 chrome 到媒体工具，再发跨卡信号） */
function openBoundTool(): void {
  const tool = selectedSkill.value?.tool
  if (!tool) return
  previewOpen.value = false
  notice.value = ''
  // 跨插件：先切 chrome 到媒体工具视图，再经窗口总线请求打开媒体工具卡
  const activate = (window as unknown as { __tintinActivateView?: (id: string) => void }).__tintinActivateView
  activate?.('media')
  window.__tintinBus?.emit('tintin:media-tool', tool)
}

/* ── 技能市场（更多技能：分类字典页，对照即梦技能市场） ── */
const marketOpen = ref(false)
const marketCategory = ref<CreationCatalogEntry['category'] | '全部'>('全部')
const marketEntries = computed(() => {
  if (marketCategory.value === '全部') return CREATION_CATALOG
  return CREATION_CATALOG.filter((e) => e.category === marketCategory.value)
})
function openMarket(): void {
  marketOpen.value = true
  skillMenuOpen.value = false
  typeMenuOpen.value = false
}

/* ── 技能管理（编辑/删除内置与自定义）── 工具卡字典 TOOL_OPTIONS/toolLabel
 *  在 creationStudioLogic（技能域字典与编辑器下拉共用） */
const editorOpen = ref(false)
const editing = ref<CreationSkill | null>(null)
const editingTool = ref<string>('')
const editingBackend = ref<'llm' | 'voiceover' | 'copy'>('llm')
function startEdit(skill: CreationSkill): void {
  editing.value = { ...skill }
  editingTool.value = skill.tool ?? ''
  editingBackend.value = skill.backend ?? 'llm'
}
function saveEditing(): void {
  const draft = editing.value
  if (!draft) return
  if (!draft.name.trim() || !draft.template.trim()) return
  const next = {
    ...draft,
    name: draft.name.trim(),
    template: draft.template,
    backend: (editingBackend.value === 'llm' ? undefined : editingBackend.value) as CreationSkill['backend'],
    ...(editingTool.value ? { tool: editingTool.value as CreationSkill['tool'] } : {}),
  }
  const index = skills.value.findIndex((s) => s.id === next.id)
  if (index >= 0) skills.value.splice(index, 1, next)
  else skills.value.push(next)
  persist()
  editing.value = null
}
function removeSkill(skill: CreationSkill): void {
  if (skill.builtin) return
  skills.value = skills.value.filter((s) => s.id !== skill.id)
  if (selectedSkillId.value === skill.id) selectedSkillId.value = null
  persist()
}
</script>

<template>
  <!-- tintin-media-scope：搬运的 tokens/global css 的作用域根（同 App/OpsApp）；
       独立视图也必须挂这层，否则设计令牌全部失效 -->
  <div class="tintin-media-scope studio" :class="{ dark: isDark }">
    <!-- 生成/画布 pill（即梦同款居中切换） -->
    <div class="greet">
      <div class="greet-title">你好，今天想要创作什么?</div>
      <div class="greet-tabs">
        <button type="button" class="tab is-active">生成</button>
        <button type="button" class="tab is-disabled" disabled title="画布模式暂未开放">画布</button>
      </div>
    </div>

    <!-- 输入会话卡片 -->
    <div class="composer">
      <div class="composer-main">
        <div class="editor-wrap">
          <div v-if="selectedSkill" class="picked-row">
            <span class="picked-chip">
              <span>{{ selectedSkill.emoji }}</span> /{{ selectedSkill.name }}
              <button type="button" class="chip-x" @click="selectedSkillId = null">×</button>
            </span>
          </div>
          <div v-if="subjects.length" class="picked-row">
            <span v-for="s in subjects" :key="s.id" class="subject-chip">
              @{{ s.name }}
              <button type="button" class="chip-x" @click="subjects = subjects.filter((x) => x.id !== s.id)">×</button>
              <span v-if="s.product" class="subject-card">
                <span class="sc-line sc-head">🧾 {{ s.product.model || s.name }}<template v-if="s.product.brand"> · {{ s.product.brand }}</template></span>
                <span v-if="s.product.sixViews?.length" class="sc-views">
                  <img v-for="v in s.product.sixViews.slice(0, 6)" :key="v.view" :src="v.url" :title="v.view" class="sc-thumb" loading="lazy">
                </span>
                <span v-if="s.product.sellingPoints?.length" class="sc-line">卖点：{{ s.product.sellingPoints.join('；') }}</span>
                <span v-if="s.product.features?.length" class="sc-line">参数：{{ s.product.features.join('；') }}</span>
                <span class="sc-foot">产品档案已注入创作上下文（六视图：{{ s.product.sixViews?.length ?? 0 }} 张）</span>
              </span>
            </span>
          </div>
          <!-- 上传引用池：缩略图行 + 可能@的菜单（自包含子组件，独立域）；
               产品库命中由父层搜索（subjectHits 单一状态）分组下发（方案 4） -->
          <CreationReferences
            :references="references"
            :menu-open="atMenuOpen"
            :query="atQuery"
            :products="subjectHits"
            :products-loading="subjectLoading"
            :products-error="subjectError"
            :attached="attachedProducts"
            @add="onRefAdd"
            @remove="onRefRemove"
            @pick-ref="insertAtReference"
            @pick-product="pickAtProduct"
            @create-subject="onRefCreate"
            @remove-product="onRefProductRemove"
          />
          <div class="editor-box">
            <textarea v-model="input" class="input" rows="3" @input="onInputChange" @keydown.enter.exact.prevent="send" />
            <div v-if="!input" class="placeholder" aria-hidden="true">
              输入想法、剧本或上传参考，支持 <i class="ph">/</i> 使用技能，<i class="ph at">@</i> 添加主体，和 Agent 一起创作
            </div>
          </div>
        </div>
      </div>
      <div class="toolbar">
        <!-- 创作类型（即梦「Agent 模式」select 同款字典） -->
        <span class="toolbar-item is-select" role="button" tabindex="0" :class="{ 'is-open': typeMenuOpen }" @click="openTypeMenu" @keydown.enter.prevent="openTypeMenu">
          <i class="ti">⚡</i>{{ creationTypeLabel }}<i class="caret">▾</i>
        </span>
        <button type="button" class="toolbar-item" :class="{ 'is-open': autoMenuOpen }" title="生成偏好" @click="openAutoMenu"><i class="ti">⚙</i>{{ autoChipLabel(prefs) }}</button>
        <button type="button" class="toolbar-item" :class="{ 'is-open': skillMenuOpen }" @click="openSkillMenu"><i class="ti">✂</i>技能</button>
        <button type="button" class="toolbar-item" :class="{ 'is-open': subjectMenuOpen }" @click="openSubjectMenu"><i class="ti at">@</i>⁺</button>
        <span class="spacer" />
        <!-- 语音输入暂时隐藏（2026-10-16 用户裁决；解禁时删掉 v-if 即可恢复）
        <span class="toolbar-item is-static" title="语音输入（即将支持）"><i class="ti">🎤</i></span>
        -->
        <button type="button" class="send" :disabled="generating || (!input.trim() && effectiveBackend(selectedSkill) !== 'voiceover')" :title="generating ? '生成中…' : '发送'" @click="send">
          <svg v-if="!generating" class="send-ico" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 13.2V3.4" />
            <path d="M3.6 7.6 8 3.2l4.4 4.4" />
          </svg>
          <span v-else class="send-wait"><i></i><i></i><i></i></span>
        </button>
      </div>

      <!-- 创作类型下拉 -->
      <div v-if="typeMenuOpen" class="menu">
        <div class="menu-title">创作类型</div>
        <div class="menu-list">
          <button v-for="t in CREATION_TYPES" :key="t.id" type="button" class="menu-item" :class="{ 'is-picked': t.id === creationTypeId }" @click="chooseType(t.id)">
            <span class="menu-name">{{ t.label }}</span>
            <span v-if="t.id === creationTypeId" class="menu-check">✓</span>
          </button>
        </div>
      </div>

      <!-- 生成偏好（即梦「自动」面板同款：自动开关+图片/视频+选择比例；2026-10-16 用户裁决） -->
      <div v-if="autoMenuOpen" class="menu menu-auto">
        <div class="menu-head">
          <span class="menu-head-title">生成偏好</span>
          <label class="auto-switch" title="跟随默认自动偏好">
            <input type="checkbox" :checked="prefs.auto" @change="setPrefs({ auto: ($event.target as HTMLInputElement).checked })"><i></i><span>自动</span>
          </label>
          <button type="button" class="menu-close" @click="autoMenuOpen = false">×</button>
        </div>
        <div class="seg-tabs">
          <button type="button" :class="{ on: prefs.modality === 'image' }" @click="setPrefs({ modality: 'image' })">图片</button>
          <button type="button" :class="{ on: prefs.modality === 'video' }" @click="setPrefs({ modality: 'video' })">视频</button>
        </div>
        <div class="ratio-title">选择比例</div>
        <div class="ratio-grid">
          <button v-for="r in CREATION_RATIOS" :key="r" type="button" class="ratio-tile" :class="{ on: prefs.ratio === r }" @click="setPrefs({ ratio: r })">
            <i v-if="r === '智能'" class="ratio-glyph ratio-auto">✦</i>
            <i v-else class="ratio-frame" :style="{ aspectRatio: r.replace(':', '/') }"></i>
            <span>{{ r }}</span>
          </button>
        </div>
      </div>

      <!-- / 技能下拉 -->
      <div v-if="skillMenuOpen" class="menu">
        <div class="menu-head">
          <input v-model="skillQuery" class="menu-search" placeholder="搜索已添加的技能…" @keydown.enter.prevent="() => { const hit = filteredSkills[0]; if (hit) chooseSkill(hit) }">
          <button type="button" class="menu-close" @click="skillMenuOpen = false">×</button>
        </div>
        <div class="menu-list">
          <div class="menu-group-title">服务端技能（已安装）</div>
          <button v-for="s in filteredServerSkills" :key="s.id" type="button" class="menu-item" @click="chooseSkill(s)">
            <span class="menu-emoji">{{ s.emoji }}</span>
            <span class="menu-name">/{{ s.name }}</span>
            <span class="menu-tool">服务端</span>
          </button>
          <div class="menu-group-title">客户端技能</div>
          <button v-for="s in filteredClientSkills" :key="s.id" type="button" class="menu-item" @click="chooseSkill(s)">
            <span class="menu-emoji">{{ s.emoji }}</span>
            <span class="menu-name">/{{ s.name }}</span>
            <span v-if="s.badge" class="menu-badge" :class="`badge-${s.badge.toLowerCase()}`">{{ s.badge }}</span>
            <span class="menu-tool">{{ s.tool ? '直达工具' : 'AI 生成' }}</span>
          </button>
          <div v-if="filteredSkills.length === 0" class="menu-empty">没有匹配的技能——到「更多技能」添加，或在「技能管理」安装服务端技能</div>
        </div>
        <button type="button" class="menu-more" @click="openMarket">技能市场 / 管理 ›</button>
      </div>

      <!-- @ 主体下拉 -->
      <div v-if="subjectMenuOpen" class="menu">
        <div class="menu-head">
          <input v-model="subjectQuery" class="menu-search" placeholder="搜索产品库或输入名称…" @keydown.enter.prevent="addSubjectFromQuery" @input="searchSubjects">
          <button type="button" class="menu-close" @click="subjectMenuOpen = false">×</button>
        </div>
        <div class="menu-list">
          <div v-if="subjectLoading" class="menu-empty">搜索中…</div>
          <template v-else>
            <button v-for="p in subjectHits" :key="p.id" type="button" class="menu-item" @click="addSubjectFromHit(p); subjectMenuOpen = false">
              <span class="menu-emoji">📦</span>
              <span class="menu-name">@{{ p.name }}</span>
              <span v-if="String(p.item.model ?? '')" class="menu-tool">{{ p.item.model }}</span>
            </button>
            <button v-if="subjectQuery.trim()" type="button" class="menu-item" @click="addSubjectFromQuery(); subjectMenuOpen = false">
              <span class="menu-emoji">➕</span>
              <span class="menu-name">手动添加「@{{ subjectQuery.trim() }}」</span>
            </button>
            <div v-if="!subjectHits.length && !subjectQuery.trim()" class="menu-empty">{{ subjectError || '输入名称搜索或手动添加' }}</div>
          </template>
        </div>
        <div v-if="subjects.length" class="menu-foot">已选 {{ subjects.length }} 个主体</div>
      </div>
    </div>

    <!-- 发送反馈 -->
    <div v-if="notice" class="notice" :class="{ 'is-ok': noticeOk, 'is-err': !noticeOk }">
      <span>{{ notice }}</span>
      <button v-if="noticeOk && voiceoverCandidates.length > 1 && previewOpen" type="button" class="notice-go" @click="previewOpen = false">重挑候选</button>
      <button v-if="noticeOk && selectedSkill?.tool && previewOpen" type="button" class="notice-go" @click="openBoundTool">打开「{{ toolLabel(selectedSkill.tool) }}」→</button>
      <button type="button" class="notice-x" @click="notice = ''">×</button>
    </div>
    <!-- 口播多稿候选 -->
    <div v-if="voiceoverCandidates.length > 1 && !previewOpen" class="candidates">
      <div class="preview-head">口播候选（{{ voiceoverCandidates.length }} 稿，点击选用）</div>
      <button v-for="(c, i) in voiceoverCandidates" :key="i" type="button" class="candidate" :class="{ 'is-picked': i === voiceoverPickedIdx }" @click="voiceoverPickedIdx = i; pickVoiceoverCandidate()">
        <span class="candidate-formula">{{ c.formula || `稿 ${i + 1}` }}</span>
        <span class="candidate-text">{{ c.text }}</span>
        <span class="candidate-meta">{{ c.chars }} 字<template v-if="c.durationS"> · 约 {{ c.durationS }}s</template></span>
      </button>
    </div>
    <!-- 生成/组合结果预览 -->
    <div v-if="previewOpen" class="preview">
      <div class="preview-head">
        <span>{{ generating ? '正在生成…' : (effectiveBackend(selectedSkill) === 'copy' ? '组合后的提示词（可复制去工作台对话直接使用）' : '生成结果（可编辑/复制）') }}</span>
        <span class="preview-ops">
          <button type="button" class="mini" @click="copyText(previewText)">复制</button>
          <button v-if="effectiveBackend(selectedSkill) !== 'copy'" type="button" class="mini" :disabled="generating" @click="regenerate">重新生成</button>
        </span>
      </div>
      <textarea v-model="previewText" class="preview-body" rows="6" />
    </div>

    <!-- 会话历史（2026-10-18 用户裁决：结果本地保存——回看/重开/清空；重载恢复最近一轮） -->
    <CreationHistory :entries="history" @reopen="reopenHistory" @clear="clearHistory" />

    <!-- 技能芯片行（即梦同款：/名称 + New/Hot 徽标 + 更多技能） -->
    <div class="chips">
      <button v-for="s in skills.slice(0, 7)" :key="s.id" type="button" class="chip" :class="{ 'is-picked': s.id === selectedSkillId }" @click="toggleSkillByName(s.name)">
        <span class="chip-slash">/</span> {{ s.name }}
        <span v-if="s.badge" class="menu-badge" :class="`badge-${s.badge.toLowerCase()}`">{{ s.badge }}</span>
      </button>
      <button type="button" class="chip chip-more" @click="openMarket">更多技能 ›</button>
    </div>

    <!-- 技能市场（分类字典，对照即梦技能市场页） -->
    <div v-if="marketOpen" class="market-mask" @click.self="marketOpen = false">
      <div class="market">
        <div class="market-head">
          <span class="market-title">技能市场</span>
          <span class="market-actions">
            <button type="button" class="mini" @click="startEdit({ id: newSkillId(), name: '', emoji: '🧩', template: '请围绕下面的想法进行创作：{{输入}}{{主体}}', backend: 'llm' })">＋ 自定义</button>
            <button type="button" class="mini" @click="skills = resetSkills(); selectedSkillId = null; persist()">恢复默认</button>
            <button type="button" class="mini" @click="marketOpen = false">×</button>
          </span>
        </div>
        <div class="market-cats">
          <button type="button" class="cat" :class="{ 'is-active': marketCategory === '全部' }" @click="marketCategory = '全部'">全部</button>
          <button v-for="c in CREATION_CATALOG_CATEGORIES" :key="c" type="button" class="cat" :class="{ 'is-active': marketCategory === c }" @click="marketCategory = c">{{ c }}</button>
        </div>
        <!-- 编辑器（自定义/编辑既有技能） -->
        <div v-if="editing" class="editor">
          <label class="field"><span>名称</span><input v-model="editing.name" class="field-input" placeholder="如：口播带货脚本"></label>
          <label class="field"><span>图标</span><input v-model="editing.emoji" class="field-input field-emoji" maxlength="4"></label>
          <label class="field field-wide"><span>发送后端</span>
            <select v-model="editingBackend" class="field-input">
              <option value="llm">AI 生成（LLM）</option>
              <option value="voiceover">口播文案（服务端十稿）</option>
              <option value="copy">仅组合提示词（复制/跳转）</option>
            </select>
          </label>
          <label class="field field-wide"><span>绑定工具（发送后可直达）</span>
            <select v-model="editingTool" class="field-input">
              <option v-for="o in TOOL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <label class="field field-wide"><span>提示词模板（占位符：双大括号包住「输入」=用户输入、「主体」=@主体列表）</span>
            <textarea v-model="editing.template" class="field-input" rows="6" />
          </label>
          <div class="editor-ops">
            <button type="button" class="mini is-primary" :disabled="!editing.name.trim() || !editing.template.trim()" @click="saveEditing">保存</button>
            <button type="button" class="mini" @click="editing = null">取消</button>
          </div>
        </div>
        <!-- 字典卡片网格（对照即梦：封面/名称/添加/作者/赞/使用量/描述） -->
        <div v-else class="market-grid">
          <div v-for="e in marketEntries" :key="e.id" class="mcard">
            <div class="mcard-cover" :class="`cat-${e.category}`">
              <span class="mcard-name">{{ e.name }}</span>
              <button type="button" class="mcard-add" :class="{ 'is-added': isAdded(e) }" @click="toggleCatalogSkill(e)">{{ isAdded(e) ? '已添加' : '添加' }}</button>
            </div>
            <div class="mcard-meta">@{{ e.author }} · {{ e.likes }} 赞 {{ e.usage }}</div>
            <div class="mcard-desc">{{ e.description }}</div>
          </div>
        </div>
        <!-- 已添加技能管理行 -->
        <div class="market-mine">
          <div class="market-mine-title">我的技能芯片（{{ skills.length }}）</div>
          <div class="mine-rows">
            <span v-for="s in skills" :key="s.id" class="mine-row">
              {{ s.emoji }} /{{ s.name }}
              <button type="button" class="mini" @click="startEdit(s)">编辑</button>
              <button v-if="!s.builtin" type="button" class="mini is-danger" @click="removeSkill(s)">移除</button>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 形态对照即梦真身（2026-10-16 CDP 提取 + 截图基准）：暗色大卡片输入会话、
   占位符内 / 和 @ 高亮、底部工具行、芯片行带 New/Hot 徽标；颜色走主题 tokens。 */
.studio { max-width: min(96%, 1360px); margin: 0 auto; padding: var(--space-6) 0 var(--space-8); }
.greet { text-align: center; margin-bottom: var(--space-5); }
.greet-title { font-size: 26px; font-weight: 700; color: var(--foreground); }
.greet-tabs { margin-top: var(--space-4); display: inline-flex; gap: 4px; background: var(--surface); border-radius: 999px; padding: 4px; }
.tab { border: none; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 14px; padding: 7px 30px; border-radius: 999px; cursor: pointer; }
.tab.is-active { background: linear-gradient(180deg, var(--card), var(--surface)); color: var(--foreground); font-weight: 700; box-shadow: var(--shadow-1); }
.tab.is-disabled { cursor: not-allowed; opacity: 0.55; }

.composer { position: relative; background: var(--card); border: 1px solid var(--border); border-radius: 18px; padding: 14px 16px 10px; box-shadow: var(--shadow-card); transition: border-color var(--duration-fast); }
.composer:focus-within { border-color: color-mix(in srgb, var(--primary) 45%, var(--border)); }
.composer-main { display: flex; gap: 12px; align-items: flex-start; }
.upload-tile { flex: 0 0 auto; width: 46px; height: 46px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--muted-foreground); font-size: 18px; cursor: pointer; }
.upload-tile:hover { border-color: var(--primary); color: var(--primary); }
.editor-wrap { flex: 1 1 auto; min-width: 0; }
.picked-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.picked-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: #fff; background: linear-gradient(135deg,#F97316 0%,#EC4899 100%); border-radius: 999px; padding: 3px 10px; }
.subject-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 600; color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent); border-radius: 999px; padding: 3px 10px; position: relative; }
/* 产品档案悬停卡（2026-10-16 用户裁决：@ 芯片悬停看六视图+卖点摘要） */
.subject-card { display: none; position: absolute; top: calc(100% + 8px); left: 0; z-index: 45; width: 264px; flex-direction: column; gap: 6px; text-align: left; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-3); padding: 10px 12px; cursor: default; white-space: normal; }
.subject-chip:hover .subject-card { display: flex; }
.sc-line { font-size: 12px; line-height: 1.55; color: var(--foreground); word-break: break-word; }
.sc-head { font-weight: 700; }
.sc-views { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
.sc-thumb { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 6px; background: #101010; border: 1px solid var(--border); }
.sc-foot { font-size: 11px; color: var(--muted-foreground); border-top: 1px solid var(--border); padding-top: 6px; }
.chip-x { border: none; background: transparent; color: inherit; font-size: 13px; cursor: pointer; padding: 0 0 0 2px; line-height: 1; }
.editor-box { position: relative; }
.input { width: 100%; border: none; background: transparent; color: var(--foreground); font: inherit; font-size: 15px; line-height: 1.65; resize: vertical; min-height: 66px; outline: none; }
.placeholder { position: absolute; inset: 0; pointer-events: none; color: var(--muted-foreground); font-size: 15px; line-height: 1.65; }
.placeholder .ph { font-style: normal; font-weight: 700; color: color-mix(in srgb, var(--primary) 70%, var(--muted-foreground)); padding: 0 1px; }
.toolbar { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.toolbar-item { display: inline-flex; align-items: center; gap: 5px; border: none; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; padding: 4px 7px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
.toolbar-item:hover { color: var(--foreground); background: var(--surface); }
.toolbar-item.is-select { color: var(--primary); font-weight: 600; cursor: pointer; }
.toolbar-item.is-static { cursor: default; }
.toolbar-item.is-static:hover { color: var(--muted-foreground); background: transparent; }
/* 点开（菜单展开）与未点击两种态（2026-10-17 用户裁决）：主色字+10% 主色滤底+
 * 1px 主色细环（同 .subject-chip/.chip.is-picked 选中语言；inset 环不挤布局），
 * 与 hover（纯 surface 底）明确可辨。 */
.toolbar-item.is-open { color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 35%, transparent); }
.toolbar-item .ti { font-style: normal; font-size: 13px; }
.toolbar-item .caret { font-style: normal; font-size: 10px; opacity: 0.8; }
.toolbar-item .at { font-weight: 700; }
.spacer { flex: 1 1 auto; }
.send { width: 34px; height: 34px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 999px; background: var(--primary); color: var(--primary-foreground); cursor: pointer; transition: transform var(--duration-fast) var(--easing-default), background var(--duration-fast); }
.send:not(:disabled):hover { transform: translateY(-1px); background: color-mix(in srgb, var(--primary) 88%, #fff); }
.send-ico { display: block; }
.send-wait { display: inline-flex; gap: 3px; align-items: center; }
.send-wait i { width: 4px; height: 4px; border-radius: 999px; background: currentColor; animation: send-wait-b 1s ease-in-out infinite; }
.send-wait i:nth-child(2) { animation-delay: 0.15s; }
.send-wait i:nth-child(3) { animation-delay: 0.3s; }
@keyframes send-wait-b { 0%, 100% { opacity: 0.35; } 40% { opacity: 1; } }
.send:disabled { background: var(--surface); color: var(--muted-foreground); cursor: not-allowed; }

.menu { position: absolute; left: 16px; right: 16px; top: calc(100% + 8px); z-index: 30; background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow-3); overflow: hidden; }
.menu-group-title { padding: 8px 14px 2px; font-size: 11px; font-weight: 700; color: var(--muted-foreground); }
/* 生成偏好面板（即梦「自动」面板同款：自动开关+图片/视频+选择比例） */
.menu-auto { left: 16px; right: auto; width: 430px; padding: 10px 12px 12px; }
.menu-head-title { font-size: 13px; font-weight: 700; color: var(--foreground); flex: 1 1 auto; }
.auto-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted-foreground); cursor: pointer; user-select: none; }
.auto-switch input { display: none; }
.auto-switch i { width: 30px; height: 17px; border-radius: 999px; background: rgba(127, 127, 127, 0.35); position: relative; transition: background var(--duration-fast); }
.auto-switch i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 999px; background: #fff; transition: left var(--duration-fast); }
.auto-switch input:checked + i { background: var(--primary); }
.auto-switch input:checked + i::after { left: 15px; }
.seg-tabs { display: grid; grid-template-columns: 1fr 1fr; background: color-mix(in srgb, var(--muted-foreground) 14%, transparent); border-radius: 10px; padding: 3px; margin: 10px 0 12px; }
.seg-tabs button { border: none; background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; padding: 7px 0; border-radius: 8px; cursor: pointer; }
.seg-tabs button.on { background: var(--card); color: var(--foreground); font-weight: 600; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18); }
.ratio-title { font-size: 12px; color: var(--muted-foreground); margin-bottom: 6px; }
.ratio-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 5px; }
.ratio-tile { display: flex; flex-direction: column; align-items: center; gap: 4px; border: 1px solid var(--border); background: transparent; color: var(--muted-foreground); font: inherit; font-size: 10.5px; padding: 7px 0 5px; border-radius: 9px; cursor: pointer; }
.ratio-tile:hover { border-color: var(--primary); color: var(--foreground); }
.ratio-tile.on { border-color: var(--primary); color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); font-weight: 600; }
.ratio-frame { display: block; width: 15px; max-height: 17px; border: 1.4px solid currentColor; border-radius: 3px; }
.ratio-auto { font-style: normal; font-size: 14px; line-height: 17px; }
.menu-title { padding: 10px 14px 4px; font-size: 12px; color: var(--muted-foreground); }
.menu-head { display: flex; align-items: center; gap: var(--space-2); padding: 10px 12px; border-bottom: 1px solid var(--border); }
.menu-search { flex: 1 1 auto; border: none; background: transparent; color: var(--foreground); font: inherit; font-size: 14px; outline: none; }
.menu-close { border: none; background: transparent; color: var(--muted-foreground); font-size: 16px; cursor: pointer; }
.menu-list { max-height: 300px; overflow: auto; padding: 6px; }
.menu-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: transparent; color: var(--foreground); font: inherit; font-size: 14px; text-align: left; padding: 9px 10px; border-radius: 10px; cursor: pointer; }
.menu-item:hover { background: var(--surface); }
.menu-item.is-picked { color: var(--primary); font-weight: 600; }
.menu-emoji { width: 22px; text-align: center; }
.menu-name { flex: 1 1 auto; font-weight: 600; }
.menu-tool { font-size: 12px; color: var(--muted-foreground); }
.menu-check { color: var(--primary); }
.menu-empty { padding: 18px; text-align: center; color: var(--muted-foreground); font-size: 13px; }
.menu-more { display: block; width: 100%; border: none; border-top: 1px solid var(--border); background: transparent; color: var(--primary); font: inherit; font-size: 13px; font-weight: 600; padding: 10px; cursor: pointer; }
.menu-foot { padding: 8px 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted-foreground); }
.menu-badge { font-size: 10px; font-weight: 800; border-radius: 4px; padding: 1px 5px; line-height: 1.4; }
.badge-new { color: #fff; background: #3B82F6; }
.badge-hot { color: #fff; background: #EA9A06; }

.notice { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-3); font-size: 13px; color: var(--muted-foreground); }
.notice.is-ok { color: var(--foreground); }
.notice.is-err { color: #ef4444; }
.notice-go { border: none; background: transparent; color: var(--primary); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; white-space: nowrap; }
.notice-x { margin-left: auto; border: none; background: transparent; color: var(--muted-foreground); cursor: pointer; font-size: 14px; }
.candidates { margin-top: var(--space-3); background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: var(--space-3); display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow: auto; }
.candidate { display: flex; flex-direction: column; gap: 4px; text-align: left; border: 1px solid var(--border); background: var(--surface); border-radius: 10px; padding: 10px 12px; cursor: pointer; font: inherit; }
.candidate:hover { border-color: var(--primary); }
.candidate.is-picked { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--surface)); }
.candidate-formula { font-size: 12px; font-weight: 700; color: var(--primary); }
.candidate-text { font-size: 13px; line-height: 1.6; color: var(--foreground); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.candidate-meta { font-size: 11px; color: var(--muted-foreground); }
.preview { margin-top: var(--space-3); background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: var(--space-3); }
.preview-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: 12px; color: var(--muted-foreground); margin-bottom: 6px; }
.preview-ops { display: inline-flex; gap: 6px; }
.preview-body { width: 100%; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--foreground); font: inherit; font-size: 13px; line-height: 1.6; padding: 10px; resize: vertical; }

.chips { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: var(--space-5); }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); background: var(--card); color: var(--foreground); font: inherit; font-size: 13px; padding: 7px 14px; border-radius: 999px; cursor: pointer; }
.chip:hover { border-color: var(--primary); color: var(--primary); }
.chip.is-picked { border-color: var(--primary); color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); }
.chip-slash { opacity: 0.65; margin-right: -2px; }
.chip-more { color: var(--muted-foreground); }

.market-mask { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,0.5); display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 40px 16px; }
.market { width: min(980px, 96vw); background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-3); padding: var(--space-4); }
.market-head { display: flex; align-items: center; justify-content: space-between; font-size: 16px; font-weight: 700; color: var(--foreground); margin-bottom: var(--space-3); }
.market-actions { display: inline-flex; gap: 8px; }
.market-cats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--space-3); }
.cat { border: 1px solid var(--border); background: transparent; color: var(--muted-foreground); font: inherit; font-size: 13px; padding: 5px 14px; border-radius: 999px; cursor: pointer; }
.cat.is-active { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); font-weight: 600; }
.mini { border: 1px solid var(--border); background: transparent; color: var(--foreground); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
.mini:hover { border-color: var(--primary); color: var(--primary); }
.mini:disabled { opacity: 0.45; cursor: not-allowed; }
.mini.is-danger { color: #ef4444; border-color: color-mix(in srgb, #ef4444 40%, transparent); }
.mini.is-primary { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }
.market-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
.mcard { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface); display: flex; flex-direction: column; }
.mcard-cover { position: relative; aspect-ratio: 16 / 9; display: flex; align-items: flex-end; padding: 10px; }
.mcard-cover.cat-广告营销 { background: linear-gradient(135deg, #7C3AED33 0%, #EC489933 100%); }
.mcard-cover.cat-影视作品 { background: linear-gradient(135deg, #0EA5E933 0%, #6366F133 100%); }
.mcard-cover.cat-平面设计 { background: linear-gradient(135deg, #14B8A633 0%, #0EA5E933 100%); }
.mcard-cover.cat-电商 { background: linear-gradient(135deg, #F59E0B33 0%, #EF444433 100%); }
.mcard-cover.cat-动画动漫 { background: linear-gradient(135deg, #EC489933 0%, #8B5CF633 100%); }
.mcard-cover.cat-其他 { background: linear-gradient(135deg, #64748B33 0%, #94A3B833 100%); }
.mcard-name { font-size: 15px; font-weight: 700; color: var(--foreground); text-shadow: 0 1px 6px rgba(0,0,0,0.25); padding-right: 56px; }
.mcard-add { position: absolute; top: 8px; right: 8px; border: none; border-radius: 8px; background: color-mix(in srgb, var(--card) 85%, transparent); color: var(--foreground); font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; }
.mcard-add:hover, .mcard-add.is-added { background: var(--primary); color: var(--primary-foreground); }
.mcard-meta { font-size: 11px; color: var(--muted-foreground); padding: 8px 10px 0; }
.mcard-desc { font-size: 12px; line-height: 1.55; color: var(--muted-foreground); padding: 4px 10px 10px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; flex: 1 1 auto; }
.editor { display: grid; grid-template-columns: 1fr 90px; gap: 10px; padding: var(--space-3) 0; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted-foreground); }
.field-wide { grid-column: 1 / -1; }
.field-input { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--foreground); font: inherit; font-size: 13px; padding: 8px 10px; outline: none; }
.field-emoji { text-align: center; font-size: 16px; }
.editor-ops { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; }
.market-mine { margin-top: var(--space-4); border-top: 1px solid var(--border); padding-top: var(--space-3); }
.market-mine-title { font-size: 13px; font-weight: 700; color: var(--foreground); margin-bottom: 8px; }
.mine-rows { display: flex; flex-wrap: wrap; gap: 8px; }
.mine-row { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; font-size: 12px; color: var(--foreground); }
</style>
