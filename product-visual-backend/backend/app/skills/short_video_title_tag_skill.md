# Skill：short-video-title-tag-skill

## 类型

```text
Short Video Packaging / 短视频包装
```

## 作用

为每条短视频生成标题、文案、标签和 CTA。

## 输入

```json
{
  "clip_transcript": "",
  "keywords": ["连衣裙", "显瘦"],
  "platform": "douyin",
  "content_direction": "商品种草"
}
```

## 输出

```json
{
  "title": "这条裙子为什么一上身就显气质？",
  "caption": "夏天想穿得清爽又显气质，可以看看这种版型。",
  "hashtags": ["#连衣裙", "#显瘦穿搭", "#夏季穿搭"],
  "cta": "喜欢这类风格可以先收藏",
  "risk_warning": null
}
```

## 规则

```text
标题小于 40 字
标题优先包含关键词
不使用绝对化广告词
不承诺无法验证效果
适配平台语气
```
