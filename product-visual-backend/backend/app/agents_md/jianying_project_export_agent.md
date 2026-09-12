# Agent：JianyingProjectExportAgent

## 名称

```text
JianyingProjectExportAgent
```

中文名称：

```text
剪映交换包/复建包导出 Agent
```

## 定位

负责将短视频成片、原始片段、竖屏片段、字幕、封面、标题文案、时间线和评分报告打包成可复建的剪映交换包/复建包。

## 调用 Skill

```text
jianying-project-export-skill
```

## 输入

```json
{
  "task_id": "video_task_xxx",
  "trace_id": "trace_video_xxx",
  "clips": [],
  "subtitles": [],
  "covers": [],
  "reports": [],
  "aspect_ratio": "9:16",
  "resolution": "1080x1920",
  "fps": 30
}
```

## 输出

```json
{
  "project_zip": "outputs/{task_id}/jianying_project.zip",
  "manifest": "outputs/{task_id}/jianying_project/project_manifest.json",
  "timeline": "outputs/{task_id}/jianying_project/timeline.json",
  "edl": "outputs/{task_id}/jianying_project/edit_decision_list.edl",
  "fcpxml": "outputs/{task_id}/jianying_project/project.fcpxml",
  "draft_content": "outputs/{task_id}/jianying_project/draft_content.json",
  "draft_meta_info": "outputs/{task_id}/jianying_project/draft_meta_info.json",
  "readme": "outputs/{task_id}/jianying_project/README_导入说明.md"
}
```

## 输出目录

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

## 兼容性说明

```text
剪映草稿文件属于版本敏感格式。
系统第一版必须输出通用工程 JSON、EDL、FCPXML 和素材目录。
draft_content.json / draft_meta_info.json 可按当前本地剪映版本继续适配。
如果剪映直接导入失败，用户仍可使用 timeline.json、EDL、FCPXML 和素材目录复建工程。
```

## 失败归因

```text
素材路径缺失 → JianyingProjectExportAgent
timeline.json 生成失败 → JianyingProjectExportAgent
draft_content.json 不兼容 → JianyingProjectExportAgent
工程 zip 打包失败 → JianyingProjectExportAgent
```
