// 为了让 TintinBridgeServer 下的业务级方法直接对齐 server-api.ts 命名空间类型，
// 先在顶部 import 该文件的命名空间与公共类型（declare global 前可用 import type）。
import type {
  StatsAPI,
  LLMAPI,
  CopywritingAPI,
  ASRAPI,
  TTSAPI,
  MaterialAPI,
  MontageAPI,
  AudioAPI,
  VSRAPI,
  RembgAPI,
  ViralCloneAPI,
  VisionAPI,
  WorkflowAPI,
  AgentAPI,
  TasksAPI,
  ScheduledAPI,
  StoryboardAPI,
  SystemAPI,
  CapabilityRegistryItem,
  PaginatedResponse,
} from './server-api'

// --------------------------------------------------------------------
// app
// --------------------------------------------------------------------
declare interface TintinBridgeApp {
  getVersion(): string
  getPath(name: 'home' | 'userData' | 'temp' | 'workspace'): string
  quit(): void
  relaunch(): void
  onUpdateAvailable(cb: (ver: string, url: string) => void): () => void
}

// --------------------------------------------------------------------
// dialog
// --------------------------------------------------------------------
declare interface TintinBridgeDialog {
  openFile(params?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }): Promise<string | null>
  openFiles(params?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
    multi: true
  }): Promise<string[] | null>
  openDir(params?: { title?: string }): Promise<string | null>
  saveFile(params?: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }): Promise<string | null>
  /** 递归收集文件夹内全部视频文件（对齐 PR#3 collect_video_files） */
  collectVideos(params?: {
    root: string
    exts?: string[]
    limit?: number
    skipDirs?: string[]
  }): Promise<string[]>
}

// --------------------------------------------------------------------
// downloads
// --------------------------------------------------------------------
declare interface TintinBridgeDownloadProgress {
  speed: number
  percent: number
  downloaded: number
  total: number
}
declare interface TintinBridgeDownloadDone {
  finalPath: string
  size: number
}
declare interface TintinBridgeDownloads {
  start(params: {
    url: string
    savePath: string
    referer?: string
    headers?: Record<string, string>
  }): Promise<string>
  pause(taskId: string): void
  resume(taskId: string): void
  cancel(taskId: string): void
  onProgress(
    taskId: string,
    cb: (p: TintinBridgeDownloadProgress) => void
  ): () => void
  onDone(taskId: string, cb: (p: TintinBridgeDownloadDone) => void): () => void
}

// --------------------------------------------------------------------
// server — 通用兜底 + 业务级方法（类型对齐 server-api.ts）
// --------------------------------------------------------------------
type IpcError<T> = T | null | { error: string }

declare interface TintinBridgeServer {
  // 通用兜底：保持与旧版本兼容，允许业务层直接按路径调用
  get<T = any>(path: string, params?: Record<string, any>): Promise<T | null>
  post<T = any>(path: string, body?: any, headers?: Record<string, string>, timeout?: number): Promise<T | null>
  put<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<T | null>
  delete<T = any>(path: string, params?: Record<string, any>): Promise<T | null>
  upload<T = any>(
    path: string,
    fields: Record<string, Blob | string>,
    onProgress?: (percent: number) => void,
    /** 上游方法（默认 POST；frames 端点=PUT multipart——405 修复 2026-10-06） */
    method?: 'POST' | 'PUT'
  ): Promise<T | null>
  sse(
    path: string,
    onEvent: (data: any) => void,
    onError?: (err: any) => void
  ): () => void
  downloadResult(path: string, savePath: string): Promise<string | null>

  // ---------- health / stats ----------
  // healthCapabilities 已移除（/health/capabilities 服务端从未实现，声明即陷阱）
  statsWorkbench(): Promise<IpcError<StatsAPI.WorkbenchResponse>>

  // ---------- agent ----------
  // 服务端 /agent/* 编排（tasks/submit/action/artifacts）已于 2026-09-25 退役，
  // 对应桥方法随之移除；仅能力目录保留（MCP/仪表盘消费、P2 工具化数据源）。
  agentRegistry(): Promise<IpcError<CapabilityRegistryItem[]>>

  // ---------- tasks ----------
  tasksUnifiedList(
    params?: TasksAPI.UnifiedListRequest
  ): Promise<IpcError<TasksAPI.UnifiedListResponse>>
  tasksUnifiedItem(id: string): Promise<IpcError<AgentAPI.TaskNode>>
  tasksProgress(id: string): Promise<IpcError<TasksAPI.ProgressResponse>>
  tasksDownloadResult(id: string, savePath: string): Promise<IpcError<string>>

  // ---------- 技能（2026-10-16 安装升级：真技能包落盘）----------
  /** 客户端技能包安装：GET /skills/{id}/download → 解压 <DSH_HOME>/skills/<id>/（重装覆盖） */
  skillsInstall(id: string): Promise<{ error?: string; dir?: string; zipPath?: string; skillMd?: boolean; skillMdContent?: string }>

  // ---------- scheduled（服务端定时任务执行记录，对齐原 scheduled_tasks_page.py）----------
  scheduledTasksList(params?: {
    status?: string
    task_type?: string
    page?: number
    size?: number
  }): Promise<IpcError<{ tasks?: any[]; items?: any[]; total?: number }>>
  scheduledTaskItem(id: string): Promise<IpcError<ScheduledAPI.TaskExecRecord>>

