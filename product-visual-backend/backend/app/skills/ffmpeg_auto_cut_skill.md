# Skill：ffmpeg-auto-cut-skill

## 类型

```text
Video Cutting / 视频切割
```

## 作用

根据时间戳自动切割 Top 片段。

## 输入

```json
{
  "video_file": "input.mp4",
  "start": "00:03:07.200",
  "duration": 45.6,
  "output": "clip_01_raw.mp4"
}
```

## 命令

```bash
ffmpeg -i input.mp4 -ss {start} -t {duration} \
  -c:v libx264 -preset fast -crf 18 \
  -c:a aac -b:a 128k \
  clip_01_raw.mp4
```

## 输出

```json
{
  "raw_clip_path": "clip_01_raw.mp4"
}
```
