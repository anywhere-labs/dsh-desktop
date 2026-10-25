// useCopywritingMontageStep4Openfilm.ts — Step4「导出到视频剪辑项目」。
// (2026-10-21 用户裁决：方案二由「服务端生成」替换)。铁律 4：整块从
// useCopywritingMontageStep4Final.ts 原样外提，逻辑零改动；宿主通道
// openfilm:stageAsset / openfilm:writeFilm / openfilm.openProject 由
// dsh-tintin-bundle 的 tintinBridge 提供。
import { ref } from 'vue'
import type { Ref } from 'vue'
import { readCacheDir } from '../useSettingsConfig'
import { pathBasename, type PrecomposePlan } from '../copywritingMontageLogic'
import { notify, joinPath } from './context'

/** 方案二开跑前的轨道检查行（与方案一「轨道检查」同口径：✓/✕ + 说明）。 */
export interface OfTrackCheck {
  label: string
  ok: boolean
  detail: string
}

export interface CopywritingStep4OpenfilmDeps {
  assemblePlans: Ref<PrecomposePlan[]>
  getTabById: (id: string) => { voiceWav?: string } | undefined
  toAbsolute: (url: string) => string
  readCacheDir: () => Promise<string>
  joinPath: (...parts: string[]) => string
  pathBasename: (p: string) => string
  notify: (title: string, message: string) => void
  bgmPath: Ref<string>
  bgmVolume: Ref<number>
  exportDoneMsg: Ref<string>
}

