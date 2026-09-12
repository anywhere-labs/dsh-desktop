# Skill：vertical-video-reframe-skill

## 类型

```text
Video Reframe / 竖屏重构
```

## 作用

将横版或原始比例视频转换为 9:16 短视频。

## 输入

```json
{
  "input_clip": "clip_01_raw.mp4",
  "aspect_ratio": "9:16",
  "resolution": "1080x1920"
}
```

## 命令

```bash
ffmpeg -i clip_01_raw.mp4 \
  -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" \
  -c:v libx264 -preset fast \
  clip_01_vertical.mp4
```

## 输出

```json
{
  "vertical_clip_path": "clip_01_vertical.mp4"
}
```

## v2 升级方向

```text
人脸跟踪裁剪
主体检测裁剪
安全区域裁剪
多主体跟踪
```
