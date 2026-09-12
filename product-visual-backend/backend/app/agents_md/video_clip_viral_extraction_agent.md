# Agent：VideoClipViralExtractionAgent

## 1. Agent 名称

```text
VideoClipViralExtractionAgent
```

中文名称：

```text
长视频病毒片段提取 Agent
```

## 2. Agent 定位

VideoClipViralExtractionAgent 是 `/video-clip-viral-extraction` 页面对应的主调度 Agent。

它负责从 UI 接收用户上传的长视频文件、商品关键词、目标平台和剪辑参数，自动调度多个子 Agent 完成：

```text
长视频上传
→ Whisper 转录
→ SRT 时间戳生成
→ 商品关键词定位
→ 候选片段窗口生成
→ LLM 病毒评分
→ FFmpeg 自动切割
→ 竖屏重构
→ 字幕烧录
→ 标题文案生成
→ 成片质检
→ 剪映交换包/复建包导出
→ Trace 因果链记录
```

## 3. 触发页面

```text
/video-clip-viral-extraction
```

## 4. 触发条件

当用户在 UI 中执行以下动作时触发：

```text
选择本地长视频文件
输入商品关键词
点击“开始剪辑”
```

## 5. 输入字段

```json
{
  "video_file": "required",
  "srt_file": "optional",
  "subtitle_source": "auto_transcribe | upload_srt",
  "keywords": ["required"],
  "enable_keyword_expansion": true,
  "content_topic": "optional",
  "main_product": "optional",
  "platform": "douyin | kuaishou | wechat_video | xiaohongshu | tiktok | youtube_shorts | reels",
  "content_direction": "商品种草 | 卖点讲解 | 直播高光 | 口播金句 | 剧情反转 | 价格福利 | 用户痛点 | 穿搭教程 | 品牌故事",
  "clip_count": 8,
  "max_duration_seconds": 60,
  "aspect_ratio": "9:16",
  "generate_srt": true,
  "burn_subtitles": true,
  "generate_cover": true,
  "generate_title_tags": true,
  "export_jianying_project": true,
  "project_export_type": ["jianying_draft", "timeline_json", "edl", "fcpxml"]
}
```

## 6. 输出字段

```json
{
  "task_id": "video_task_xxx",
  "trace_id": "trace_video_xxx",
  "status": "queued | running | passed | failed",
  "current_agent": "VideoClipViralExtractionAgent",
  "current_skill": "video-clip-viral-extraction-skill",
  "artifacts": {
    "final_clips": [],
    "subtitles": [],
    "covers": [],
    "reports": [],
    "jianying_project": null,
    "trace": "trace.json"
  }
}
```

## 7. 调用 Agent 链

```text
DirectorAgent
→ VideoClipViralExtractionAgent
→ TranscriptAgent
→ KeywordLocatorAgent
→ SegmentWindowAgent
→ ViralScoreAgent
→ FFmpegCutAgent
→ VerticalReframeAgent
→ SubtitleBurnAgent
→ TitleTagAgent
→ ClipQAAgent
→ JianyingProjectExportAgent
→ TraceCenter
```

## 8. 调用 Skill 链

```text
video-clip-viral-extraction-skill
├── whisper-transcription-skill
├── srt-keyword-locator-skill
├── segment-window-generate-skill
├── viral-segment-score-skill
├── ffmpeg-auto-cut-skill
├── vertical-video-reframe-skill
├── subtitle-burn-in-skill
├── short-video-title-tag-skill
├── clip-quality-check-skill
└── jianying-project-export-skill
```

## 9. 执行步骤

### Step 1：创建任务

点击“开始剪辑”后，后端必须立即创建：

```text
task_id
trace_id
```

禁止出现：

```text
missing_inputs: task_id
```

因为 `task_id` 应由系统创建，不应要求用户输入。

### Step 2：转录或读取 SRT

如果字幕来源为：

```text
自动转录生成 SRT
```

调用：

```text
TranscriptAgent
whisper-transcription-skill
```

如果字幕来源为：

```text
上传已有 SRT
```

跳过 Whisper，直接调用：

```text
KeywordLocatorAgent
srt-keyword-locator-skill
```

### Step 3：关键词时间戳定位

根据用户输入的商品关键词，在 SRT 字幕中寻找对应时间戳。

输出：

```text
keyword_matches.json
```

### Step 4：候选片段生成

根据关键词命中点，向前后扩展片段窗口。

默认规则：

```text
向前扩展 5 秒
向后扩展 20-45 秒
相邻命中片段自动合并
单条片段不超过 max_duration_seconds
```

输出：

```text
candidate_segments.json
```

### Step 5：病毒片段评分

