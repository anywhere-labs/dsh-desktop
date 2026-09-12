# Skill：clip-quality-check-skill

## 类型

```text
Quality Check / 成片质检
```

## 作用

检查短视频是否达到发布前标准。

## 检查项

```text
视频可播放
时长 < 60 秒
前 3 秒有 Hook
字幕可读
无黑屏
声音正常
主体未被裁掉
结尾有 CTA
标题 < 40 字
输出比例正确
```

## 输出

```json
{
  "pass": true,
  "score": 92,
  "failed_items": [],
  "retry_required": false
}
```
