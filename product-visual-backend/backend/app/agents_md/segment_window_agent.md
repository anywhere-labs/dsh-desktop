# Agent：SegmentWindowAgent

## 定位

根据关键词命中时间戳生成候选短视频片段窗口。

## 调用 Skill

```text
segment-window-generate-skill
```

## 输入

```json
{
  "keyword_matches": [],
  "pre_seconds": 5,
  "post_seconds": 45,
  "max_duration_seconds": 60
}
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
      "matched_keywords": ["显瘦", "连衣裙"],
      "source": "keyword_match"
    }
  ]
}
```

## 规则

```text
命中点前扩展 5 秒
命中点后扩展 20-45 秒
相邻片段自动合并
超过最大时长自动裁剪
不足 8 秒的片段标记为低价值
```
