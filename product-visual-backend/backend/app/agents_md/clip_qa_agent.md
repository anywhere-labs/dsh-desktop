# Agent：ClipQAAgent

## 定位

负责短视频输出前质量检查。

## 调用 Skill

```text
clip-quality-check-skill
```

## 检查项

```text
视频可播放
每个片段小于 60 秒
前 3 秒有 Hook
字幕可读
声音正常
无黑屏
主体未被裁掉
结尾有 CTA
标题小于 40 字
包含商品关键词或相关卖点
输出比例正确
```

## 输出

```json
{
  "clip_id": "clip_01",
  "pass": true,
  "checks": {
    "duration_under_60s": true,
    "has_hook_first_3s": true,
    "subtitle_readable": true,
    "no_black_screen": true,
    "audio_present": true,
    "subject_visible": true,
    "title_under_40_chars": true
  },
  "retry_required": false
}
```
