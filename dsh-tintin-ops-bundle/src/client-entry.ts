// dsh-tintin-ops-bundle client entry — built by vite (IIFE, single file) into
// dist/client.js. 2026-10-17 用户裁决：运营工具从媒体包独立成插件——本包注册
// 'ops' 视图（产品资料/文案创作/自动上架/视频反推提示词），KeepAlive 语义同旧。
// 跨包信号：前往分镜经 window.__tintinBus 'tintin:storyboard-pending' 发往媒体包
// （媒体包 App.vue 订阅后写入其 pendingStoryboard ref）。
import { createApp, type App as VueApp } from 'vue'
import OpsApp from './OpsApp.vue'

window.__ModuleLoader__!.load({
  id: 'dsh-tintin-ops-bundle',
  factory: () => {
    let opsApp: VueApp | null = null

    window.__tintinViews?.register('ops', {
      mount(el: HTMLElement) {
        if (opsApp) return
        opsApp = createApp(OpsApp)
        opsApp.mount(el)
      },
      unmount() {
        opsApp?.unmount()
        opsApp = null
      },
    })

    const module = { exports: {} as Record<string, unknown> }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    exports.inject = []
    exports.apply = () => {}
    return module.exports as {
      inject: string[]
      apply: (ctx: unknown) => void
    }
  },
})
