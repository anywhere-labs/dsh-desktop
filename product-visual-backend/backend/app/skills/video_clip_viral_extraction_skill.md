# Skill：video-clip-viral-extraction-skill

## 1. Skill 名称

```text
video-clip-viral-extraction-skill
```

中文名称：

```text
长视频病毒片段提取 Skill
```

## 2. Skill 类型

```text
Content Repurposing / 内容再制作
```

## 3. 触发条件

当用户拥有以下内容，并希望拆分为短视频分发时触发：

```text
长视频
直播回放
播客视频
课程视频
商品讲解视频
口播视频
访谈视频
带货直播素材
```

## 4. 核心目标

将一个长视频转化为多个可发布短视频：

```text
1 个 20 分钟长视频
→ 5-8 条 Shorts
→ 每条小于 60 秒
→ 自动字幕
→ 自动标题
→ 自动封面
→ 自动剪映交换包/复建包文件
```

## 5. 输入字段

```json
{
  "video_file": "required",
  "srt_file": "optional",
  "subtitle_source": "auto_transcribe | upload_srt",
  "keywords": ["required"],
  "enable_keyword_expansion": true,
  "platform": "douyin",
  "content_direction": "商品种草",
  "clip_count": 8,
  "max_duration_seconds": 60,
  "aspect_ratio": "9:16",
  "generate_srt": true,
  "burn_subtitles": true,
  "generate_cover": true,
  "generate_title_tags": true,
  "export_jianying_project": true
}
```

## 6. 输出字段

```json
{
  "transcript": "transcripts/input.srt",
  "keyword_matches": "keyword_matches/keyword_matches.json",
  "candidate_segments": "segments/candidate_segments.json",
  "viral_scores": "segments/viral_score.json",
  "raw_clips": [],
  "vertical_clips": [],
  "final_clips": [],
  "subtitles": [],
  "covers": [],
  "title_tags": [],
  "clip_report": "reports/clip_report.json",
  "qa_report": "reports/qa_report.json",
  "jianying_project": "jianying_project.zip",
  "trace": "trace.json"
}
```

## 7. 五步提取流水线

```text
长视频
→ Whisper 转录
→ LLM 评分
→ FFmpeg 切割
→ 竖屏重构
→ 字幕与工程导出
```

## 8. 执行流程

### Step 1：高精度转录

调用：

```text
whisper-transcription-skill
```

命令：

```bash
whisper input.mp4 --model large-v3 --language zh \
  --output_format srt --output_dir transcripts/
```

输出：

```text
input.srt
input.transcript.json
```

### Step 2：商品关键词时间戳定位

调用：

```text
srt-keyword-locator-skill
```

根据用户输入关键词：

```text
连衣裙、显瘦、透气、夏季穿搭
```

在 SRT 中定位：

```text
开始时间
结束时间
命中文案
上下文
置信度
```

### Step 3：候选片段窗口生成

调用：

```text
segment-window-generate-skill
```

规则：

```text
命中点前扩展 5 秒
命中点后扩展 20-45 秒
合并相邻片段
限制最大时长 60 秒
```

### Step 4：LLM 病毒评分

调用：

```text
viral-segment-score-skill
```

评分维度：

```text
Hook 强度：40%
独立完整性：30%
信息密度：20%
情绪张力：10%
```

输出表格：

```text
时间范围
Hook 强度
独立完整性
信息密度
情绪张力
总分
建议标题
```

### Step 5：FFmpeg 自动切割

调用：

```text
ffmpeg-auto-cut-skill
```

命令：

```bash
ffmpeg -i input.mp4 -ss [start] -t [duration] \
  -c:v libx264 -preset fast -crf 18 \
  -c:a aac -b:a 128k \
  clip_01_raw.mp4
```

### Step 6：竖屏重构

调用：

```text
vertical-video-reframe-skill
```

命令：

```bash
ffmpeg -i clip_01_raw.mp4 \
  -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" \
  -c:v libx264 -preset fast \
  clip_01_vertical.mp4
```

### Step 7：字幕烧录

调用：

```text
subtitle-burn-in-skill
```

命令：

```bash
ffmpeg -i clip_01_vertical.mp4 \
  -vf "subtitles=clip_01.srt:force_style='FontSize=18,PrimaryColour=&H00FFFFFF,Outline=1.5'" \
  clip_01_final.mp4
```

### Step 8：标题文案生成

调用：

```text
short-video-title-tag-skill
```

输出：

```text
建议标题
短视频文案
话题标签
CTA
风险提示
```

### Step 9：质量检查

调用：

```text
clip-quality-check-skill
```

检查：

```text
每个片段 < 60 秒
前 3 秒有 Hook
字幕可读
无黑屏
声音正常
标题 < 40 字
结尾有 CTA
```

### Step 10：剪映交换包/复建包导出

调用：

```text
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

## 9. 成功标准

```text
至少输出 1 条 final MP4
关键词命中结果可查看
候选片段有评分
成片可播放
字幕可读
Trace 完整
剪映交换包/复建包文件可下载
```

## 10. 失败处理

```text
没有 SRT → 重新转录
没有关键词命中 → 启用关键词扩展
评分过低 → 扩大时间窗口
FFmpeg 失败 → 检查命令和路径
字幕失败 → 重新生成 SRT
工程导出失败 → 保留通用 timeline.json / EDL / FCPXML
```
