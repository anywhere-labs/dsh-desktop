// API 路径字典——自媒体包 types/server-api.ts 一比一拷贝（2026-10-17 快照；
// 独立 bundle 不交叉导入源码，paths 漂移由对齐测试把关）。
export const API_PATHS = {
  health: {
    capabilities: '/health/capabilities',
    check:        '/health/check',
  },
  stats: {
    workbench: '/stats/workbench',
  },
  llm: {
    chatCompletions: '/llm/chat/completions',
    adjustCopywriting: '/script/adjust-copywriting',
    list:  '/script/list',
  },
  asr: {
    transcribe: '/whisper/transcribe',
  },
  workflow: {
    run: '/workflow/run',
  },
  material: {
    list:        '/material/list',
    search:      '/material/search',
    serve:       '/material/serve',
    ocr:         '/material/ocr',
    stockSearch: '/material/stock_search',
    scoreClip:   '/material/score-clip',
  },
  montage: {
    split:    '/montage/split',
    concat:   '/montage/concat',
    bgm:      '/montage/bgm',
    auto:     '/montage/auto-mix',
  },
  audio: {
    genBgm:  '/audio/gen/bgm',    // AI 生成 BGM（MusicGen-small，原客户端 gen_bgm 同口径）
  },
  prompt: {
    video:    '/prompt/video',
  },
  vsr: {
    enhance: '/vsr/enhance',      // V3 S2
    remove:  '/vsr/remove',
  },
  viral: {
    // 仿爆款（Viral Clone）后端端点；请求/响应字段以原客户端 viral_clone_client.py 实际调用为准
    analyze:  '/viral/clone/analyze',   // 拆解爆款（同步）
    plan:     '/viral/clone/plan',      // 复刻规划（同步，依赖 analyze）
    flow:     '/viral/clone/flow',      // 全链一条调用（拆解 + 复刻规划）
    generate: '/viral/clone/generate',  // 三替换素材生成 v1（服务端 E-3.0 就绪后开放）
    montage:  '/viral/clone/montage',   // 复刻成片组装 v1
    review:   '/viral/clone/review',    // 复刻 vs 爆款对比报告
    pipeline: '/viral/clone/pipeline',  // 替换管道串联（后台任务 + poll）
  },
  rembg: {
    // 2026-09-07 契约对齐：服务端实装 POST /matting（file+model，同步回 PNG 二进制）+ GET /matting/models；
    // 旧 /rembg/matting 异步任务模式从未实装（openapi 无此路径）
    matting: '/matting',
    models:  '/matting/models',
  },
  vision: {
    reversePrompt: '/vision/reverse-prompt',  // V3 S3
  },
  digitalHuman: {
    generate:   '/digital-human/generate',
    listModels: '/digital-human/models',
  },
  comfygen: {
    // 仿视频 V3.5 §11-19（2026-10-02）：枚举唯一源——gen_spec 快照（非代理，
    // comfygen 离线可用），含 scene 四要素/cameras/fidelity 中文标签与 ratio→尺寸换算
    enums: '/comfygen/enums',
  },
  copywriting: {
    // 文案生成（VoiceoverIn：product_desc 必填/duration_s/hint/formula/platform/skill_id）
    // ——文案混剪 Step1 十稿全量+仿视频第 2 步「重新生成文案」共用；formula 缺省=每次
    // 返回约 10 种文案写法（2026-10-03 用户裁决），platforms=平台字典（下拉数据源）
    voiceover: '/copywriting/voiceover',
    platforms: '/copywriting/platforms',
  },
  // TTS 统一入口（/indextts/tts，IndexTTSRequest：text 必填，engine/sample_id 可选——
  // 客户端默认 voxcpm=2026-09-28 用户裁决，整段直发不拆句）：仿视频口播配音
  tts: '/indextts/tts',
  voice: {
    // 声音样本库（GET /voice/samples，audio_url 字段——与声音克隆页/文案混剪 Step3 同源；
    // 仿视频配音的参考声音下拉）
    samples: '/voice/samples',
  },
  storyboard: {
    scriptsList: '/api/storyboard/scripts',
    scriptsItem: (id: string) => `/api/storyboard/scripts/${id}`,
    // 九宫分镜粗稿整体确认（v4.3 闸门①：draft_status→confirmed，解锁 stage=frames 精稿）
    draftConfirm: (id: string) => `/api/storyboard/scripts/${id}/draft/confirm`,
    // 仿写文案分配到逐镜旁白（2026-10-04：text 缺省=主稿，服务端按镜切分写 shot.audio）
    distributeVoiceover: (id: string) => `/api/storyboard/scripts/${id}/distribute-voiceover`,
    // 仿写文案重写画面/旁白/场景（2026-10-04 上线：text 缺省=主稿；LLM 按新文案重出 visual/scene/audio）
    rewriteVisuals: (id: string) => `/api/storyboard/scripts/${id}/rewrite-visuals`,
    sixView: (id: string) => `/api/storyboard/scripts/${id}/six-view`,
    sixViewResult: (taskId: string) => `/api/storyboard/scripts/six-view/result/${taskId}`,
    sixViewDelete: (id: string, view: string) => `/api/storyboard/scripts/${id}/six-view/${view}`,
    save:        '/api/storyboard/scripts',
    // 仿视频 V3.5（PRD-M-5，2026-10-02 v1.0+评审复核 §9 新增最小集）：
    // 实测（2026-10-02 openapi 探针）：imitate 挂在 scripts 集合下
    imitate:     '/api/storyboard/scripts/imitate',
    // 本地视频预上传（multipart file → 入素材库 → material://{id} 作 imitate.video）
    imitateUpload: '/api/storyboard/scripts/imitate/upload',
    // HumanGate② 数据面（实测 multipart：first/last 文件 + confirmed 布尔）
    shotFrames:  (id: string, name: string) => `/api/storyboard/scripts/${id}/shots/${encodeURIComponent(name)}/frames`,
    // 九宫图总览 PNG（v4.7 契约 2026-10-05：服务端 worker 落 FRAMES_ROOT/{sid}/storyboard.png
    // + 回填 meta.storyboard_grid={path,source}；客户端 GET 本端点直取展示）
    storyboardGrid: (id: string) => `/api/storyboard/scripts/${id}/storyboard-grid`,
    // Seedance 交付包（v4.9 收口 2026-10-05：九宫格图一张+逐镜 prompt_zh/camera_zh/
    // seed_base/duration/粗稿帧 URL 一次取全——九宫格图+提示词=Seedance 生成视频交付物）
    storyboardPack: (id: string) => `/api/storyboard/scripts/${id}/storyboard-pack`,
  },
  agent: {
    registry:              '/agent/registry',
    tasks:                 '/agent/tasks',
    tasksItem:             (id: string) => `/agent/tasks/${id}`,
    tasksItemConfirm:      (id: string) => `/agent/tasks/${id}/confirm`,
    tasksItemPause:        (id: string) => `/agent/tasks/${id}/pause`,
    tasksItemResume:       (id: string) => `/agent/tasks/${id}/resume`,
    tasksItemRetry:        (id: string) => `/agent/tasks/${id}/retry`,
    tasksItemCancel:       (id: string) => `/agent/tasks/${id}/cancel`,
    artifacts:             '/agent/artifacts',
    tasksArtifacts:        (id: string) => `/agent/tasks/${id}/artifacts`,
    chat:                  '/agent/chat',
    sessionsList:          '/agent/sessions',
    sessionsItem:          (id: string) => `/agent/sessions/${id}`,
  },
  tasks: {
    unifiedList:            '/tasks/unified',
    unifiedItem:            (id: string) => `/tasks/unified/${id}`,
    item:                   (id: string) => `/tasks/${id}`,
    itemResult:             (id: string) => `/tasks/${id}/result`,
  },
  scheduled: {
    tasksList: '/scheduled/tasks',
    tasksItem: (id: string) => `/scheduled/tasks/${id}`,
  },
  editor: {
    renderPackage: (id: string) => `/editor/render/${id}/package`,
  },
  system: {
    license: '/system/license',
    licenseMachineId: '/system/license/machine-id',
    guide:   '/guide',
  },
} as const
