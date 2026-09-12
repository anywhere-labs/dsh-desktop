# Skill：srt-keyword-locator-skill

## 类型

```text
SRT Keyword Location / 字幕关键词定位
```

## 作用

根据商品关键词在 SRT 字幕中找到对应时间戳。

## 输入

```json
{
  "srt_path": "input.srt",
  "keywords": ["连衣裙", "显瘦", "透气"],
  "enable_keyword_expansion": true
}
```

## 处理逻辑

```text
解析 SRT
清洗字幕文本
匹配原始关键词
扩展语义关键词
计算命中置信度
输出命中时间戳
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

## 失败边界

```text
关键词为空
SRT 文件不存在
SRT 格式错误
关键词无命中
语义扩展后仍无命中
```
