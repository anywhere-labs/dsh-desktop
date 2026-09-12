# Agent：KeywordLocatorAgent

## 定位

负责根据商品关键词在 SRT 字幕中定位相关时间戳。

## 调用 Skill

```text
srt-keyword-locator-skill
```

## 输入

```json
{
  "srt_path": "outputs/{task_id}/transcripts/input.srt",
  "keywords": ["连衣裙", "显瘦", "透气"],
  "enable_keyword_expansion": true
}
```

## 输出

```json
{
  "matches": [
    {
      "keyword": "显瘦",
      "start": "00:03:12.200",
      "end": "00:03:26.800",
      "text": "这件裙子上身很显瘦",
      "confidence": 0.92
    }
  ]
}
```

## 关键词扩展规则

```text
连衣裙 → 裙子、穿搭、上身效果、裙摆
显瘦 → 修饰身形、腰线、显气质
透气 → 清爽、不闷热、夏季舒适
价格 → 优惠、福利、划算、性价比
```

## 失败归因

```text
关键词为空 → UserInput
SRT 未生成 → TranscriptAgent
SRT 中未命中关键词 → KeywordLocatorAgent
语义扩展仍无命中 → KeywordLocatorAgent
```
