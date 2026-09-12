# Skill：whisper-transcription-skill

## 类型

```text
Transcription / 语音转录
```

## 作用

将长视频音频转为 SRT 字幕文件。

## 输入

```json
{
  "video_file": "input.mp4",
  "model": "large-v3",
  "language": "zh",
  "output_format": "srt"
}
```

## 命令

```bash
whisper input.mp4 --model large-v3 --language zh \
  --output_format srt --output_dir transcripts/
```

## 输出

```json
{
  "srt_path": "transcripts/input.srt",
  "transcript_json": "transcripts/input.transcript.json"
}
```

## 失败边界

```text
视频无音频
Whisper 未安装
模型不存在
转录文件未生成
音频质量过差
```
