# Agent：SubtitleBurnAgent

## 定位

负责生成片段级字幕并烧录到视频。

## 调用 Skill

```text
subtitle-burn-in-skill
```

## 输入

```json
{
  "vertical_clip_path": "clip_01_vertical.mp4",
  "segment_srt_path": "clip_01.srt",
  "style": {
    "font_size": 18,
    "primary_colour": "white",
    "outline": 1.5
  }
}
```

## 输出

```json
{
  "final_video_path": "outputs/{task_id}/final/clip_01_final.mp4",
  "subtitle_path": "outputs/{task_id}/subtitles/clip_01.srt"
}
```

## 命令模板

```bash
ffmpeg -i clip_01_vertical.mp4 \
  -vf "subtitles=clip_01.srt:force_style='FontSize=18,PrimaryColour=&H00FFFFFF,Outline=1.5'" \
  outputs/{task_id}/final/clip_01_final.mp4
```
