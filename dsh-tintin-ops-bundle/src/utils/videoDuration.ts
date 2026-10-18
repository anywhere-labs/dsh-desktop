// videoDuration — 本地视频文件时长探测（媒体工具共享）
// 2026-10-02 用户裁决：仿爆款视频上传原片 ≤60 秒，超限需明确提示拦截——
// 渲染层经 video 元素 loadedmetadata 读取真实时长（读不到返回 null 按未知放行）。

export function probeDurationSec(file: File | Blob): Promise<number | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.preload = 'metadata'
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v) }
    const timer = setTimeout(() => done(null), 8000)
    el.onloadedmetadata = () => { clearTimeout(timer); done(Number.isFinite(el.duration) ? el.duration : null) }
    el.onerror = () => { clearTimeout(timer); done(null) }
    el.src = url
  })
}

/** 原片时长上限（秒） */
export const MAX_SOURCE_VIDEO_SEC = 60
