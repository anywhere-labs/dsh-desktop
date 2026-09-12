# Skill：viral-segment-score-skill

## 类型

```text
Viral Score / 病毒传播评分
```

## 作用

为每个候选片段打分，筛选 Top N 短视频片段。

## 评分维度

```text
Hook 强度：40%
独立完整性：30%
信息密度：20%
情绪张力：10%
```

## LLM 评分指令

```markdown
分析以下带时间戳的转录文本。为每 1-2 分钟的片段打分。

评分维度：
- Hook 强度 40%：前 5 秒能否抓住注意力
- 独立完整性 30%：脱离上下文能否独立理解
- 信息密度 20%：每分钟传达的独特价值点数量
- 情绪张力 10%：幽默、震惊、感动、争议程度

输出字段：
- 时间范围
- Hook 强度
- 独立完整性
- 信息密度
- 情绪张力
- 总分
- 建议标题
- 推荐理由
```

## 输出

```json
{
  "segment_id": "seg_001",
  "hook_score": 9,
  "standalone_score": 8,
  "density_score": 8,
  "emotion_score": 7,
  "total_score": 8.4,
  "suggested_title": "这条裙子为什么一上身就显气质？",
  "reason": "商品卖点明确，前 3 秒具备吸引力"
}
```
