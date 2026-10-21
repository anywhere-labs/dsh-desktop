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
    ofStage.value = '正在准备剪辑方案...'
    try {
      // 与 exportMontageTracksDraft 同源的时间线组装（虚拟剪辑方案）
      const vPlans = assemblePlans.value.filter(
        (p): p is typeof p & { groups: NonNullable<typeof p.groups>; tabId: string } =>
          !!(p.confirmed && p.virtual && p.groups?.length && p.tabId),
      )
      if (!vPlans.length) { notify('没有剪辑方案', '请先在「视频素材」页完成智能匹配并点「生成剪辑方案」。'); return }
      ofStage.value = '正在准备剪辑方案素材...'
      for (const p of vPlans) {
        for (const g of p.groups) {
          for (const s of g.scenes) {
            if (!s.clipLocalPath && s.clipUrl) {
              try {
                const dir = joinPath(await readCacheDir(), 'montage_cache', 'groups')
                const local = joinPath(dir, `${s.idx}_${pathBasename(s.name)}`)
                await window.tintin.server.downloadResult(toAbsolute(s.clipUrl), local)
                s.clipLocalPath = local
              } catch (_) { /* 缺失片段在下方显式报错 */ }
            }
          }
        }
      }
      interface OfSeg { path: string; durSec: number; c0: number }
      const segs: OfSeg[] = []
      const voices: Array<{ path: string; at: number }> = []
      vPlans.forEach((p) => {
        const tab = getTabById(p.tabId)
        if (!tab) return
        let c0 = 0
        let planStart = -1
        p.groups.forEach((g) => {
          g.scenes.forEach((s, si) => {
            const durSec = Math.max(0.1, Number(g.useDurs[si]) || Math.max(0.1, Number(s.duration) || 0.1))
            if (!s.clipLocalPath) return
            if (planStart < 0) planStart = c0
            segs.push({ path: s.clipLocalPath, durSec, c0 })
            c0 += durSec
          })
        })
        if (planStart >= 0 && tab.voiceWav) voices.push({ path: tab.voiceWav, at: planStart })
      })
      if (!segs.length) { notify('没有剪辑方案', '方案内没有可用片段：请重新智能匹配。'); return }
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
      const bgm = String(bgmPath.value || '')
      if (bgm) { bgmRel = `assets/bgm${ofExtOf(bgm)}`; if (!relOfPath.has(bgm)) relOfPath.set(bgm, bgmRel) }
      for (const [sourcePath, rel] of relOfPath) {
        ofStage.value = `落素材 ${rel}...`
        await ofStageFile(project, rel, sourcePath)
      }
      for (const [sourcePath, rel] of relOfVoice) {
        ofStage.value = `落口播 ${rel}...`
        await ofStageFile(project, rel, sourcePath)
      }
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
      exportDoneMsg.value = `✓ 已导出到视频剪辑项目`
    } catch (error) {
      notify('导出失败', `导出到视频剪辑项目时发生错误：\n${(error as Error)?.message || String(error)}`)
    } finally { ofBusy.value = false }
  }
  return { ofBusy, ofStage, ofProject, exportToEditingProject, openEditingProject }
}
