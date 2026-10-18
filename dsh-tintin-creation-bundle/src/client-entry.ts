// dsh-tintin-creation-bundle client entry — built by vite (IIFE, single file)
// into dist/client.js. 2026-10-17 用户裁决：创作模式从媒体包独立成插件——本包
// 注册 'creation'（输入会话）与 'skills'（技能管理）两个视图，均走
// window.__tintinViews 注册表 + KeepAlive 语义（mount 一次，切走隐藏不销毁）。
//
// 跨包信号：window.__tintinBus（窗口级小事件总线，本文件顶层定义、??
// 兜底——旧安装缺本包时媒体包优雅降级）。事件：
//   'tintin:media-tool'  payload=媒体工具卡 id —— 创作→媒体工具卡直达
//   'tintin:skills-changed' —— 技能管理安装/删除后，创作模式重载技能表
//
// Built artifact; source of truth is src/. Rebuild: yarn workspace
// dsh-tintin-creation-bundle build（已挂进 tintin 打包链）。
import { createApp, type App as VueApp } from 'vue'
import App from './App.vue'
// 技能管理视图（2026-10-16 用户裁决：侧栏页——列服务端技能库，逐技能安装/
// 删除；管理对象=创作模式技能表，与 App.vue 同域同 bundle）
import SkillManager from './components/SkillManager.vue'
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
    /** tintin-bundle 安装的视图注册表（侧栏入口消费）；防御性可空 */
    __tintinViews?: {
      register: (
        name: string,
        view: {
          mount: (el: HTMLElement) => void
          unmount: () => void
        },
      ) => void
    }
    /** 跨 bundle 小事件总线（tintin-bundle 兜底定义；本包顶层 ??= 同形兜底） */
    __tintinBus?: {
      on: (name: string, fn: (payload: unknown) => void) => void
      off: (name: string, fn: (payload: unknown) => void) => void
      emit: (name: string, payload?: unknown) => void
    }
  }
}

// 窗口级事件总线（本包顶层兜底定义；tintin-bundle chrome 若先行定义则复用）
window.__tintinBus ??= (() => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)!.add(fn)
    },
    off(name, fn) {
      listeners.get(name)?.delete(fn)
    },
    emit(name, payload) {
      for (const fn of [...(listeners.get(name) ?? [])]) {
        try {
          fn(payload)
        } catch (e) {
          console.error('[tintin bus]', name, e)
        }
      }
    },
  }
})()

window.__ModuleLoader__!.load({
  id: 'dsh-tintin-creation-bundle',
  factory: () => {
    let app: VueApp | null = null
    let skillsApp: VueApp | null = null

    // 视图生命周期挂接（2026-09-24 Tab 状态机裁决）：mount 每视图仅调一次、
    // 切走只隐藏不销毁（KeepAlive 语义）——已打开的工具/输入切回原样保留。
    window.__tintinViews?.register('creation', {
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

    window.__tintinViews?.register('skills', {
      mount(el: HTMLElement) {
        if (skillsApp) return
        skillsApp = createApp(SkillManager)
        skillsApp.mount(el)
      },
      unmount() {
        skillsApp?.unmount()
        skillsApp = null
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
