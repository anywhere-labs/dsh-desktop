# Agent：ViralScoreAgent

## 定位

负责对候选片段进行病毒传播潜力评分。

## 调用 Skill

```text
viral-segment-score-skill
```

## 评分维度

```text
Hook 强度：40%
独立完整性：30%
信息密度：20%
情绪张力：10%
```

## 输入

```json
{
  "candidate_segments": [],
  "transcript_text": "",
  "platform": "douyin",
  "content_direction": "商品种草"
}
```

## 输出

```json
{
  "scored_segments": [
    {
      "segment_id": "seg_001",
      "start": "00:03:07.200",
      "end": "00:03:52.800",
      "hook_score": 9,
      "standalone_score": 8,
      "density_score": 8,
      "emotion_score": 7,
      "total_score": 8.4,
      "suggested_title": "这条裙子为什么一上身就显气质？",
      "reason": "开头直接出现上身效果，商品卖点清晰，适合短视频开头"
    }
  ]
}
```

## 归因边界

```text
ViralScoreAgent 只负责预测评分。
不负责保证发布后一定爆。
真实发布后的数据归因由 GrowthExperimentAgent 负责。
```
