# video_clip_viral_extraction Agent Registry

This registry backs the existing `直播切片分发工作台` route and API.

## Agents
- LiveClipMaterialAgent
- LiveClipTranscriptAgent
- LiveClipShotDetectAgent
- LiveClipHotspotAgent
- LiveClipSegmentPlannerAgent
- LiveClipCopyAgent
- ClipQAAgent
- JianyingProjectExportAgent

## Skills
- basic_ffmpeg
- flycut_caption
- liveclip_slice_skill
- clip_quality_check_skill
- jianying_project_export_skill

## Public Workflow
- `/api/live-clips/*`
- `/api/video-clip-viral-extraction/*`
