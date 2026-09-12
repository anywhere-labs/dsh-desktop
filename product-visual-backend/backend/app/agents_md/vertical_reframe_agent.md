# Agent：VerticalReframeAgent

## 定位

负责将横版视频重构为竖屏短视频。

## 调用 Skill

```text
vertical-video-reframe-skill
```

## 输入

```json
{
  "raw_clip_path": "clip_01_raw.mp4",
  "aspect_ratio": "9:16",
  "resolution": "1080x1920"
}
```

## 输出

```json
{
  "vertical_clip_path": "outputs/{task_id}/clips/clip_01_vertical.mp4"
}
```

## 命令模板

```bash
ffmpeg -i clip_01_raw.mp4 \
  -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" \
  -c:v libx264 -preset fast \
  outputs/{task_id}/clips/clip_01_vertical.mp4
```

## 边界

```text
第一版使用中心裁剪。
v2 升级人脸跟踪裁剪。
如果主体被裁掉，归因到 VerticalReframeAgent。
```