  // ---------- V3 S1~S3 媒体工具 ----------
  rembgSubmit(
    payload: RembgAPI.MattingRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<RembgAPI.MattingResponse>>
  /** GET /matting/models（服务端可用抠图模型清单；离线/失败返 null，组件用静态兜底） */
  mattingModels(): Promise<IpcError<{ models?: unknown[] } | null>>
  // vsrSubmit 已废弃（2026-09-15：vsr:submit 通道随一步式 vsr:remove 废止移除）
  vsrRemove(
    payload: VSRAPI.RemoveRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<VSRAPI.RemoveResponse>>
  // ---------- 仿爆款（Viral Clone）----------
  /** POST /viral/clone/analyze（拆解爆款，同步） */
  viralCloneAnalyze(
    payload: ViralCloneAPI.AnalyzeRequest
  ): Promise<IpcError<unknown>>
  /** POST /viral/clone/plan（复刻规划，同步；依赖 analyze 返回 structure） */
  viralClonePlan(
    payload: ViralCloneAPI.PlanRequest
  ): Promise<IpcError<unknown>>
  /** POST /viral/clone/flow（全链一条调用：拆解 + 复刻规划，timeout 900） */
  viralCloneFlow(
    payload: ViralCloneAPI.FlowRequest
  ): Promise<IpcError<ViralCloneAPI.FlowResponse>>
  /** POST /viral/clone/upload（multipart 本地视频 → 服务端 output/upload 区，返还 video_path；契约正文待服务端确认，走通用 server:upload） */
  viralCloneUpload(
    filePath: string,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<{ video_path?: string; [k: string]: unknown }>>
  /** POST /viral/clone/generate（三替换素材生成 v1，服务端 E-3.0 就绪后开放） */
  viralCloneGenerate(payload: Record<string, unknown>): Promise<IpcError<ViralCloneAPI.FlowResponse>>
  /** POST /viral/clone/montage（复刻成片组装 v1） */
  viralCloneMontage(payload: Record<string, unknown>): Promise<IpcError<ViralCloneAPI.FlowResponse>>
  /** POST /viral/clone/review（复刻 vs 爆款对比报告） */
  viralCloneReview(payload: Record<string, unknown>): Promise<IpcError<ViralCloneAPI.FlowResponse>>
  /** GET /workflows（scope=client；服务端列表，原版 normalize_server_workflow 过滤） */
  listServerWorkflows(scope?: string): Promise<IpcError<{ workflows?: Array<Record<string, unknown>> }>>
  /** POST /workflows/{id}/run（multipart，files + values；对照 wfc.run_workflow） */
  runServerWorkflow(
    workflowId: string,
    fields: Record<string, string | Blob>,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<{ ok?: boolean; task_id?: string; error?: string; [k: string]: unknown }>>
  /** GET /workflows/task/{id}（对照 wfc.task_status） */
  serverWorkflowStatus(taskId: string): Promise<IpcError<unknown>>
  visionReversePrompt(
    payload: VisionAPI.ReversePromptRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<VisionAPI.ReversePromptResponse>>

  // ---------- asr / tts ----------
  asrTranscribe(
    payload: ASRAPI.TranscribeRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<ASRAPI.TranscribeResponse>>
  ttsGenerate(
    payload: TTSAPI.GenerateRequest
  ): Promise<IpcError<TTSAPI.GenerateResponse>>
  /** 将 base64 音频写入本地文件（或 fromPath 复制模式）；相对路径统一解析到 userData 下，返回绝对路径 */
  ttsSaveAudio(payload: { base64?: string; fromPath?: string; savePath: string }): Promise<string | { error: string }>
  ttsVoicesSamples(params?: {
    speaker?: string
    cloned_only?: boolean
    page?: number
    page_size?: number
  }): Promise<IpcError<TTSAPI.VoicesSamplesResponse>>
  /** Qwen3-TTS 预置音色列表（GET /indextts/qwen3/voices → {speakers:string[]}） */
  ttsQwen3Voices(): Promise<{ speakers: string[] } | null | { error: string }>
  ttsUploadSample(
    payload: TTSAPI.UploadSampleRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<TTSAPI.UploadSampleResponse>>
  // （ttsFetchSampleAudio 已废弃删除：样本试听改渲染层直连服务端音频 URL，2026-09-07）

  // ---------- 智能混剪 Step3 口播配音（原版 VoiceCloneWorker/VideoDubbingWorker 主进程化）----------
  /** 扫描视频输入目录（对照 _do_scan_voice_video_dir：无 .flv，自动检测 voices/voice_N.wav 与伴随 .txt） */
  voiceScanDir(payload: { dirPath: string; selectedFiles?: string[]; keepFiles?: string[] }): Promise<{
    files: Array<{ path: string; name: string; wavPath: string; originalText: string; durationSec: number; voiceDurSec: number }>
    voicesDir: string
  } | { error: string }>
  /** 批量克隆人声（TTS 逐句 + wav 拼接 + 变速 + .timing.json；对照 VoiceCloneWorker api 模式） */
  voiceCloneBatch(payload: {
    tasks: Array<{ rowIdx: number; text: string; videoPath: string; outWavPath: string }>
    refAudioPath: string
    /** 服务端样本库参考声音（/voice/samples audio_url；主进程下载后转 b64 prompt_audio） */
    refAudioUrl?: string
    apiUrl: string
    speedMin: number
    speedMax: number
    /** 克隆参数（「设置声音克隆」弹窗配置；durationFactor/emoText/emoAlpha 主进程展开进 /indextts/tts 载荷，
     *  pauseMs 为 2026-09-08 服务端句间停顿标记，写在 text 里不进载荷） */
    ttsParams?: { durationFactor: number; emoText: string; emoAlpha: number; pauseMs?: number; speaker?: string; instruct?: string }
    /** 2026-09-20（服务端 TTS 统一入口）：引擎=qwen3 → Qwen3-TTS（缺省 indextts） */
    engine?: 'indextts' | 'qwen3' | 'voxcpm'
    /** 2026-09-20 用户裁决：样本库样本 id（>0 走样本库渠道自动补 ref_text；0=Base 音色） */
    sampleId?: number
    /** 参考音频文稿（Qwen3 克隆必填 ref_text 的文稿源；渲染层参考样本转写/手输） */
    refText?: string
    progressChannel?: string
  }): Promise<{ results: Record<string, string>; durations: Record<string, number>; failures: Array<{ rowIdx: number; msg: string }> } | { error: string }>
  /** 停止批量克隆（2026-09-23 用户裁决）：按 progressChannel 定向置停止标记，当前条完成后停止 */
  voiceCloneBatchStop(payload: { progressChannel: string }): Promise<{ ok?: boolean }>
  /** 批量替换原声（ffmpeg 字幕/花字/atempo；对照 VideoDubbingWorker；2026-09-07 PR#4 新口径） */
  voiceDubVideos(payload: {
    tasks: Array<{ videoPath: string; voiceWavPath: string; outVideoPath: string; text: string }>
    /** 2026-09-09 裁决：特效迁 Step4 统一烧制后，配音纯化不传特效字段（缺省=不烧） */
    addSubtitles?: boolean
    lengthModes: Record<string, string>
    fancyText?: boolean
    fancyStyle?: string
    /** 字幕文字样式预设 key（SUBTITLE_STYLE_PRESETS；2026-09-09 裁决：样式属字幕配置） */
    subtitleStyle?: string
    /** 兼容保留：花字内容已改为自动提取卖点，不再参与渲染 */
    fancyWords?: string[]
    /** 花字出现位置（FANCY_POSITIONS 键，默认 upper_middle） */
    fancyPosition?: string
    /** 字幕背景不透明度（0=无背景框，默认 0.5） */
    subtitleBoxOpacity?: number
    /** 花字模板 dict（样式+动画+音效；null=自定义样式） */
    fancyTemplate?: Record<string, unknown> | null
    subtitleFont?: string
    progressChannel?: string
  }): Promise<{ results: Record<string, string> } | { error: string; results?: Record<string, string> }>
  /** 花字模板列表（全业务字段）+ 已缓存预览图（PR#4：对照 utils/fancy_templates.py） */
  fancyListTemplates(): Promise<{
    templates: Array<Record<string, unknown> & { template_id: string; name: string; style: string; anim: string; hasSound: boolean }>
    previews: Record<string, string>
  } | { error: string }>
  /** 后台补齐缺失模板预览图（ffmpeg 逐个生成；对照 _FancyPreviewWorker；
   *  2026-09-09 对齐：templates 可选传服务端 /fancy/templates 模板——与本地同格式，同一预览口径） */
  fancyEnsurePreviews(payload?: { templates?: Array<Record<string, unknown> & { template_id: string; name: string; style?: string }> }): Promise<{ previews: Record<string, string>; generated: number } | { error: string }>
  /** 服务端花字模板库（GET /fancy/templates，响应 {items,total}；离线 null） */
  fancyServerTemplates(): Promise<{ templates: Array<Record<string, unknown> & { template_id: string; name: string }>; total: number } | { error: string } | null>
  /** 服务端文字模板库（GET /text_templates/templates，响应 {items,total}；与花字独立体系；离线 null） */
  textfxServerTemplates(): Promise<{ templates: Array<Record<string, unknown> & { template_id: string; name: string }>; total: number } | { error: string } | null>
  // textfxMatchKeywords 已删除（2026-09-19 架构：服务端 /text_templates/match 下线，
  // 客户端不再调用关键词命中——词源=产品资料关联关键词，产品未关联词 LLM 兜底提词）
  /** 订阅模板预览图生成进度 */
  fancyOnPreviewProgress(cb: (d: { idx: number; total: number }) => void): () => void
  /** 服务端字体列表（GET /config/fonts） */
  voiceFonts(): Promise<{ fonts: Array<{ id: string; family: string; filename?: string }> } | { error: string } | null>
  /** 服务端字体文件字节（GET /config/fonts/{font_id}/file；FontFace 加载自渲染用；离线 null） */
  voiceFontFile(fontId: string): Promise<{ data: Uint8Array } | { error: string } | null>
  /** 服务端字幕样式库（GET /subtitle_styles；2026-09-17 用户裁决：字幕样式统一来自服务端） */
  voiceSubtitleStyles(): Promise<{ styles: Array<{ id: string; name: string; style: Record<string, unknown>; tags?: string[]; scenario?: string }> } | { error: string } | null>
  /** 导出克隆声音（copy2 到用户选的保存路径） */
  voiceExportAudio(payload: { srcPath: string; savePath: string }): Promise<{ ok: boolean; savePath: string } | { error: string }>
  /** 订阅 voice 域进度事件（返回取消订阅函数；2026-09-11 实时状态：完成事件随带
   *  wavPath/durSec、失败随带 failed，渲染层即时回写行而不等整批返回） */
  onVoiceProgress(channel: string, cb: (d: {
    rowIdx?: number; value?: number; stage?: string
    /** 该条完成时的产物 wav 绝对路径（cloneBatch 成功事件随带） */
    wavPath?: string
    /** 该条克隆音频时长（秒；随 wavPath 一同回传） */
    durSec?: number
    /** 该条失败终结标记（渲染层复位为未生成） */
    failed?: boolean
    /** final:mix 逐条完成事件随带成片绝对路径（渲染层增量上表；2026-09-12） */
    donePath?: string
  }) => void): () => void

  // ---------- 智能混剪 Step4 特效包装（FinalMixWorker 主进程化 + 剪映草稿导出）----------
  /** 最终合成（特效烧制 + BGM 混音）。2026-09-09 裁决：特效配置迁 Step4，可带
   *  effects + subtitleTexts；2026-09-11 终裁：mixMode 单字段决定整条链路 */
  finalMix(payload: {
    /** 合成模式（2026-09-11 用户终裁：按钮决定链路，开了哪些特效只是参数）：
     *  'server'（缺省）特效+ BGM 整条交服务端一次 /montage/concat 完成，失败直接
     *  报错不回退本地；'local' 逐视频本地 ffmpeg 烧制特效再本地混音 */
    mixMode?: 'server' | 'local'
    tasks: Array<{ videoPath: string; outPath: string }>
    bgmPath: string
    bgmVolume: number
    effects?: {
      addSubtitles: boolean
      subtitleFont: string
      subtitleStyle: string
      /** 服务端 /subtitle_styles 完整样式对象（2026-09-17 用户裁决：字幕样式统一来自
       *  服务端库）。服务端烧制链直接透传 subtitle_style；本地 ffmpeg 链经
       *  serverStyleToDrawtext 转 drawtext 片段。为 null 时回退 subtitleStyle key。 */
      subtitleStyleObj?: Record<string, unknown> | null
      subtitleBoxOpacity: number
      /** 字幕入场动画（fade/rise/slide/pop/none；2026-09-10 用户裁决，预览与烧制同源；仅本地烧制链） */
      subtitleAnim: string
      /** 文字模板随统一合成提交服务端（/montage/concat text_template_* 字段；2026-09-10） */
      textFxEnabled?: boolean
      /** 2026-09-14 服务端新增：还原 LUT（无显式 LUT 文件时自动抽帧匹配 LUT 库；默认 false 不还原） */
      lutRestore?: boolean
      /** 勾选还原后选定的库内 LUT id（concat lut_id，待服务端支持后生效） */
      lutId?: string
      textTemplateId?: string
      /** match 模式必填模板池（/guide text_template_match_ids；命中行从池中随机选一）。
       *  2026-09-11 用户裁决：不再传本地提取词表（text_template_words）——关键词
       *  命中在合成请求内由服务端从随请求提交的字幕自行完成 */
      textTemplateMatchIds?: string[]
      /** 匹配密度档位透传 text_template_match_density（low/mid/high；服务端默认 high） */
      matchDensity?: string
      /** 本地烧制样式池（2026-09-10 用户裁决：本地合成同烧文字模板；主色/效果色/动画与预览同源） */
      textFxStyles?: Array<{ name: string; color: string; effectColor: string; anim: string }>
      /** 随机模式每视频随机选样个数（2026-09-10 二次裁决；<=0 或池≤1 → 全量轮换） */
      textFxCount?: number
      fancyText: boolean
      fancyStyle: string
      fancyPosition: string
      fancyTemplate: Record<string, unknown> | null
    }
    subtitleTexts?: Array<{
      videoPath: string
      text: string
      timingPath: string
      /** 配音 wav 路径（2026-09-11 统一合成契约提案③接线：服务端链路随 concat
       *  voice 轨上传（voice_mode=replace 替换原声），不再本地预先替换原声；
       *  本地链路不使用该字段——已由 dubVideos 替换进视频） */
      voicePath?: string
      /** 字幕重切段后处理资产路径（2026-09-18 用户裁决：克隆完成即生成 srt/ 资产；
       *  主进程存在性校验命中则优先上传该 SRT 作 subtitle_srt，缺失回退 timing 现建） */
      srtPath?: string
      /** 文字模板命中行（服务端 /text_templates/match 选中行；2026-09-11 用户裁决：
       *  本地烧制与预览同源——仅本地合成链路预取，服务端链路由 concat 自行命中） */
      fxLines?: Array<{ text: string; start: number; end: number; keywords?: string[] }>
    }>
    progressChannel?: string
  }): Promise<{ results: string[]; taskIds?: string[] } | { error: string }>
  /** 回退扫描 outputs 排列视频（_collect_mix_candidates 回退段 + _get_out_montage_dir 规则） */
  finalCollectOutputs(payload: { dirPath: string }): Promise<{ files: string[]; outDir?: string } | { error: string }>
  /** 查找视频同目录配套 .srt（_find_srt_for_video：兼容 dubbed_/final_ 前缀） */
  finalFindSrt(payload: { videoPath: string }): Promise<{ srtPath: string } | { error: string }>
  /** 读句级时间轴 timing.json（[{text,start秒,end秒}]；文字模板效果预览时间轴用） */
  finalReadTiming(payload: { timingPath: string }): Promise<{ items: Array<{ text: string; start: number; end: number }> } | { error: string }>
  /** 回扫 final 目录已合成成片（2026-09-10 报障修复：刷新/重启后恢复列表；排除 .fx. 中间产物） */
  finalListResults(payload: { dirPath: string }): Promise<{ files: string[]; outDir?: string } | { error: string }>
  /** 剪映专业版草稿导出（JianyingExporter 一比一；mode single=单视频 / multi=多片段时间轴带转场） */
  jianyingExport(payload: {
    mode: 'single' | 'multi'
    videoPath?: string
    videoPaths?: string[]
    /** 2026-09-22 虚拟时间轴：逐段源裁剪时长（微秒，与 videoPaths 对齐；缺省=ffprobe 全长） */
    videoDurations?: Array<number>
    /** 2026-09-22 虚拟时间轴：视频段静音标记（true=全片静音走旁白轨；数组=逐段） */
    muteVideoAudio?: boolean | Array<boolean>
    transitions?: string | string[] | null
    bgmPath?: string
    bgmVolume?: number
    srtPath?: string
    srtPaths?: Array<string | null>
    /** 每条 SRT 的字幕窗口上限（µs，2026-09-24 文案混剪整段旁白）；null=该段自身时长 */
    srtLimitUs?: Array<number | null>
    fxWords?: string[]
    fxKinds?: Array<'fancy' | 'tpl'>
    textAnim?: string
    fancyEffectId?: string
    tplEffectId?: string
    /** 二期②④：字幕轨入场动画（本地语义 key）+ 视频特效 resource_id */
    subAnim?: string
    videoEffectId?: string
    videoEffectName?: string
    /** 2026-09-15：逐视频原生文字模板命中（match textfx_clips 权威指派）→ 导出器三件套轨 */
    textTemplateClips?: Array<Array<{ phrase: string; startUs: number; durUs: number; resourceId: string }>>
    /** 2026-09-15：逐视频口播 wav（音频三轨体系：口播轨独立，对应素材段静音） */
    voiceClips?: Array<Array<{ path: string; startUs: number; durUs: number }>>
    /** 2026-09-22 用户裁决「音效包装对齐导出」：镜级 AI 音效显式指派（音效包装产物落
     *  本地后的 {本地路径, 镜起点us, 镜长us}，逐视频；有显式指派时音效池事件轨让位） */
    sfxClips?: Array<Array<{ path: string; startUs: number; durUs: number }>>
    /** 2026-09-17：音效兜底来源（所选花字模板的本地 sound 声明；音效轨跟随文字模板命中位置） */
    fancyTemplate?: Record<string, unknown> | null
    /** 2026-09-18 用户裁决：音效池=服务端音频库剪映音效库 <2s 条目，主进程下载
     *  落盘目录（工程资产目录 sfx/；缺省回落临时目录） */
    sfxDestDir?: string
    /** 2026-09-17 用户报障①：服务端字幕样式对象 + UI 背景不透明度百分比 → 字幕轨文本样式 */
    subtitleStyle?: Record<string, unknown> | null
    subtitleBoxOpacity?: number | null
    /** 2026-09-18 用户裁决：字幕字号（第四步「字号」下拉；缺省 10 号） */
    subtitleFontSize?: number | null
    draftName?: string
  }): Promise<{ success: boolean; message: string; bgmIncluded?: boolean; schemaVersion?: { source: string; new_version: string; version: number; generator_app_version: string }; conformance?: { checkedSegs?: number; warnings?: string[] } }>
  /** 轨 2（2026-09-17 用户裁决）：服务端标准包导入——from-task 一步聚合包（含建草稿，
   *  jianying_cache_dir 必填）→ 解压 → 数据/路径校验 → 落盘剪映草稿目录 */
  editorExportJianyingPackage(payload: {
    taskIds: string[]
    progressChannel?: string
    /** 2026-09-18：草稿包 zip 落盘目录（工程资产目录 jy_pkg/；缺省回落临时目录）——
     *  zip 必须落盘后文件口径解压（stdin 流式读 zip 静默丢条目） */
    zipDestDir?: string
  }): Promise<{ success: boolean; message: string; results?: Array<{ taskId: string; draftFolder: string; warnings: string[]; registered: boolean }>; launched?: boolean; jianyingRunning?: boolean } | { success: false; message: string }>
  /** 剪映模板卡片数据源（§0.0 单一数据源：groups=服务端 /templates/catalog 结构+各 lane 数据；localAvailable=本机可同步清单） */
  jyTemplatesList(): Promise<{ ok: boolean; serverUrl?: string; groups: Array<{ group: string; lanes: Array<{ lane: string; total: number; endpoint: string; tags: Array<{ name: string; count: number }>; items: Array<Record<string, unknown>> }> }>; localAvailable?: Array<Record<string, unknown>> } | { error: string }>
  /** 批量同步选中模板到服务端（§0.0 同步目标即服务端） */
  jyTemplatesSync(payload: { ids: string[]; /** 音频（音效/音乐）逐条带行内所选入库分类 */ audios?: Array<{ id: string; category: string }> }): Promise<{ ok: boolean; results: Array<{ id: string; ok: boolean; name?: string; error?: string }> } | { error: string }>
  /** 从服务端模板库删除 */
  jyTemplatesDeleteServer(payload: { ids: string[] }): Promise<{ ok: boolean; results: Array<{ id: string; ok: boolean; error?: string }> } | { error: string }>
  /** 文字模板预设「服务端→本机剪映」安装（2026-09-30：GET /jianying_presets/text_v2
   *  全量 zip → Text_V2；ids 过滤 jy_<rid>，空=全量；已装同 resource_id 跳过；
   *  本机未装剪映（无 User Data\Presets）显式报错） */
  jyTemplatesInstall(payload: { ids?: string[] }): Promise<{ ok: boolean; installed: number; skipped: number; note: string } | { error: string }>
  /** AI 生成 BGM 服务端 URL 下载落盘（本端扩展：本地混音需本地文件） */
  bgmDownloadUrl(payload: { url: string; destDir: string }): Promise<{ path: string } | { error: string } | null>
  /** 文字模板真实动画预览素材：render-preview 小尺寸 alpha WebM 二进制（转 blob 播放） */
  // textfxPreviewClip/textfxClearClipCache 已废弃（2026-09-15：词条=纯标记不渲染）
  /** 服务端 LUT 库清单（GET /config/luts） */
  lutList(): Promise<{ luts: Array<Record<string, unknown>> } | { error: string } | null>
  /** 剪映模板页「字体（剪映）」分类：本机剪映字体清单（ResourcesFont + Cache 模板引用字体） */
  jyfontsScan(): Promise<{ fonts: Array<{ name: string; family: string; path: string; sizeKb: number; source: 'fontdir' | 'cache' }> } | { error: string }>
  /** 服务端已装字体清单（GET /config/fonts，voice:fonts 同源） */
  jyfontsServerList(): Promise<{ fonts: Array<Record<string, unknown>> } | { error: string } | null>
  /** 批量上传本机剪映字体到服务端字体库（名称互含命中已装则跳过；单条失败不阻断） */
  jyfontsUpload(payload: { paths: string[] }): Promise<{ ok: boolean; results: Array<{ path: string; name: string; ok: boolean; skipped?: boolean; error?: string }> } | { error: string }>

  // ---------- workflow（CoverMaker 一键成片编排）----------
  workflowRun(
    payload: WorkflowAPI.RunRequest
  ): Promise<IpcError<WorkflowAPI.RunResponse>>

  // ---------- llm ----------
  llmChat(
    payload: LLMAPI.ChatCompletionsRequest
  ): Promise<IpcError<LLMAPI.ChatCompletionsResponse>>
  /** GET /llm/models → 设置页「默认模型」下拉数据源（离线返回 null 或 {error}） */
  llmModels(): Promise<IpcError<LLMAPI.LlmModelsResponse>>

  // ---------- copywriting（智能混剪口播文案：服务端自持 prompt，product_desc + duration_s）----------
  copywritingVoiceover(
    payload: CopywritingAPI.VoiceoverRequest
  ): Promise<IpcError<CopywritingAPI.VoiceoverResponse>>

  // ---------- material ----------
  materialList(
    params?: MaterialAPI.ListRequest
  ): Promise<IpcError<MaterialAPI.ListResponse>>
  materialStockSearch(
    payload: MaterialAPI.StockSearchRequest
  ): Promise<IpcError<MaterialAPI.StockSearchResponse>>
  materialOcr(
    payload: MaterialAPI.OcrRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<MaterialAPI.OcrResponse>>

  // ---------- montage / prompt（M6/M8 条目⑥⑦ 服务端链路）----------
  montageSplit(
    payload: MontageAPI.SplitRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<MontageAPI.SplitResponse>>
  montageConcat(
    payload: MontageAPI.ConcatRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<MontageAPI.ConcatResponse>>
  montageBgm(
    payload: MontageAPI.BgmRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<MontageAPI.BgmResponse>>
  /** 清空混剪任务缓存（对照原版 _clear_montage_cache：删 montage_cache 下任务目录，不动原始素材） */
  clearMontageCache(dir: string): Promise<{ ok: boolean } | { error: string }>
  /** 出入场超长片段裁剪（PR#4 条目10：对照 EdgeClipTrimWorker；本地 ffmpeg 取中间段替换+改名） */
  trimEdgeClips(payload: {
    jobs: Array<{ path: string; startSec: number; endSec: number; idx: number; desc?: string; shotType?: string }>
    maxSec?: number
  }): Promise<{ renamed: Array<[string, string, number]>; skipped: number } | { error: string }>
  /** 镜内硬切拼接（2026-09-22 用户裁决：一镜多片——组内片段 concat demuxer 重编码拼接为一镜一文件） */
  montageConcatClips(payload: { clips: string[]; outPath: string }): Promise<{ path: string } | { error: string }>
  /** 成片完整性校验（PR#4 条目12：>1KB 且 ffprobe 可读；对照 _probe_video_ok；hasFile 区分未取到/损坏） */
  montageValidateFinal(path: string): Promise<{ ok: boolean; hasFile: boolean; duration?: number; error?: string }>
    /** 删除下载校验未通过的坏成片（防误删：仅限 montage_cache 目录内，2026-09-10） */
    montageDeleteBadFinal(path: string): Promise<{ ok: boolean } | { error: string }>
  /** POST /audio/gen/bgm — 生成 BGM（MusicGen-small；2026-09-05 服务端 GUIDE 新口径 {style,mood?,duration}，无 prompt），生成即出 {url, duration, engine} */
  audioGenBgm(payload: AudioAPI.GenBgmRequest): Promise<IpcError<AudioAPI.GenBgmResponse>>
  /** POST /audio/gen/sfx — AI 生成音效（AudioLDM2，原客户端 gen_sfx 同口径 {prompt,duration}） */
  audioGenSfx(payload: AudioAPI.GenSfxRequest): Promise<IpcError<AudioAPI.GenSfxResponse>>
  /** POST /audio/bgm/upload — 上传 BGM 入库（2026-09-04 服务端契约更新：multipart file+style/scene/mood/tags，tag 字段移除） */
  audioBgmUpload(payload: AudioAPI.BgmUploadRequest): Promise<IpcError<AudioAPI.BgmUploadResponse>>
  /** POST /audio/library/upload — 音频库直传（2026-09-05 服务端音频分流 audio_library 表：
   *  保存音效入库走此通道 category='音效'；/sfx 音效库不进左列表） */
  audioLibraryUpload(payload: AudioAPI.LibraryUploadRequest): Promise<IpcError<Record<string, unknown>>>
  /** @deprecated POST /sfx/analyze — 旧音效库分析入库（音频已分流 audio_library，客户端不再调用，保留待清理） */
  audioSfxAnalyze(payload: AudioAPI.SfxAnalyzeRequest): Promise<IpcError<AudioAPI.SfxAnalyzeResponse>>
  /** 生成结果 URL 下载临时目录（本端扩展：入库需本地文件，ext 按 Content-Type 判定） */
  audioDownloadTemp(payload: AudioAPI.DownloadTempRequest): Promise<AudioAPI.DownloadTempResponse>
  /** AI 生成音频归档到本地（PR#4 条目14：下载→Content-Type 定 ext→basePath+ext 落盘；
   *  basePath 不含扩展名，归档目录 outputs/ai_audio 由渲染层拼好；对照 _GenSaveWorker） */
  audioArchiveGen(payload: { url: string; basePath: string; defaultExt?: string }): Promise<{ path: string } | { error: string } | null>
  promptVideo(
    payload: MontageAPI.PromptVideoRequest,
    onProgress?: (percent: number) => void
  ): Promise<IpcError<MontageAPI.PromptVideoResponse>>

  // storyboard:listScripts/saveScript 通道已废弃（2026-09-15：与 useOpsStoryboard
  // 通用 server.get 重复移除；storyboard 域其余类型保留供类型引用）

  // ---------- system ----------
  systemLicenseVerify(payload: {
    activation_code: string
  }): Promise<IpcError<SystemAPI.LicenseVerifyResponse>>
}

// --------------------------------------------------------------------
// ffmpeg / shell / bridge
// --------------------------------------------------------------------
declare interface TintinBridgeFfprobeResult {
  duration: number
  width: number
  height: number
  fps: number
  codec: string
  audio_bitrate: number
  /** 'ffmpeg'：无 ffprobe 环境走 ffmpeg -i stderr 兜底（此时宽高为编码尺寸，
   *  不含旋转互换）；缺省表示 ffprobe 精确结果 */
  via?: string
}
declare interface TintinBridgeFfmpeg {
  probe(file: string): Promise<TintinBridgeFfprobeResult>
  /** 仅取时长（秒）；resources/bin 无 ffprobe.exe 时主进程回退 ffmpeg -i stderr 解析，失败返 0 */
  probeDuration(file: string): Promise<number>
  /** 预览可播性保障（2026-09-10）：Chromium 不可播编码（H.264 4:2:2/10bit、MP4+PCM 等）
   *  自动转码到临时缓存 mp4；可播/检测失败原路径直返 → { path, transcoded } 或 { error } */
  ensurePlayable(file: string): Promise<{ path: string; transcoded: boolean } | { error: string }>
  // （extractThumb 已废弃删除：预览缩略图改渲染层 canvas 抓帧，分辨率=视频真实分辨率，2026-09-07）
  /**
   * 批量抽帧 + base64（视觉模型研判类工具共用：视频评价预测/视频营销检测）。
   * 对照原客户端 hook_score_page.py / marketing_detect_page.py 抽帧段：
   * 输出目录由主进程按 tag 在 tmpdir 下清空重建，逐帧 scale=width:-2 / -q:v quality。
   * 抽帧时间点由渲染层纯函数计算，主进程不做策略决策。
   */
  extractFrames(payload: {
    videoPath: string
    times: number[]
    tag?: string
    width?: number
    quality?: number
  }): Promise<{
    frames?: Array<{ path: string; timeSec: number; base64: string }>
    outDir?: string
    error?: string
  }>
  /** 封面片头嵌入（原版 embed_cover_to_video 同语义：封面 2s 片头 concat + 音频延迟） */
  embedCover(
    video: string,
    cover: string,
    outPath: string,
    durationSec?: number
  ): Promise<string>
  concatSegments(paths: string[], outPath: string): Promise<string>
  extractAudio(video: string, outPath: string, format?: string): Promise<string>
  /**
   * 带缓存音频提取（M9 直播切片，原版 page.py L469-601 同口径）：
   * meta（mtime+size+路径）校验通过且未强制 → 复用缓存；否则按原版
   * AudioExtractWorker 同参数（pcm_s16le/16kHz/单声道 wav）重新提取。
   */
  extractAudioCached(
    video: string,
    forceReextract?: boolean
  ): Promise<{ path: string; cached: boolean; error?: string }>
  /** opts.reencode：两段式精确 seek + 重编码（原版 VideoClipWorker 同口径）；opts.srtPath：烧录切片段字幕 */
  cut(
    video: string,
    outPath: string,
    startSec: number,
    endSec: number,
    opts?: { reencode?: boolean; srtPath?: string }
  ): Promise<string>
}

/** 直播切片 M9 本地文件 I/O（渲染层策略 + 主进程纯 I/O，见 main/liveclip-ipc.js） */
declare interface TintinBridgeLiveclip {
  writeImageFile(payload: { path: string; base64: string }): Promise<{ ok?: boolean; path?: string; error?: string }>
  writeTextFile(payload: { path: string; content: string }): Promise<{ ok?: boolean; path?: string; error?: string }>
  writeTempText(payload: { basename: string; content: string }): Promise<{ path?: string; error?: string }>
  /** 文件存在性探测（2026-09-18：字幕后处理资产复用判定；exists=存在且非空） */
  fileExists(payload: { path: string }): Promise<{ ok?: boolean; exists?: boolean; error?: string }>
  /** 文件内容 MD5（2026-09-23 选择池判重；流式读取，hash=32 位 hex） */
  hashFile(payload: { path: string }): Promise<{ ok?: boolean; path?: string; hash?: string; error?: string }>
}
declare interface TintinBridgeShell {
  openExternal(url: string): void
  showNotification(
    title: string,
    body: string,
    icon?: string,
    onClick?: () => void
  ): void
  openItem(path: string): void
  revealInFolder(path: string): void
}
declare interface TintinBridgeStatus {
  ready: boolean
  port: number
}
declare interface TintinBridgeBridge {
  getStatus(): Promise<TintinBridgeStatus>
  navigate(path: string): Promise<void>
}

// --------------------------------------------------------------------
// P1.5 厚壳化：win（自绘标题栏 + 窗口控制，§1.3.1 A3）
// --------------------------------------------------------------------
export interface TintinBridgeWinState {
  width: number
  height: number
  x: number
  y: number
  minimized: boolean
  maximized: boolean
  fullscreen: boolean
  resizable: boolean
  maximizable: boolean
  minimizable: boolean
  closable: boolean
  focused: boolean
  title: string
}
declare interface TintinBridgeWin {
  getState(): Promise<{ success: boolean; data?: TintinBridgeWinState; error?: string }>
  minimize(): Promise<{ success: boolean; error?: string }>
  toggleMaximize(): Promise<{ success: boolean; data?: TintinBridgeWinState; error?: string }>
  close(): Promise<{ success: boolean; error?: string }>
  onStateChange(cb: (state: TintinBridgeWinState) => void): () => void
}

// --------------------------------------------------------------------
// P1.5 厚壳化：browser（BrowserView 真嵌入，§1.3.2 B3+B4+B6）
// --------------------------------------------------------------------
declare type BrowserPlatformId = 'douyin' | 'weixin' | 'kuaishou' | 'xiaohongshu' | 'bilibili' | 'youtube' | 'jimeng'
declare interface BrowserAttachResult {
  platformId: BrowserPlatformId
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
  title: string
}
declare interface BrowserNavigateResult {
  platformId: BrowserPlatformId
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
}
declare interface BrowserBounds {
  platformId: BrowserPlatformId
  x: number
  y: number
  width: number
  height: number
}

/** Cherry Studio：BrowserView bounds 校验报告（期望值 vs Electron 实际生效值） */
declare interface BrowserBoundsVerifyReport {
  platformId: BrowserPlatformId
  /** 是否 attach 在主窗口 getBrowserViews() 内 */
  attached: boolean
  /** 是否在窗口可见范围内（排除负值/越界） */
  visible: boolean
  actual: { x: number; y: number; width: number; height: number }
  expected?: { x: number; y: number; width: number; height: number }
  /** 最大边差，单位 px */
  deltaPx?: number
  tolerancePx: number
  /** 是否在容忍阈值内（<= 3px 算 OK） */
  withinTolerance?: boolean
  /** 主窗口尺寸（用于越界诊断） */
  winSize: { width: number; height: number }
  ts: number
}

declare interface TintinBridgeBrowser {
  attachPlatform(platformId: BrowserPlatformId, seedUrl?: string):
    Promise<{ success: boolean; data?: BrowserAttachResult; error?: string }>
  detachAll(): Promise<{ success: boolean; error?: string }>
  setBounds(bounds: BrowserBounds):
    Promise<{
      success: boolean
      data?: { x: number; y: number; width: number; height: number }
      verify?: {
        expected: { x: number; y: number; width: number; height: number }
        actual:   { x: number; y: number; width: number; height: number }
        deltaPx: number
        tolerancePx: number
        withinTolerance: boolean
      }
      error?: string
    }>
  navigate(payload: {
    platformId: BrowserPlatformId
    back?: boolean
    forward?: boolean
    reload?: boolean
    url?: string
  }): Promise<{ success: boolean; data?: BrowserNavigateResult; error?: string }>
  extractDOM(platformId: BrowserPlatformId):
    Promise<{ success: boolean; ok?: boolean; data?: any; error?: { type: string; message: string; hint?: string } }>
  /** 浮动面板：独立原生窗口（扩展/设置/下载）；openSettingsPanel 的 data 为平台列表 [{id,name,badge}] */
  openExtensionsPanel(x: number, y: number): void
  closeExtensionsPanel(): void
  openSettingsPanel(x: number, y: number, data?: { id: string; name: string; badge: string }[]): void
  closeSettingsPanel(): void
  /** 下载管理浮窗：独立原生窗口（历史 + 文件操作；实时进度内嵌嗅探卡片） */
  openDownloadsPanel(x: number, y: number): void
  closeDownloadsPanel(): void
  /** Cherry Studio：主动校验 bounds（渲染端期望 vs 主进程实际） */
  verifyBounds(payload: {
    platformId: BrowserPlatformId
    expected?: { x: number; y: number; width: number; height: number }
  }): Promise<{ success: boolean; data?: BrowserBoundsVerifyReport; error?: string }>
  onUrlUpdated(cb: (payload: { platformId: BrowserPlatformId; url: string; ts: number; inPage?: boolean }) => void): () => void
  onDownloadsUpdated(cb: (payload: {
    platformId: BrowserPlatformId
    kind: 'will-download' | 'progress' | 'completed' | 'cancelled' | 'interrupted' | string
    filename: string
    size?: number
    receivedBytes?: number
    totalBytes?: number
    percent?: number
    savePath?: string
    sourceUrl?: string
  }) => void): () => void
  /** Cherry Studio：订阅 BrowserView did-stop-loading 广播 → 收到立刻重算 bounds */
  onViewReady(cb: (payload: { platformId: BrowserPlatformId; url: string; title: string; ts: number }) => void): () => void
  /** B站扩展下载链接订阅 */
  onBiliExtDownloads(cb: (payload: {
    platformId: BrowserPlatformId
    payload: {
      source: string
      title: string
      downloads: Array<{ url: string; download: string; text: string; sizeText: string }>
      url: string
      ts: number
    }
    ts: number
  }) => void): () => void
  /** 安装扩展（crx/zip）→ 对每个平台隔离 session 逐个 loadExtension */
  installExtension(filePath: string): Promise<{ success: boolean; message?: string; data?: any }>
  /** 卸载扩展 */
  uninstallExtension(id: string): Promise<{ success: boolean; message?: string }>
  /** 扩展列表变更订阅（安装/卸载后主进程广播） */
  onExtensionsChanged(cb: () => void): () => void
  /** 列出平台 partition cookies（条目⑧ 登录态检测链路；cookie 字段已摘要化，不含 value） */
  cookieList(platformId: string): Promise<{
    success: boolean
    data?: { platformId: string; count: number; cookies: Array<{
      name: string; domain: string; path: string; secure: boolean; httpOnly: boolean; session: boolean; expirationDate?: number
    }> }
    error?: string
  }>
  /** 清除平台 partition cookies */
  cookieClear(platformId: string): Promise<{ success: boolean; error?: string }>
}

// --------------------------------------------------------------------
// 条目⑩ 账号与登录：飞书连接测试（凭据补全在主进程，明文不出展示层）
// --------------------------------------------------------------------
declare interface TintinBridgeFeishu {
  testConn(payload: { appId: string; appSecret: string }): Promise<{ ok: boolean; message: string }>
}

// --------------------------------------------------------------------
// A2 双模式推理（§1.5）—— 类型声明（保持简洁，业务层按需细化）
// --------------------------------------------------------------------
declare interface TintinBridgeConfig {
  get<T = any>(key: string, defaultValue?: T): Promise<T>
  set(key: string | Record<string, any>, value?: any): Promise<boolean>
}
declare interface TintinBridgeModel {
  listPkgs(): Promise<any>
  downloadPkg(pkgId: string): Promise<any>
  cancelPkg(pkgId: string): Promise<any>
  uninstallPkg(pkgId: string): Promise<any>
}
declare interface TintinBridgeInference {
  getCapability(force?: boolean): Promise<any>
  setMode(mode: 'server-only' | 'hybrid-auto' | 'force-local'): Promise<any>
}
declare interface TintinBridgeOcr {
  imageToText(payload: any, onProgress?: (percent: number) => void): Promise<any>
}
declare interface TintinBridgeKnowledge {
  listDocuments(params?: any): Promise<any>
  deleteDocument(id: string): Promise<any>
  vectorSearch(payload: any): Promise<any>
}

// --------------------------------------------------------------------
// D4 浏览器域独立窗口（browserWindow:open —— 主窗口按钮 / hotspot 到点打开）
// --------------------------------------------------------------------
declare interface TintinBridgeBrowserWindow {
  /** 打开浏览器独立窗口（单实例：已存在 → 恢复 + 聚焦；hotspot=true 时窗口就绪后补发热点导航信号） */
  open(opts?: { hotspot?: boolean; count?: number | null }): Promise<{
    success: boolean
    created?: boolean
    error?: string
  }>
}

// --------------------------------------------------------------------
// 办公能力集成（office:* 主进程 handler，PRD §4.2）
// 主窗口经 tintin.office.*（preload.js），浏览器窗口经 tintinBrowser.office.*
// （browser-preload.js），通道同源复用（office:saveFile / openPath /
//   previewDocx / readXlsx）；错误态统一 { error }，取消保存返回 { saved:false }。
// --------------------------------------------------------------------
declare interface TintinBridgeOffice {
  /** 系统保存对话框 + 写入；返回 {saved:true,path} | {saved:false}(取消) | {error} */
  saveFile(payload: {
    filename: string
    ext: 'docx' | 'xlsx'
    data: ArrayBuffer | Uint8Array
  }): Promise<{ saved: boolean; path?: string; error?: string }>
  /** 系统默认程序打开（shell.openPath）→ {ok} | {ok:false,error} */
  openPath(filePath: string): Promise<{ ok: boolean; error?: string }>
  /** docx → HTML（mammoth 主进程转换 + 样式注入）→ {html} | {error} */
  previewDocx(filePath: string): Promise<{ html?: string; error?: string }>
  /** xlsx → 多 Sheet 表格（exceljs 读，首 200 行截断）→ {sheets} | {error} */
  readXlsx(filePath: string): Promise<{
    sheets?: Array<{ name: string; rows: any[][] }>
    error?: string
  }>
}

// --------------------------------------------------------------------
// 视频评价预测记录库（prediction:* 主进程 handler）
// 对照原客户端 studio/utils/video_prediction_manager.py：
//   保存每次预测结果 + 发布后回填的真实播放量/平台评价，
//   「预测 vs 实际」对照反哺下次预测（校准文本由渲染层纯函数拼接）。
// 存储：userData/video_predictions.json（JSON Manager 模式，同 creators-store）。
// --------------------------------------------------------------------
declare interface TintinVideoPredictionRecord {
  id: string
  video_path: string
  video_name: string
  platform: string
  /** 模型输出的评分 JSON（total/play_level/golden3s/dims/comment/suggestions） */
  predicted: Record<string, any>
  /** 回填后为 { play_count, platform_eval, at }；未回填为 null */
  actual: { play_count: string; platform_eval: string; at: number } | null
  created_at: number
}
declare interface TintinBridgePrediction {
  /** 全量记录（倒序，最新在前） */
  list(): Promise<{ items?: TintinVideoPredictionRecord[]; error?: string }>
  /** 新增一条预测记录，返回其 id（对照 add_prediction） */
  add(payload: {
    videoPath: string
    platform: string
    predicted: Record<string, any>
  }): Promise<{ id?: string; error?: string }>
  /** 回填真实数据（对照 set_feedback） */
  setFeedback(payload: {
    id: string
    playCount: string
    platformEval: string
  }): Promise<{ ok?: boolean; error?: string }>
}

/** 环境通道（env:*；polyfill 2026-09-23 起逐项落地，对齐 SRC env-ipc 契约） */
declare interface TintinBridgeEnv {
  log(entry: { level?: string; tag?: string; message?: string; stack?: string }): unknown
  serverPing(): Promise<{ online: boolean; url: string; status?: number; latencyMs?: number }>
  cacheDir(): Promise<{ dir?: string; error?: string }>
  clearCache(): Promise<{ ok?: boolean; error?: string }>
  /** SRC env:getMachineId 契约 {ok,machineId}；产品资料域以 machineId 拼
   *  /api/product-library/clients/<machine_id> 请求路径（与 X-Machine-ID 同值） */
  getMachineId(): Promise<{ ok: boolean; machineId: string; error?: string }>
  /** 系统下载文件夹（宿主纯 node 拼 USERPROFILE）。传文件名 → {path: 去重后
   *  完整目标（同名追加 (n)）}；缺省 → {dir}。「下载直落下载文件夹」数据源 */
  downloadsDir(fileName?: string): Promise<{ dir?: string; path?: string; error?: string }>
}

/** 预览解锁（media:unlock）：用户自选目录单文件登记后 /tintin/media 放行；
 *  永不 reject（fire-and-forget 调用点） */
declare interface TintinBridgeMedia {
  unlock(path: string): Promise<{ ok?: boolean; error?: string } | undefined>
}

/** 会话上下文条 → 工作区 task.json（WP-5b，2026-09-25）：
 *  不改 dsh 底层的业务上下文注入——上下文条选中条目后整体写入，agent 经
 *  自带 read 工具消费。载荷形状见 composables/contextTaskLogic.ts
 *  （TintinTaskContext；宿主派生路径并防御解析，超限截断）。 */
declare interface TintinBridgeContext {
  writeTask(task: {
    product?: Record<string, unknown> | null
    materials?: Record<string, unknown>[]
    scripts?: Record<string, unknown>[]
    audios?: Record<string, unknown>[]
  }): Promise<{ ok?: boolean; path?: string; error?: string }>
}

declare interface TintinBridge {
  app: TintinBridgeApp
  dialog: TintinBridgeDialog
  downloads: TintinBridgeDownloads
  server: TintinBridgeServer
  ffmpeg: TintinBridgeFfmpeg
  // 环境通道（env:*：log/serverPing/cacheDir/clearCache/getMachineId）
  env: TintinBridgeEnv
  // 预览解锁（media:unlock——用户自选目录单文件登记后 /tintin/media 放行）
  media: TintinBridgeMedia
  // 会话上下文注入（context:writeTask——工作区 task.json，WP-5b）
  context: TintinBridgeContext
    // 参考视频下载（yt-dlp 单引擎：YouTube/Bilibili，OpenCreator download 架构）
    ytdlp: TintinBridgeYtdlp
  // M9 直播切片（封面/导出字幕/临时烧字幕 SRT）
  liveclip: TintinBridgeLiveclip
  shell: TintinBridgeShell
  bridge: TintinBridgeBridge
  // P1.5 厚壳化
  win: TintinBridgeWin
  browser: TintinBridgeBrowser
  // D4 浏览器域独立窗口
  browserWindow: TintinBridgeBrowserWindow
  // 办公能力集成（office:*）
  office: TintinBridgeOffice
  // 视频评价预测记录库（prediction:*）
  prediction: TintinBridgePrediction
  // A2 双模式
  config: TintinBridgeConfig
  model: TintinBridgeModel
  inference: TintinBridgeInference
  ocr: TintinBridgeOcr
  knowledge: TintinBridgeKnowledge
  // P2 本地定时任务（schtasks）
  scheduled: TintinBridgeScheduled
  // 条目⑩ 账号与登录（飞书）
  feishu: TintinBridgeFeishu
  clientTasks: TintinBridgeClientTasks // W11 客户端任务活动订阅（client-task:activity → 任务队列实时刷新）
}
declare interface TintinBridgeClientTasks {
  /** 订阅客户端任务活动事件（返回取消函数） */ onActivity(cb: (payload: { type?: string; task_id?: string; ok?: boolean; status?: string }) => void): () => void
}

/** 参考视频下载（yt-dlp）桥类型 */
declare interface TintinYtdlpOption {
  id: string
  mediaType: 'video' | 'audio'
  label: string
  detail: string
  videoFormatId?: string
  audioFormatId?: string
  kbps?: number
  estimatedSize?: number
}
declare interface TintinYtdlpProbe {
  id: string
  title: string
  uploader: string
  duration: number
  thumbnail: string
  extractorKey: string
  platform: 'bilibili' | 'youtube'
  webpageUrl: string
  resolution: string
}
declare interface TintinBridgeYtdlp {
  status(): Promise<{ available: boolean; path: string; external: boolean }>
  probe(payload: { url: string; proxy?: string }): Promise<{ probe?: TintinYtdlpProbe; options?: TintinYtdlpOption[]; error?: string; code?: string; loginCounts?: Record<string, number> | null }>
  download(payload: { url: string; option: TintinYtdlpOption; proxy?: string }): Promise<{ path?: string; fileName?: string; normalized?: boolean; meta?: { width?: number; height?: number; duration?: number } | null; error?: string; code?: string }>
  saveAs(payload: { src: string; dst: string }): Promise<{ ok?: boolean; error?: string }>
  /** 未登录引导：经壳层回环打开对应平台的内置浏览器窗口（2026-09-28 用户裁决） */
  openLoginBrowser(payload: { platform: string }): Promise<{ ok?: boolean; error?: { type?: string; message?: string } }>
  /** 下载进度事件，返回取消函数 */
  onProgress(cb: (p: { phase: string; pct: number }) => void): () => void
}

// --------------------------------------------------------------------
// scheduled — 本地定时任务（对照原客户端 utils/local_scheduler.py）
// --------------------------------------------------------------------
/** LLM 拆解出的执行步骤（对齐原版 build_plan 产物 / 服务端 mode=execute 契约） */
declare interface TintinBridgeAgentPlan {
  goal: string
  steps: Array<{
    id: string
    capability: string
    params: Record<string, unknown>
    depends_on: string[]
    needs_user_input: boolean
  }>
}

declare interface TintinBridgeScheduledTask {
  task_name: string
  name: string
  type: 'hotspot' | 'agent'
  schedule: { mode: 'daily' | 'weekly'; time: string; weekdays: number[] }
  goal: string
  plan?: TintinBridgeAgentPlan | null
  created_at: string
  registered?: boolean
  next_run?: string
  last_run?: string
  last_result?: string
}
export type { TintinBridgeScheduledTask, TintinBridgeAgentPlan }
declare interface TintinBridgeScheduled {
  list(): Promise<TintinBridgeScheduledTask[]>
  create(payload: {
            name: string
            taskType: 'hotspot' | 'agent'
            schedule: { mode: 'daily' | 'weekly'; time: string; weekdays?: number[] }
            goal?: string
            plan?: TintinBridgeAgentPlan | null
          }): Promise<[boolean, string]>
          /** LLM 拆解任务描述 → [true, plan] 或 [false, 错误信息]（对照原版 build_plan） */
  splitPlan(goal: string): Promise<[boolean, TintinBridgeAgentPlan | string]>
  run(taskName: string): Promise<[boolean, string]>
  delete(name: string): Promise<[boolean, string]>
  /** 手动采集今日各平台热榜 → [true, 采集条数] 或 [false, 错误信息]（对照原版「一键采集」） */
  captureHotspots(): Promise<[boolean, number | string]>
  /** 采集进度推送：{ platform, index, total } */
  onScheduledCaptureProgress(cb: (p: { platform: string; index: number; total: number }) => void): () => void
  /** hotspot 到点触发（采集完成后通知切浏览器 Tab；payload.count = 采集条数，可能为 null） */
  onScheduledHotspot(cb: (payload?: { count?: number | null }) => void): () => void
}

// --------------------------------------------------------------------
// D3 浏览器域独立 preload：window.tintinBrowser（browser-preload.js）
// 浏览器域（src/browser/）只经本命名空间走 IPC，与 window.tintin（主应用）隔离。
// 复用既有类型：TintinBridgeBrowser / TintinBridgeScheduled /
//   TintinBridgeConfig / TintinBridgeWin（见上）。
// --------------------------------------------------------------------
declare interface TintinBrowserBridgeBrowser extends TintinBridgeBrowser {
  /** 列出已装扩展（含内置 B站助手 + 用户安装扩展；preload.js 亦暴露但原类型缺漏，此处补全） */
  extensionList(): Promise<{ success: boolean; data?: { installed: boolean; extensions?: Array<{
    id: string; name: string; version: string; path?: string; icon?: string | null; builtin?: boolean; description?: string
  }> } }>
  exportCookies(platformId: string, destPath: string): Promise<{ success: boolean; count?: number; error?: string }>
  getCookieStatus(platformId: string): Promise<{ success: boolean; platformId?: string; hasLoginCookie?: boolean; cookies?: any[] }>
  getCurrentUrl(platformId: string): Promise<{ success: boolean; platformId?: string; url?: string; title?: string }>
  // B9 每日素材（main/daily-assets.js）：按日期扫描下载目录 + 文件定位/打开
  getDailyAssets(): Promise<{ success: boolean; data?: Array<{
    date: string
    files: Array<{ name: string; path: string; size: number; type: 'video' | 'image' | 'text' | 'file' }>
  }>; error?: string }>
  revealFile(filePath: string): Promise<{ success: boolean; error?: string }>
  openFilePath(filePath: string): Promise<{ success: boolean; error?: string }>
}

declare interface TintinBrowserMediaDownload {
  start(params: {
    taskId: string
    url: string
    audioUrl?: string
    filename?: string
    title?: string
    referer?: string
    platformId?: string
    subDir?: string
    useYtdlp?: boolean
  }): Promise<{ success: boolean; taskId?: string; error?: string }>
  pause(taskId: string): Promise<{ success: boolean; error?: string }>
  cancel(taskId: string): Promise<{ success: boolean; error?: string }>
  /** 共享 channel：browser:downloads-updated（{ taskId, status, progress, speed, downloaded, totalSize, filename }） */
  onProgress(cb: (p: any) => void): () => void
}

declare interface TintinBrowserMediaStorage {
  getSniffed(): Promise<{ success: boolean; data?: any[] }>
  saveSniffed(list: any[]): Promise<{ success: boolean }>
  getDownloads(): Promise<{ success: boolean; data?: any[] }>
  saveDownloads(list: any[]): Promise<{ success: boolean }>
  getSettings(): Promise<{ success: boolean; data?: any }>
  saveSettings(s: any): Promise<{ success: boolean }>
  getFavorites(): Promise<{ success: boolean; data?: any[] }>
  saveFavorites(list: any[]): Promise<{ success: boolean }>
  addFavorite(item: any): Promise<{ success: boolean; data?: any[] }>
  removeFavorite(url: string): Promise<{ success: boolean; data?: any[] }>
  export(format: string, filePath: string): Promise<{ success: boolean }>
  import(filePath: string): Promise<{ success: boolean }>
  clearHistory(type: string): Promise<{ success: boolean }>
  openDownloadDir(): Promise<{ success: boolean }>
}

declare interface TintinBrowserHistory {
  open(items: Array<{ index: number; url: string; title: string; timestamp: number }>, x: number, y: number): void
  close(): void
  onNavigate(cb: (index: number) => void): () => void
  onCleared(cb: () => void): () => void
}

// --------------------------------------------------------------------
// B10 达人/创作者库（main/creators-store.js）：达人 JSON 存储 + 主页全量采集
//   采集清单条目落 userData/creators/collected.json（B8 素材库衔接点）
// --------------------------------------------------------------------
declare interface TintinBrowserCreatorItem {
  id: string
  platform: string
  name: string
  homepageUrl?: string
  addedAt?: number
}
declare interface TintinBrowserCollectedItem {
  platform: string
  creatorId: string
  creatorName: string
  title: string
  url: string
  source: string
  date: string
  collectedAt: string
}
declare interface TintinBrowserCreators {
  getCreators(): Promise<{ success: boolean; data?: TintinBrowserCreatorItem[]; error?: string }>
  addCreator(creator: TintinBrowserCreatorItem): Promise<{ success: boolean; data?: TintinBrowserCreatorItem[]; error?: string }>
  deleteCreator(payload: { id: string; platform: string }): Promise<{ success: boolean; data?: TintinBrowserCreatorItem[]; error?: string }>
  getCollected(): Promise<{ success: boolean; data?: TintinBrowserCollectedItem[]; error?: string }>
  collectFromCreator(payload: { creator: TintinBrowserCreatorItem }): Promise<{
    success: boolean
    data?: { count: number; items: TintinBrowserCollectedItem[]; profileUrl: string }
    error?: string
  }>
  /** 采集进度推送：{ phase } */
  onCollectProgress(cb: (p: { phase: string }) => void): () => void
}

// --------------------------------------------------------------------
// B8 素材入库（main/material-import.js）：采集清单/每日素材 →
//   /material/web_download 异步下载任务 → 本地导入任务记录 → 可选分析队列
//   imported 状态：submitted（待处理）/ failed（失败+原因）/ imported（已入库）
// --------------------------------------------------------------------
declare interface TintinBrowserImportTask {
  taskId: string
  url: string
  title?: string
  platform?: string
  shareName?: string
  status?: 'submitted' | 'imported' | 'failed' | string
  submittedAt?: string
  updatedAt?: string
}
declare interface TintinBrowserMaterialImport {
  /** 提交入库：{ items: 采集条目[] | 每日素材[{name,path,...}], opts?: { shareName?, maxFilesize?, format?, enqueueAnalysis? } } */
  import(payload: {
    items: Array<Record<string, any>>
    opts?: {
      shareName?: string
      maxFilesize?: number
      format?: string
      enqueueAnalysis?: boolean
    }
  }): Promise<{
    success: boolean
    error?: string
    data?: {
      submitted: number
      failed: number
      duplicates: number
      noUrl: number
      markedCount: number
      tasks: TintinBrowserImportTask[]
      results: Array<{ url: string; taskId?: string; error?: string }>
      analysis?: unknown
      analysisError?: unknown
      firstError?: string
    }
  }>
  /** 本地导入任务记录（去重/状态跟踪） */
  listTasks(): Promise<{ success: boolean; data?: TintinBrowserImportTask[]; error?: string }>
  /** 轮询服务端下载任务状态（GET /material/web_download/{task_id}）并回写本地记录 */
  status(taskId: string): Promise<{
    success: boolean
    data?: { taskId: string; status: 'submitted' | 'imported' | 'failed' | string; raw: unknown }
    error?: string
  } | null>
}

// --------------------------------------------------------------------
// B12 自动上架：tintinBrowser.autoListing 类型见 types/auto-listing.d.ts
//   （7 条 IPC + 订阅式进度 channel 'auto-listing:progress'）
// --------------------------------------------------------------------
declare interface TintinBrowserBridge {
  browser: TintinBrowserBridgeBrowser
  mediaDownload: TintinBrowserMediaDownload
  mediaStorage: TintinBrowserMediaStorage
  history: TintinBrowserHistory
  scheduled: TintinBridgeScheduled
  config: TintinBridgeConfig
  win: TintinBridgeWin
  creators: TintinBrowserCreators
  materialImport: TintinBrowserMaterialImport
  autoListing: TintinBrowserAutoListing
  /** 办公能力集成（office:* 主进程 handler，与主应用同通道复用） */
  office: TintinBridgeOffice
}

declare global {
  interface Window {
    tintin: Readonly<TintinBridge>
    tintinBrowser: Readonly<TintinBrowserBridge>
    /** 跨 bundle 小事件总线（tintin-bundle chrome 定义；创作插件包同名兜底）。
     *  可选：旧安装缺总线时调用方优雅降级（2026-10-17 创作模式拆包） */
    __tintinBus?: {
      on: (name: string, fn: (payload: unknown) => void) => void
      off: (name: string, fn: (payload: unknown) => void) => void
      emit: (name: string, payload?: unknown) => void
    }
  }
}

export {}