export function useCopywritingMontageStep4Openfilm(deps: CopywritingStep4OpenfilmDeps) {
  const { assemblePlans, getTabById, toAbsolute, bgmPath, bgmVolume, exportDoneMsg } = deps
  // 把与剪映导出同源的剪辑方案时间线转译为 OpenFilm 项目：视频段顺序上 P1 轨、
  // 逐方案口播 wav 上 A 轨、全局 BGM 上音轨；素材经 openfilm:stageAsset 落进项目
  // assets/，时间轴经 openfilm:writeFilm 写 film.html。字幕/花字/转场/音效包装为
  // 剪映特有轨，v1 不转译（导出后可在 Studio 里继续精剪补齐）。
  const ofBusy = ref(false)
  const ofStage = ref('')
  const ofProject = ref('')
  // 2026-10-21 用户裁决：方案二同样要有真实进度与逐轨检验（素材/口播/BGM）。
  const ofProgress = ref(0)
  const ofChecks = ref<OfTrackCheck[]>([])
  const ofExtOf = (path: string) => (String(path).match(/\.[a-z0-9]+$/i)?.[0] || '.mp4').toLowerCase()
  async function ofStageFile(project: string, rel: string, sourcePath: string): Promise<void> {
    const res = await (window.tintin as any).openfilm.stageAsset({ project, rel, sourcePath })
    if (res?.error) throw new Error(res.error)
  }
  async function openEditingProject(): Promise<void> {
    if (!ofProject.value) return
    try {
      await (window.tintin as any).openfilm.openProject({ project: ofProject.value })
      ;(window as any).__tintinChrome?.open?.('openfilm')
    } catch (error) { notify('打开失败', String((error as Error)?.message || error)) }
  }
  async function exportToEditingProject(): Promise<void> {
    if (ofBusy.value) return
    ofBusy.value = true
    ofProgress.value = 0
    ofChecks.value = []
    ofStage.value = '正在准备剪辑方案...'
    try {
      // 与 exportMontageTracksDraft 同源的时间线组装（虚拟剪辑方案）
      const vPlans = assemblePlans.value.filter(
        (p): p is typeof p & { groups: NonNullable<typeof p.groups>; tabId: string } =>
          !!(p.confirmed && p.virtual && p.groups?.length && p.tabId),
      )
      if (!vPlans.length) { notify('没有剪辑方案', '请先在「视频素材」页完成智能匹配并点「生成剪辑方案」。'); return }
      ofStage.value = '正在准备剪辑方案素材...'
      const allScenes = vPlans.flatMap((p) => p.groups.flatMap((g) => g.scenes))
      let prepared = 0
      for (const s of allScenes) {
        if (!s.clipLocalPath && s.clipUrl) {
          try {
            const dir = joinPath(await readCacheDir(), 'montage_cache', 'groups')
            const local = joinPath(dir, `${s.idx}_${pathBasename(s.name)}`)
            await window.tintin.server.downloadResult(toAbsolute(s.clipUrl), local)
            s.clipLocalPath = local
          } catch (_) { /* 缺失片段在下方显式报错 */ }
        }
        prepared += 1
        ofProgress.value = 5 + Math.round((prepared / Math.max(1, allScenes.length)) * 25)
        ofStage.value = `准备剪辑方案素材 ${prepared}/${allScenes.length}`
      }
      interface OfSeg { path: string; durSec: number; c0: number }
      const segs: OfSeg[] = []
      const voices: Array<{ path: string; at: number }> = []
      let missing = 0
      vPlans.forEach((p) => {
        const tab = getTabById(p.tabId)
        if (!tab) return
        let c0 = 0
        let planStart = -1
        p.groups.forEach((g) => {
          g.scenes.forEach((s, si) => {
            const durSec = Math.max(0.1, Number(g.useDurs[si]) || Math.max(0.1, Number(s.duration) || 0.1))
            if (!s.clipLocalPath) { missing += 1; return }
            // 以文件时长收口（2026-10-21 实机：计划时长 5.17 秒 > 文件 5.166667 秒，
            // film.html 的 #t=0,5.17 越界，Studio 报 "ends past the file's length" 拒绝绘制）
            const fileDur = Number(s.duration) || 0
            const cut = fileDur > 0.05 ? Math.min(durSec, Math.max(0.05, fileDur - 0.02)) : durSec
            if (planStart < 0) planStart = c0
            segs.push({ path: s.clipLocalPath, durSec: cut, c0 })
            c0 += cut
          })
        })
        if (planStart >= 0 && tab.voiceWav) voices.push({ path: tab.voiceWav, at: planStart })
      })
      const bgm = String(bgmPath.value || '')
      const totalSec = segs.reduce((sum, seg) => sum + seg.durSec, 0)
      // 逐轨检验（导出前一次性生成，导出后在按钮下方常驻展示）
      ofChecks.value = [
        { label: '剪辑方案', ok: vPlans.length > 0, detail: `${vPlans.length} 个已确认方案` },
        {
          label: '视频素材轨',
          ok: segs.length > 0 && missing === 0,
          detail: `${segs.length} 段 · ${totalSec.toFixed(1)}s${missing ? ` · 缺 ${missing} 段` : ''}`,
        },
        {
          label: '口播轨',
          ok: voices.length > 0 && voices.length >= vPlans.length,
          detail: `${voices.length}/${vPlans.length} 个方案带口播`,
        },
        {
          label: 'BGM 轨',
          ok: bgm !== '',
          detail: bgm ? `${pathBasename(bgm)} · 音量 ${Math.round(Number(bgmVolume.value) || 0)}%` : '未选择 BGM（工程不含背景音乐）',
        },
      ]
      if (!segs.length) { notify('没有剪辑方案', '方案内没有可用片段：请重新智能匹配。'); return }
      ofProgress.value = 32
      ofStage.value = '创建视频剪辑项目...'
      const created = await (window.tintin as any).openfilm.createProject({ name: `文案混剪-${new Date().toISOString().slice(0, 10)}` })
      if (created?.error) throw new Error(created.error)
      const project = String(created.project)
      const relOfPath = new Map<string, string>()
      let seq = 0
      for (const seg of segs) {
        if (!relOfPath.has(seg.path)) { seq += 1; relOfPath.set(seg.path, `assets/seg-${seq}${ofExtOf(seg.path)}`) }
      }
      const relOfVoice = new Map<string, string>()
      let vseq = 0
      for (const v of voices) { if (!relOfVoice.has(v.path)) { vseq += 1; relOfVoice.set(v.path, `assets/vo-${vseq}.wav`) } }
      let bgmRel = ''
      if (bgm) { bgmRel = `assets/bgm${ofExtOf(bgm)}`; if (!relOfPath.has(bgm)) relOfPath.set(bgm, bgmRel) }
      const stageTotal = Math.max(1, relOfPath.size + relOfVoice.size)
      let staged = 0
      for (const [sourcePath, rel] of relOfPath) {
        ofStage.value = `落素材 ${rel}...`
        await ofStageFile(project, rel, sourcePath)
        staged += 1
        ofProgress.value = 35 + Math.round((staged / stageTotal) * 45)
      }
      for (const [sourcePath, rel] of relOfVoice) {
        ofStage.value = `落口播 ${rel}...`
        await ofStageFile(project, rel, sourcePath)
        staged += 1
        ofProgress.value = 35 + Math.round((staged / stageTotal) * 45)
      }
      ofProgress.value = 88
      ofStage.value = '写时间轴 film.html...'
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      const videoTags = segs.map((seg) => `  <video src="${esc(relOfPath.get(seg.path)!)}#t=0,${seg.durSec.toFixed(3)}" at="${seg.c0.toFixed(3)}"></video>`)
      const voiceTags = voices.map((v) => `  <audio src="${esc(relOfVoice.get(v.path)!)}" at="${v.at.toFixed(3)}"></audio>`)
      const vol = Math.min(1, Math.max(0, Number(bgmVolume.value) / 100)).toFixed(2)
      const bgmTag = bgmRel ? [`  <audio src="${esc(bgmRel)}" volume="${vol}" at="0"></audio>`] : []
      const html = [
        '<!doctype html>',
        '<html><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=1920, height=1080">',
        '</head><body>',
        '<section>',
        ...videoTags,
        '</section>',
        '<section>',
        ...voiceTags,
        '</section>',
        '<section>',
        ...bgmTag,
        '</section>',
        '</body></html>',
      ].join('\n')
      const written = await (window.tintin as any).openfilm.writeFilm({ project, html })
      if (written?.error) throw new Error(written.error)
      ofProject.value = project
      ofProgress.value = 100
      ofStage.value = `已导出 ${segs.length} 段 · ${totalSec.toFixed(1)}s`
      exportDoneMsg.value = `✓ 已导出到视频剪辑项目`
    } catch (error) {
      ofStage.value = '导出失败'
      notify('导出失败', `导出到视频剪辑项目时发生错误：\n${(error as Error)?.message || String(error)}`)
    } finally { ofBusy.value = false }
  }
  return { ofBusy, ofStage, ofProject, ofProgress, ofChecks, exportToEditingProject, openEditingProject }
}
