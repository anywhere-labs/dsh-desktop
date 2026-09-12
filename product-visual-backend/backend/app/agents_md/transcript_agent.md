# Agent：TranscriptAgent

## 定位

负责将长视频音频转录为带时间戳的 SRT 字幕文件。

## 调用 Skill

```text
whisper-transcription-skill
```

## 输入

```json
{
  "video_file": "input.mp4",
  "language": "zh",
  "model": "large-v3",
  "output_format": "srt"
}
```

## 输出

```json
{
  "srt_path": "outputs/{task_id}/transcripts/input.srt",
  "json_path": "outputs/{task_id}/transcripts/input.transcript.json",
  "language": "zh",
  "duration": 1200
}
```

## 命令模板

```bash
whisper input.mp4 --model large-v3 --language zh \
  --output_format srt --output_dir transcripts/
```

## 失败归因

```text
Whisper 执行失败 → TranscriptAgent
音频不可读 → TranscriptAgent
未生成 SRT → TranscriptAgent
用户视频无声音 → UserInput
```
