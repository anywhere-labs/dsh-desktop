# Skill：subtitle-burn-in-skill

## 类型

```text
Subtitle Burn-in / 字幕烧录
```

## 作用

将 SRT 字幕烧录到竖屏视频中。

## 输入

```json
{
  "video": "clip_01_vertical.mp4",
  "subtitle": "clip_01.srt",
  "output": "clip_01_final.mp4"
}
```

## 命令

```bash
ffmpeg -i clip_01_vertical.mp4 \
  -vf "subtitles=clip_01.srt:force_style='FontSize=18,PrimaryColour=&H00FFFFFF,Outline=1.5'" \
  clip_01_final.mp4
```

## 输出

```json
{
  "final_video_path": "clip_01_final.mp4"
}
```
