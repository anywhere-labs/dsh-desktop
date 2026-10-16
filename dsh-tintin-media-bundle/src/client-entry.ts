// tintin-media-bundle client entry — built by vite (IIFE, single file) into
// dist/client.js. 2026-09-23 入口裁决（用户实测反馈）：不再持有 session
// header 的「媒体工具」按钮 + React 弹层面板（已废弃），改为向 tintin-bundle
// client.js 安装的视图注册表 window.__tintinViews 注册 'media' 视图——顶部
// Tab 栏（工作台/运营工具/媒体工具）切换时调用 mount(el)/unmount()，el 为
// 全尺寸容器（100% 宽 × 100% 高，overflow auto）。注册表先于本模块执行
// （组合顺序保证），?. 判空兜底：缺失时本模块正常实例化，仅媒体视图不可达。
//
// App.vue roots the ported TinTin design tokens (src/styles/tintin-tokens.css
// + tintin-global.css, scoped under .tintin-media-scope); importing them here
// gets them bundled and, via vite.config.mts inlineCssIntoEntry, embedded into
// dist/client.js next to the SFC styles.
//
// Built artifact; source of truth is src/. Rebuild: npm run tintin:media.
import { createApp, type App as VueApp } from 'vue'
import App from './App.vue'
// 运营工具视图（2026-09-25 用户裁决：产品资料卡随图像抠图一并移植，提前于
// P3 tintin-ops-bundle；chrome 占位网格在本 provider 注册后被接管，P3 落地
// 时把注册权迁往 ops-bundle 即可——注册表同名 'ops' 覆盖语义不变）
import OpsApp from './OpsApp.vue'
// 创作模式（2026-10-16 用户裁决：独立视图，侧栏置于「运营工具」之上，不再
// 占用媒体工具网格卡位；视图与媒体包同 bundle，服务端对接待需求对齐后实施）
import CreationStudio from './components/media-tools/CreationStudio.vue'
// 会话上下文条（WP-5b，2026-09-25）：conversation.input.left slot 内的
// Vue 应用——产品/素材/脚本选择写入工作区 task.json（不改 dsh 底层的注入面）
import ContextBar from './components/workbench/ContextBar.vue'
import './styles/tintin-tokens.css'
import './styles/tintin-global.css'

declare global {
  interface Window {
    __ModuleLoader__?: {
      load: (def: {
        id: string
        factory: () => {
          name?: string
          inject: string[]
          apply: (ctx: unknown) => void
        }
      }) => void
    }
    /** tintin-bundle 安装的视图注册表（顶部 Tab 栏消费）；防御性可空 */
    __tintinViews?: {
      register: (
        name: string,
        view: {
          mount: (el: HTMLElement) => void
          unmount: () => void
        },
      ) => void
    }
  }
}

interface SlotHost {
  slots?: {
    inject?: (name: string, factory: () => unknown) => void
    register?: (def: Record<string, unknown>, component: unknown) => void
  }
}

window.__ModuleLoader__!.load({
  id: 'dsh-tintin-media-bundle',
  // factory 第一参 require：dsh 模块系统注入的运行时 require 垫片（ppt-runtime
  // 同款，packages/ppt-runtime/adapter/lib/client.js:2 `factory: (require)`），
  // 借它取宿主 React 单例——media bundle 是 Vue+vite IIFE，绝不能自带 react
  // 副本（双 React 实例会炸 hooks；宿主 installer 把 react 列为 HOST_SINGLETON）。
  factory: (require?: (id: string) => unknown) => {
    let app: VueApp | null = null
    let opsApp: VueApp | null = null
    // 创作模式独立视图（同 KeepAlive 语义：mount 一次，切走隐藏不销毁）
    let creationApp: VueApp | null = null

    // 视图生命周期挂接（2026-09-24 Tab 状态机裁决）：chrome 为每个视图持有
    // 常驻子元素，mount 每视图仅调一次、切走只隐藏不销毁（KeepAlive 语义）——
    // 已打开的工具卡/向导步骤/表单输入切回后原样保留。
    window.__tintinViews?.register('media', {
      mount(el: HTMLElement) {
        if (app) return
        app = createApp(App)
        app.mount(el)
      },
      unmount() {
        app?.unmount()
        app = null
      },
    })

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

    window.__tintinViews?.register('creation', {
      mount(el: HTMLElement) {
        if (creationApp) return
        creationApp = createApp(CreationStudio)
        creationApp.mount(el)
      },
      unmount() {
        creationApp?.unmount()
        creationApp = null
      },
    })

    const module = { exports: {} as Record<string, unknown> }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // slots 注入（WP-5b，2026-09-25 用户裁决：不改 dsh 底层——上下文条经上游
    // conversation.input.left slot 挂载，该 slot 由本仓既有
    // dsh-client-ui-conversation patch 提供，零新增补丁）。视图注册仍在
    // 实例化时完成；apply 只负责 slot 注册（服务缺失时静默降级：无上下文条，
    // 不影响会话与视图）。
    exports.inject = ['slots']
    exports.apply = (ctx: unknown) => {
      registerContextBarSlot(ctx as SlotHost, require)
    }
    return module.exports as {
      inject: string[]
      apply: (ctx: unknown) => void
    }
  },
})

/** React 薄壳：accessory 容器 div + Vue ContextBar 挂载（Vue-in-slot，WP-3 先行验证形态） */
function registerContextBarSlot(host: SlotHost, require?: (id: string) => unknown): void {
  const slots = host?.slots
  if (typeof slots?.inject !== 'function' || typeof slots.register !== 'function') return
  // React 薄壳（宿主 require 注入；包内无 react 类型依赖——局部 any 隔离动态面，2026-10-06）
  const React = require?.('react' as string) as any
  if (!React || typeof React.createElement !== 'function' || typeof React.useEffect !== 'function') return
  const { createElement, useEffect, useRef } = React

  const TintinContextAccessory = () => {
    const hostRef = useRef(null)
    useEffect(() => {
      const el = hostRef.current
      if (!el) return
      const app = createApp(ContextBar)
      app.mount(el)
      return () => app.unmount()
    }, [])
    return createElement('div', { ref: hostRef, className: 'tintin-context-accessory' })
  }
  // 展示函数名便于 React DevTools / slot 调试定位
  Object.defineProperty(TintinContextAccessory, 'name', { value: 'TintinContextAccessory' })

  const injectFn = slots.inject
  const registerFn = slots.register
  slots.inject('conversation.input.left', () =>
    registerFn(
      { name: 'conversation.input.left', id: 'tintin-context-bar', order: 30 },
      TintinContextAccessory,
    ))
}
