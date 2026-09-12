# Agent：TitleTagAgent

## 定位

负责为每条短视频生成标题、文案、话题标签和 CTA。

## 调用 Skill

```text
short-video-title-tag-skill
```

## 输入

```json
{
  "clip_id": "clip_01",
  "transcript": "",
  "keywords": ["连衣裙", "显瘦"],
  "platform": "douyin",
  "content_direction": "商品种草"
}
```

## 输出

```json
{
  "title": "这条裙子为什么一上身就显气质？",
  "caption": "夏天穿搭想要清爽又显气质，可以看看这类版型。",
  "hashtags": ["#连衣裙", "#夏季穿搭", "#显瘦穿搭"],
  "cta": "喜欢这类风格可以先收藏"
}
```

## 规则

```text
标题小于 40 字
优先包含商品关键词
避免绝对化广告词
适配目标平台
不出现违规承诺
```
