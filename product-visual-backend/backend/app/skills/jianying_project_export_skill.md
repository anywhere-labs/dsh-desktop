# Skill：jianying-project-export-skill

## 1. Skill 名称

```text
jianying-project-export-skill
```

中文名称：

```text
剪映交换包/复建包导出 Skill
```

## 2. Skill 类型

```text
Project Export / Editing Project Packaging
```

## 3. 触发条件

当短视频成片生成后，用户需要在剪映中继续二次编辑时触发。

适用场景：

```text
修改字幕
替换背景音乐
调整节奏
添加贴纸
添加转场
替换封面
人工二次精修
```

## 4. 输入字段

```json
{
  "task_id": "video_task_xxx",
  "trace_id": "trace_video_xxx",
  "final_clips": [],
  "raw_clips": [],
  "vertical_clips": [],
  "subtitles": [],
  "covers": [],
  "title_tags": [],
  "clip_report": "clip_report.json",
  "keyword_matches": "keyword_matches.json",
  "viral_score": "viral_score.json",
  "aspect_ratio": "9:16",
  "resolution": "1080x1920",
  "fps": 30
}
```

## 5. 输出内容

```text
jianying_project/
├── project_manifest.json
├── timeline.json
├── edit_decision_list.edl
├── project.fcpxml
├── draft_content.json
├── draft_meta_info.json
├── materials/
│   ├── videos/
│   ├── audios/
│   ├── subtitles/
│   ├── covers/
│   └── metadata/
└── README_导入说明.md
```

最终打包：

```text
jianying_project.zip
```

## 6. project_manifest.json

```json
{
  "project_id": "jy_video_task_0001",
  "source_task_id": "video_task_0001",
  "trace_id": "trace_video_0001",
  "project_name": "长视频病毒片段提取工程",
  "platform": "douyin",
  "aspect_ratio": "9:16",
  "resolution": "1080x1920",
  "fps": 30,
  "clips": [
    {
      "clip_id": "clip_01",
      "source_file": "materials/videos/clip_01_raw.mp4",
      "vertical_file": "materials/videos/clip_01_vertical.mp4",
      "final_file": "materials/videos/clip_01_final.mp4",
      "subtitle_file": "materials/subtitles/clip_01.srt",
      "cover_file": "materials/covers/clip_01_cover.png",
      "start": "00:03:07.200",
      "end": "00:03:52.800",
      "duration": 45.6,
      "matched_keywords": ["显瘦", "连衣裙"],
      "score": 8.4,
      "title": "这条裙子为什么一上身就显气质？"
    }
  ]
}
```

## 7. timeline.json

```json
{
  "timeline_id": "timeline_video_task_0001",
  "aspect_ratio": "9:16",
  "resolution": {
    "width": 1080,
    "height": 1920
  },
  "tracks": [
    {
      "type": "video",
      "items": [
        {
          "clip_id": "clip_01",
          "file": "materials/videos/clip_01_vertical.mp4",
          "start_time": 0,
          "duration": 45.6
        }
      ]
    },
    {
      "type": "subtitle",
      "items": [
        {
          "clip_id": "clip_01",
          "file": "materials/subtitles/clip_01.srt",
          "start_time": 0,
          "duration": 45.6
        }
      ]
    },
    {
      "type": "cover",
      "items": [
        {
          "clip_id": "clip_01",
          "file": "materials/covers/clip_01_cover.png"
        }
      ]
    }
  ]
}
```

## 8. README_导入说明.md

必须包含：

```text
本工程包包含自动生成的短视频片段、字幕、封面、标题文案、时间线 JSON、EDL、FCPXML 和剪映草稿结构。

剪映草稿文件属于版本敏感格式，不同剪映版本可能存在兼容差异。

如果 draft_content.json / draft_meta_info.json 无法被本地剪映直接识别，请使用：
1. materials/videos 中的视频素材
2. materials/subtitles 中的字幕
3. timeline.json
4. edit_decision_list.edl
5. project.fcpxml

进行工程复建。
```

## 9. 失败边界

```text
素材路径缺失
字幕文件缺失
timeline.json 生成失败
EDL 生成失败
FCPXML 生成失败
draft_content.json 结构不兼容
zip 打包失败
```

## 10. 成功标准

```text
project_manifest.json 存在
timeline.json 存在
EDL 存在
FCPXML 存在
draft_content.json 存在
draft_meta_info.json 存在
materials 目录完整
jianying_project.zip 可下载
README_导入说明.md 存在
```
