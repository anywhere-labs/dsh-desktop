# Skill：segment-window-generate-skill

## 类型

```text
Segment Window Generation / 候选片段窗口生成
```

## 作用

根据关键词命中点生成可剪辑短视频候选片段。

## 输入

```json
{
  "keyword_matches": [],
  "pre_seconds": 5,
  "post_seconds": 45,
  "max_duration_seconds": 60
}
```

## 规则

```text
关键词命中点向前扩展 5 秒
关键词命中点向后扩展 20-45 秒
相邻片段间隔小于 8 秒则合并
超过最大时长则裁剪
片段小于 8 秒则标记低价值
```

## 输出

```json
{
  "candidate_segments": [
    {
      "segment_id": "seg_001",
      "start": "00:03:07.200",
      "end": "00:03:52.800",
      "duration": 45.6,
      "matched_keywords": ["显瘦", "连衣裙"]
    }
  ]
}
```
