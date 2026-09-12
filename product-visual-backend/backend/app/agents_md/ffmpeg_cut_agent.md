# Agent：FFmpegCutAgent

## 定位

根据评分结果切割 Top 片段。

## 调用 Skill

```text
ffmpeg-auto-cut-skill
```

## 输入

```json
{
  "video_file": "input.mp4",
  "segments": [],
  "output_dir": "outputs/{task_id}/clips"
}
```

## 输出

```json
{
  "clips": [
    {
      "clip_id": "clip_01",
      "raw_clip_path": "outputs/{task_id}/clips/clip_01_raw.mp4",
      "start": "00:03:07.200",
      "duration": 45.6
    }
  ]
}
```

## 命令模板

```bash
ffmpeg -i input.mp4 -ss {start} -t {duration} \
  -c:v libx264 -preset fast -crf 18 \
  -c:a aac -b:a 128k \
  outputs/{task_id}/clips/clip_01_raw.mp4
```

## 失败归因

```text
FFmpeg 不存在 → SystemEnv
视频路径错误 → FFmpegCutAgent
时间戳错误 → FFmpegCutAgent
切割失败 → FFmpegCutAgent
```