对候选片段进行四维评分：

```text
Hook 强度：40%
独立完整性：30%
信息密度：20%
情绪张力：10%
```

输出：

```text
viral_score.json
```

### Step 6：FFmpeg 自动切割

根据 Top 片段时间戳切割视频。

输出：

```text
clip_01_raw.mp4
clip_02_raw.mp4
```

### Step 7：竖屏重构

将横版视频转换为 9:16。

第一版允许中心裁剪：

```text
1080x1920
```

后续升级为：

```text
人脸跟踪裁剪
主体安全区裁剪
```

### Step 8：字幕烧录

生成片段级 SRT，并烧录字幕到视频。

输出：

```text
clip_01_final.mp4
clip_01.srt
```

### Step 9：标题文案生成

生成：

```text
建议标题
短视频文案
话题标签
CTA
风险提示
```

### Step 10：成片质检

检查：

```text
视频可播放
时长小于 60 秒
前 3 秒有 Hook
字幕可读
声音正常
无黑屏
主体未被裁掉
标题小于 40 字
```

### Step 11：剪映交换包/复建包导出

调用：

```text
JianyingProjectExportAgent
jianying-project-export-skill
```

输出：

```text
jianying_project.zip
project_manifest.json
timeline.json
edit_decision_list.edl
project.fcpxml
draft_content.json
draft_meta_info.json
README_导入说明.md
```

## 10. 权限边界

允许自动执行：

```text
读取视频
生成 SRT
识别关键词
生成候选片段
评分
切割视频
竖屏重构
烧录字幕
生成标题
生成剪映交换包/复建包
生成报告
```

禁止自动执行：

```text
自动发布视频
自动投放广告
自动删除原始素材
自动修改商品价格
自动提交真实平台内容
自动支付
```

高风险动作必须交给：

```text
GovernanceAgent
```

## 11. 失败归因

```json
{
  "invalid_input": {
    "owner": "UserInput",
    "reason": "未上传视频、关键词为空、格式不支持",
    "action": "提示用户补充输入"
  },
  "transcription_failed": {
    "owner_agent": "TranscriptAgent",
    "reason": "Whisper 转录失败或音频不可读",
    "action": "重试转录或提示检查音频"
  },
  "keyword_not_found": {
    "owner_agent": "KeywordLocatorAgent",
    "reason": "SRT 中未找到关键词或语义近似词",
    "action": "启用语义扩展或补充关键词"
  },
  "low_viral_score": {
    "owner_agent": "ViralScoreAgent",
    "reason": "候选片段传播潜力不足",
    "action": "扩大时间窗口或降低评分阈值"
  },
  "ffmpeg_cut_failed": {
    "owner_agent": "FFmpegCutAgent",
    "reason": "FFmpeg 命令失败、路径错误或时间戳错误",
    "action": "检查命令和路径后重试"
  },
  "reframe_failed": {
    "owner_agent": "VerticalReframeAgent",
    "reason": "竖屏裁剪后主体缺失",
    "action": "改用安全区裁剪或智能裁剪"
  },
  "subtitle_burn_failed": {
    "owner_agent": "SubtitleBurnAgent",
    "reason": "字幕时间轴不匹配或字体不可用",
    "action": "重新生成片段 SRT 或改用 drawtext"
  },
  "jianying_export_failed": {
    "owner_agent": "JianyingProjectExportAgent",
    "reason": "素材路径缺失或工程文件结构不兼容",
    "action": "保留通用 timeline.json、EDL、FCPXML 和素材包"
  },
  "qa_failed": {
    "owner_agent": "ClipQAAgent",
    "reason": "成片不符合发布前质量标准",
    "action": "按失败项回滚到对应 Agent 重试"
  }
}
```

## 12. Trace 记录字段

每次执行必须生成：

```text
trace.json
```

Trace 字段：

```json
{
  "task_id": "video_task_xxx",
  "trace_id": "trace_video_xxx",
  "route": "/video-clip-viral-extraction",
  "user_intent": "根据商品关键词从长视频中提取病毒短视频片段并导出剪映交换包/复建包",
  "input": {
    "video_file": "input.mp4",
    "video_hash": "sha256_xxx",
    "keywords": [],
    "platform": "douyin",
    "clip_count": 8,
    "aspect_ratio": "9:16",
    "export_jianying_project": true
  },
  "agent_chain": [],
  "skill_chain": [],
  "keyword_matches": [],
  "candidate_segments": [],
  "viral_scores": [],
  "ffmpeg_commands": [],
  "final_outputs": [],
  "qa_result": {},
  "failure_reason": null,
  "final_status": "passed"
}
```
