// Executes at script-eval time — ALL bootstrap scripts' top levels run first,
// so installing the chrome/polyfill here is deterministic; apply()-time
// installation raced the __tintinViews registration and lost (dev17/dev18).
const tintinClient = (() => {
    // ── TinTin 侧栏视图（2026-09-23 用户实测修正；2026-10-16 用户裁决：创作模式
    // 独立视图置于运营工具之上，不再占用媒体工具网格卡位）─────────────
    // 原 conversation.session.header.actions 挂法有三个缺陷：仅会话内存在、
    // 靠右不居中、点击只弹小面板不切换视图。改为常驻居中 Tab 栏 + 主区视图
    // 覆盖层：工作台=harness 会话原生视图；创作/运营/媒体=覆盖层内由视图提供方
    // （window.__tintinViews 注册，media-bundle 挂 Vue 子应用）渲染。
    function installTintinChrome() {
      if (document.querySelector('[data-tintin-entry]')) return
      // 入口视图（工作台=无覆盖层默认态；浏览器=独立窗口入口，不进覆盖层）
      const VIEWS = [
        { id: 'creation', label: '创作模式' },
        { id: 'ops', label: '运营工具' },
        { id: 'media', label: '媒体工具' }, { id: 'skills', label: '技能管理', glyph: '<path d="M8 2.2 13.6 4.8 8 7.4 2.4 4.8z"/><path d="M2.4 8 8 10.6 13.6 8"/><path d="M2.4 11.2 8 13.8l5.6-2.6"/>' }, // 技能管理（2026-10-16 裁决）：服务端技能库安装/删除，装后创作模式 /技能名 调用
      ]
      const providers = new Map()
      let activeId = 'workbench'
      // 2026-09-24 用户裁决：每视图常驻子元素 KeepAlive（切走仅 display:none，表单/步骤不丢）；mount 每视图只调一次。
      const viewEls = new Map()

      window.__tintinViews = {
        register(id, provider) {
          providers.set(id, provider)
          if (activeId === id) mountActive()
        },
        unregister(id) { providers.delete(id) },
      }

      // ── 左侧「插件」区入口（2026-09-28 用户裁决：撤顶部 Tab 栏；入口行克隆插件面板行同层注入）──
      let entryButtons = []
      function paintEntries() {
        // 激活态沿用原生 panelActive 类：行上没有时按同模块前缀推导（panelRow → panelActive）
        const row = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === '插件' && b.closest('[data-pane="sidebar"], [class*="sidebarCol"]'),
        )
        let activeCls = null
        if (row) {
          const rowCls = [...row.classList].find((c) => c.endsWith('panelRow'))
          if (rowCls) activeCls = rowCls.replace(/panelRow$/, 'panelActive')
        }
        // 插件与 tab 单焦点联动（2026-10-16 用户裁决）：tab 激活时熄灭插件行——React
        // 重渲染会重点亮，由 sidebarMo 的 paintEntries 重摘（toggle 幂等无回环）
        if (row && activeCls && activeId !== 'workbench') row.classList.toggle(activeCls, false)
        for (const [id, b] of entryButtons) {
          if (activeCls) b.classList.toggle(activeCls, activeId === id)
        }
      }
      function setActive(id) { activeId = id; render() }
      // 跨视图跳转口（创作模式「打开媒体工具卡」用）：仅放行本表视图与工作台
      window.__tintinActivateView = (id) => {
        if (id === 'workbench' || VIEWS.some((v) => v.id === id)) setActive(id)
      }
      function injectEntries() {
        const row = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === '插件' && b.closest('[data-pane="sidebar"], [class*="sidebarCol"]'),
        )
        if (!row) return false
        const host = row.parentElement
        if (!host || host.querySelector('[data-tintin-entry]')) return true
        // 入口行 = 克隆「插件」面板行同层直插（2026-09-28 裁决：布局/行距逐像素一致）；只改标题与点击。
        const items = [...VIEWS, { id: '__browser', label: '浏览器' }, { id: '__openfilm', label: 'OpenFilm' }]
        let anchor = row
        for (const v of items) {
          const b = row.cloneNode(true)
          b.type = 'button'
          b.removeAttribute('id')
          b.removeAttribute('aria-keyshortcuts')
          b.removeAttribute('aria-label')
          b.setAttribute('data-tintin-entry', v.id)
          const title = [...b.querySelectorAll('span,div')].find((e) => e.childElementCount === 0 && e.textContent.trim() === '插件')
          if (title) title.textContent = v.label
          else b.textContent = v.label
          // 图标：语义参考原版 Electron，风格对齐 DSH 侧栏 16×16 线稿（stroke currentColor / 线宽 1）
          const GLYPHS = {
            creation: '<path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5z"/><path d="M12.3 11.6v3.2M10.7 13.2h3.2"/>',
            media: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6.8 5.9v4.2l3.6-2.1z"/>',
            ops: '<rect x="2" y="5.5" width="12" height="8" rx="1.5"/><path d="M6 5.5V4a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 10 4v1.5"/><path d="M2 8.5h12"/>',
            __browser: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2c-1.8 1.6-2.8 3.7-2.8 6s1 4.4 2.8 6c1.8-1.6 2.8-3.7 2.8-6S9.8 3.6 8 2z"/>',
          }
          const glyphSvg = b.querySelector('[class*=panelGlyph] svg')
          if (glyphSvg && (GLYPHS[v.id] || v.glyph)) {
            glyphSvg.setAttribute('viewBox', '0 0 16 16')
            glyphSvg.setAttribute('width', '16')
            glyphSvg.setAttribute('height', '16')
            glyphSvg.setAttribute('fill', 'none')
            glyphSvg.setAttribute('stroke', 'currentColor')
            glyphSvg.setAttribute('stroke-width', '1')
            glyphSvg.innerHTML = GLYPHS[v.id] || v.glyph
          }
          b.onclick = (ev) => {
            ev.stopPropagation()
            if (v.id === '__browser') {
              const br = window.dshDesktopBrowser
              if (br) void br.open('web').catch(() => {})
              return
            }
            if (v.id === '__openfilm') { void window.tintin?.openfilm?.openStudio?.().catch((e) => window.alert(`OpenFilm 启动失败：${e?.message || e}`)); return }
            setActive(activeId === v.id ? 'workbench' : v.id)
          }
          if (!v.id.startsWith('__')) entryButtons.push([v.id, b])
          anchor.insertAdjacentElement('afterend', b)
          anchor = b
        }
        return true
      }
      // 侧栏由 React 管理：MutationObserver 守住注入+联动重摘+原生浮层提权检测
      // （2026-10-17 报障二修：设置面板 portal 直挂 body，首版扫侧栏子树恒 false
      // → 改扫 body 直接子元素；原生 z1000 全屏浮层（设置/附件查看器同族）在位
      // → 覆盖层降其下 500，关闭（ESC/点遮罩）由 body childList 观察自动恢复）。
      // 点侧栏其他区域（会话/新会话）=回工作台。
      function detectNativeOverlay() {
        const open = [...document.body.children].some((el) => {
          const s = getComputedStyle(el); return s.position === 'fixed' && s.zIndex === '1000'
        })
        overlay.style.zIndex = open ? '500' : '9998'
      }
      const bodyMo = new MutationObserver(() => detectNativeOverlay())
      const sidebarMo = new MutationObserver(() => {
        if (!injectEntries()) return
        paintEntries() // 联动自愈：React 重渲染恢复插件行高亮时重摘
        detectNativeOverlay()
        const root = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
        if (root && !root.__tintinWired) {
          root.__tintinWired = true
          root.addEventListener('click', (ev) => {
            const t = ev.target
            if (!(t instanceof Element) || t.closest('[data-tintin-entry]')) return
            // 展开态才强制回工作台：收起态新会话卡被上游整体卸载、文本查找全空→豁免链塌成任何点击都强拆（2026-10-15 报障）
            const btns = [...root.querySelectorAll('button')]; const row = btns.find((b) => b.textContent.trim() === '插件')
            // 插件行=工作台入口（2026-10-16 用户裁决：插件与 tab 单焦点联动——点插件行主区回工作台）
            if (t === row || (row && row.contains(t))) { if (activeId !== 'workbench') setActive('workbench'); return }
            // 上游 panellist 行自带主区页面：收起覆盖层让行接管；会话行没有 panelRow 类，仍回工作台。
            const rowClass = row ? [...row.classList].find((c) => c.endsWith('panelRow')) : undefined; const clicked = t.closest('button')
            if (rowClass && clicked && clicked !== row && clicked.classList.contains(rowClass)) {
              if (activeId !== 'workbench') setActive('workbench')
              const id = { '自动化任务': 'schedules', 'Automation tasks': 'schedules' }[clicked.textContent.trim()]; if (id) setTimeout(() => window.__tintinSelectPanel?.(id), 0); return
            }
            const newBtn = btns.find((b) => b.textContent.trim() === '新会话')
            if (!newBtn || t.getBoundingClientRect().top < newBtn.getBoundingClientRect().top) return
            if (activeId !== 'workbench') setActive('workbench')
          }, true)
        }
      })
      const armSidebarObserver = () => {
        const col = document.querySelector('[class*=sidebarCol]') || document.body
        sidebarMo.observe(col, { childList: true, subtree: true })
        bodyMo.observe(document.body, { childList: true })
        injectEntries()
        // 不可在此直调 detectNativeOverlay()：overlay 的 const 声明在本闭包更后，
        // arm 在脚本求值期同步执行会踩 TDZ（1017 启动失败事故）；首个 mutation
        // 到达时 overlay 早已就绪，检测自会补跑。
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', armSidebarObserver)
      else armSidebarObserver()

      // 动画层（2026-09-25 报障补齐）：入场 slide-up/卡片 stagger/hover 抬升
      // （SRC 口径 0.2s·12px、0.35s·35ms）；令牌作用域外缓动用字面量兜底。
      const animStyle = document.createElement('style')
      animStyle.textContent = ['@keyframes tintin-view-in{from{opacity:0;transform:translateY(12px)}}', '.tintin-view-el{animation:tintin-view-in .22s cubic-bezier(0,0,.2,1)}', '@keyframes tintin-stagger-in{from{opacity:0;transform:translateY(12px)}}', '.tintin-stagger-item{animation:tintin-stagger-in .35s cubic-bezier(0,0,.2,1) backwards}', ...[0,1,2,3,4,5,6,7,8,9,10,11].map((i) => `.tintin-stagger-item:nth-child(${i + 1}){animation-delay:${i * 35}ms}`), '.tintin-grid-card{transition:transform .18s cubic-bezier(0,0,.2,1),box-shadow .18s cubic-bezier(0,0,.2,1),background .12s}', '.tintin-grid-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.12);background:var(--dsw-alias-bg-layer-3,#2a2a2c)}'].join('\n')
      document.head.appendChild(animStyle)

      const overlay = document.createElement('div')
      overlay.id = 'tintin-view-overlay'
      overlay.style.cssText =
        `position:fixed;inset:0;z-index:9998;display:none;` +
        `background:var(--dsw-alias-bg-layer-1,#141416);` +
        `color:var(--dsw-alias-label-primary,#e8e8e6);overflow:auto;`
      const container = document.createElement('div')
      container.style.cssText = 'width:100%;min-height:100%;box-sizing:border-box;'
      overlay.appendChild(container)
      // 左栏固定常驻（2026-09-28 用户裁决）：覆盖层只占侧栏右侧显示区，
      // 偏移随侧栏宽度（展开 280px/收起窄栏）实时同步，不再整窗覆盖。
      function syncOverlayBounds() {
        const root = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
        const w = root ? root.getBoundingClientRect().width : 0
        overlay.style.left = Math.round(w) + 'px'
      }
      try {
        const col = document.querySelector('[class*=sidebarCol]') || document.body
        new ResizeObserver(() => syncOverlayBounds()).observe(col)
      } catch { /* 无 ResizeObserver 时保持整窗 */ }
      document.body.appendChild(overlay)

      function mountActive() {
        if (activeId === 'workbench') {
          overlay.style.display = 'none'
          return
        }
        overlay.style.display = 'block'
        let el = viewEls.get(activeId)
        if (!el) {
          el = document.createElement('div')
          el.className = 'tintin-view-el'
          el.style.cssText = 'width:100%;min-height:100%;box-sizing:border-box;'
          container.appendChild(el)
          viewEls.set(activeId, el)
          const provider = providers.get(activeId)
          if (provider) {
            try {
              provider.mount(el)
            } catch (e) {
              console.error('[tintin] view mount failed', e)
              renderPendingInto(el, '视图加载失败，请重试切换')
            }
          } else if (activeId === 'ops') {
            // 运营工具分组占位（2026-09-24 用户裁决：与原客户端 OpsTools.vue 同分组）。
            // 2026-09-25 起媒体包已注册 'ops' 提供方；本占位网格仅提供方缺失时兜底，
            // P3 tintin-ops-bundle 落地时接管同名 'ops' 注册。
            renderOpsGrid(el)
          } else if (activeId === 'browser') {
            // 浏览器 tab（2026-09-25 裁决：浏览器域首片——登录态管理+独立窗口；
            // 壳引擎在频道宿主 src/main/tintin/browser/，yt-dlp cookies 从此导出）
            renderBrowserPanel(el)
          } else {
            renderPendingInto(el, '媒体工具界面搬运中（视图提供方未注册）')
          }
        }
        for (const [id, e] of viewEls) e.style.display = id === activeId ? '' : 'none'
      }

      function renderPendingInto(el, text) {
        const p = document.createElement('div')
        p.style.cssText = 'padding:48px 32px;color:var(--dsw-alias-label-tertiary,#8b8b88);font-size:14px;'
        p.textContent = text
        el.appendChild(p)
      }

      function renderOpsGrid(el) {
        const GROUPS = [
          { group: '产品知识', tools: [
            { title: '产品资料', desc: '品类/品牌/型号树状管理，服务端同步', emoji: '📦', accent: 'linear-gradient(135deg,#8B5CF6 0%,#EC4899 100%)' },
            { title: '我的知识库', desc: '风格化画像 + 参考素材蒸馏', emoji: '📚', accent: 'linear-gradient(135deg,#0EA5E9 0%,#06B6D4 100%)' },
          ] },
          { group: '提示词', tools: [
            { title: '图片反推提示词', desc: '上传图片，AI 生成绘画提示词', emoji: '🖼️', accent: 'linear-gradient(135deg,#10B981 0%,#14B8A6 100%)' },
            { title: '视频反推提示词', desc: '上传视频，框选片段生成提示词', emoji: '🎬', accent: 'linear-gradient(135deg,#3B82F6 0%,#8B5CF6 100%)' },
          ] },
          { group: '视频运营', tools: [
            { title: '视频评价预测', desc: '关键帧 → 视觉模型预测视频表现', emoji: '📈', accent: 'linear-gradient(135deg,#F59E0B 0%,#EF4444 100%)' },
            { title: '视频营销检测', desc: '研判是否营销视频 + 品类 + 改进建议', emoji: '🎯', accent: 'linear-gradient(135deg,#10B981 0%,#14B8A6 100%)' },
          ] },
        ]
        const root = document.createElement('div')
        root.style.cssText = 'width:100%;min-height:100%;padding:28px 32px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#141416);'
        const head = document.createElement('div')
        head.style.cssText = 'margin-bottom:20px;'
        head.innerHTML = '<div style="font-size:24px;font-weight:700;color:var(--dsw-alias-label-primary,#e8e8e6)">运营工具</div>' +
          '<div style="font-size:14px;color:var(--dsw-alias-label-tertiary,#8b8b88)">产品知识与运营辅助能力</div>'
        root.appendChild(head)
        for (const g of GROUPS) {
          const block = document.createElement('div')
          block.style.cssText = 'margin-bottom:24px;'
          const label = document.createElement('div')
          label.textContent = g.group
          label.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8b8b88);margin-bottom:10px;'
          block.appendChild(label)
          const grid = document.createElement('div')
          grid.style.cssText = 'display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));'
          for (const t of g.tools) {
            const card = document.createElement('div')
            // 入场 stagger + hover 抬升（SRC OtToolCard 口径，2026-09-25 动画层补齐）
            card.className = 'tintin-grid-card tintin-stagger-item'
            card.style.cssText = 'position:relative;border-radius:14px;padding:18px;background:var(--dsw-alias-bg-layer-2,#1e1e20);border:0.5px solid var(--dsw-alias-border-l4,#555);cursor:default;'
            card.innerHTML = '<span style="position:absolute;top:10px;right:12px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b88);border:1px dashed var(--dsw-alias-border-l4,#555);border-radius:999px;padding:2px 10px">建设中</span>' +
              '<div style="width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;background:' + t.accent + '">' + t.emoji + '</div>' +
              '<div style="margin-top:10px;font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary,#e8e8e6)">' + t.title + '</div>' +
              '<div style="margin-top:4px;font-size:13px;color:var(--dsw-alias-label-tertiary,#8b8b88)">' + t.desc + '</div>'
            grid.appendChild(card)
          }
          block.appendChild(grid)
          root.appendChild(block)
        }
        el.appendChild(root)
      }

      // ── 浏览器 tab 面板（2026-09-28 用户裁决：浏览器整体按原客户端形态在独立窗口
      // 实现；登录态自动同步——cookie 变化即落盘、下载前自动核验，无手动导出）──
      // 平台卡片=入口（打开独立浏览器窗口/抽取当前页）；引擎在 src/main/tintin/browser/。
      function renderBrowserPanel(el) {
        const bridge = window.dshDesktopBrowser
        let platforms = []

        const root = document.createElement('div')
        root.style.cssText = 'width:100%;min-height:100%;padding:24px 32px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1,#141416);'
        const head = document.createElement('div')
        head.style.cssText = 'margin-bottom:16px;'
        head.innerHTML = '<div style="font-size:24px;font-weight:700;color:var(--dsw-alias-label-primary,#e8e8e6)">浏览器</div>' +
          '<div style="font-size:13px;color:var(--dsw-alias-label-tertiary,#8b8b88);margin-top:4px">平台登录态（独立浏览器窗口 · 各平台独立分区）——点平台卡「打开浏览器」，在窗口内登录即自动同步，参考视频下载直接可用</div>'
        root.appendChild(head)

        // 面板状态行（桥缺失/失败提示；登录态本身自动同步，不再有手动导出入口）
        const panelStatus = document.createElement('div')
        panelStatus.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary,#8b8b88);margin-bottom:16px;white-space:pre-wrap;word-break:break-all;'
        root.appendChild(panelStatus)

        // 抖店工作台入口（fxg 分区不进平台组——SRC 同；自动上架载体，2026-09-25）
        const fxgRow = document.createElement('div')
        fxgRow.style.cssText = 'display:flex;gap:10px;align-items:center;margin-bottom:16px;'
        const fxgBtn = document.createElement('button')
        fxgBtn.type = 'button'
        fxgBtn.textContent = '打开抖店工作台'
        fxgBtn.style.cssText = 'height:32px;padding:0 16px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l4,#555);background:var(--dsw-alias-bg-layer-2,#1e1e20);color:var(--dsw-alias-label-primary,#e8e8e6);font:inherit;font-size:13px;font-weight:600;cursor:pointer;'
        fxgBtn.onclick = async () => {
          if (!bridge) return
          fxgBtn.disabled = true
          try { const r = await bridge.open('fxg'); fxgBtn.textContent = r && r.ok ? '已打开 ✓' : '打开失败' } catch (e) { fxgBtn.textContent = '打开失败' }
          setTimeout(() => { fxgBtn.disabled = false; fxgBtn.textContent = '打开抖店工作台' }, 2000)
        }
        fxgRow.appendChild(fxgBtn)
        root.appendChild(fxgRow)
        // 抽取结果区（2026-09-25 平台 DOM 抽取移植：SRC browser:extractDOM 结果展示）
        const extractBox = document.createElement('div')
        extractBox.style.cssText = 'display:none;margin-bottom:16px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#1e1e20);border:0.5px solid var(--dsw-alias-border-l4,#555);max-height:320px;overflow:auto;'
        const extractTitle = document.createElement('div')
        extractTitle.style.cssText = 'font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary,#e8e8e6);margin-bottom:6px;'
        const extractBody = document.createElement('pre')
        extractBody.style.cssText = 'margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#c6c6c4);white-space:pre-wrap;word-break:break-all;font-family:inherit;'
        extractBox.appendChild(extractTitle)
        extractBox.appendChild(extractBody)
        root.appendChild(extractBox)

        const grid = document.createElement('div')
        grid.style.cssText = 'display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));'
        root.appendChild(grid)

        // ── 扩展管理区（2026-09-25 ext-manager 移植：内置预装 + crx/zip 安装/卸载）──
        const extBox = document.createElement('div')
        extBox.style.cssText = 'margin-top:8px;padding:14px 16px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#1e1e20);border:0.5px solid var(--dsw-alias-border-l4,#555);'
        const extHead = document.createElement('div')
        extHead.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;'
        extHead.innerHTML = '<span style="font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#e8e8e6)">浏览器扩展</span>'
        const extListEl = document.createElement('div')
        extListEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;'
        const extInstallBtn = document.createElement('button')
        extInstallBtn.type = 'button'
        extInstallBtn.textContent = '安装扩展（crx/zip）'
        extInstallBtn.style.cssText = 'height:30px;margin-left:auto;padding:0 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l4,#555);background:var(--dsw-alias-bg-layer-3,#2a2a2c);color:var(--dsw-alias-label-primary,#e8e8e6);font:inherit;font-size:12px;font-weight:600;cursor:pointer;'
        const extStatus = document.createElement('span')
        extStatus.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary,#8b8b88);'
        extHead.appendChild(extStatus)
        extHead.appendChild(extInstallBtn)
        extBox.appendChild(extHead)
        extBox.appendChild(extListEl)
        root.appendChild(extBox)

        function renderExtensions(list) {
          extListEl.textContent = ''
          for (const e of list) {
            const row = document.createElement('div')
            row.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:13px;color:var(--dsw-alias-label-primary,#e8e8e6);'
            const name = document.createElement('span')
            name.textContent = `${e.name} v${e.version}${e.builtin ? '（预装）' : ''}`
            name.title = e.description || ''
            const spacer = document.createElement('span')
            spacer.style.cssText = 'flex:1'
            const op = document.createElement('button')
            op.type = 'button'
            op.style.cssText = 'height:26px;padding:0 10px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l4,#555);background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b88);font:inherit;font-size:12px;cursor:pointer;'
            if (e.builtin) {
              op.textContent = '预装'
              op.disabled = true
            } else {
              op.textContent = '卸载'
              op.onclick = async () => {
                op.disabled = true
                try {
                  const r = await bridge.extensionUninstall(e.id)
                  extStatus.textContent = r && r.success ? r.message : (r && r.message) || '卸载失败'
                } catch (err) { extStatus.textContent = '卸载失败：' + String((err && err.message) || err) }
                op.disabled = false
              }
            }
            row.appendChild(name)
            row.appendChild(spacer)
            row.appendChild(op)
            extListEl.appendChild(row)
          }
          if (!list.length) {
            const empty = document.createElement('div')
            empty.textContent = '暂无扩展'
            empty.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary,#8b8b88);'
            extListEl.appendChild(empty)
          }
        }

        // ── 下载与采集记录（2026-09-25 download-manager/media-storage 移植：记录展示 + 清空）──
        const recordsBox = document.createElement('div')
        recordsBox.style.cssText = 'margin-top:10px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#1e1e20);border:0.5px solid var(--dsw-alias-border-l4,#555);'
        const recordsHead = document.createElement('div')
        recordsHead.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:6px;'
        recordsHead.innerHTML = '<span style="font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary,#e8e8e6)">下载与采集记录</span>'
        const recordsClear = document.createElement('button')
        recordsClear.type = 'button'
        recordsClear.textContent = '清空记录'
        recordsClear.style.cssText = 'height:26px;margin-left:auto;padding:0 10px;border-radius:6px;border:0.5px solid var(--dsw-alias-border-l4,#555);background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b88);font:inherit;font-size:12px;cursor:pointer;'
        const recordsList = document.createElement('div')
        recordsList.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto;'
        recordsHead.appendChild(recordsClear)
        recordsBox.appendChild(recordsHead)
        recordsBox.appendChild(recordsList)
        root.appendChild(recordsBox)

        function renderRecords(downloads, sniffed) {
          recordsList.textContent = ''
          const rows = [
            ...downloads.slice(0, 30).map((d) => ({ text: '⬇ ' + (d.name || d.id) + '（' + (d.size ? (d.size / 1048576).toFixed(1) + 'MB' : '?') + '）' })),
            ...sniffed.slice(0, 20).map((m) => ({ text: '◎ ' + (m.name || m.url) })),
          ]
          for (const row of rows) {
            const el = document.createElement('div')
            el.textContent = row.text
            el.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-secondary,#c6c6c4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
            recordsList.appendChild(el)
          }
          if (!rows.length) {
            const empty = document.createElement('div')
            empty.textContent = '暂无记录（抽取/下载后在此显示）'
            empty.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary,#8b8b88);'
            recordsList.appendChild(empty)
          }
        }

        async function refreshRecords() {
          if (!bridge) return
          try {
            const dl = await bridge.mediaStorageGetDownloads()
            const sn = await bridge.mediaStorageGetSniffed()
            renderRecords((dl && dl.data) || [], (sn && sn.data) || [])
          } catch { /* 桥不可用静默 */ }
        }
        recordsClear.onclick = async () => {
          if (!bridge) return
          try { await bridge.mediaStorageClearHistory({ type: "all" }); await refreshRecords() } catch { /* ignore */ }
        }
        extInstallBtn.onclick = async () => {
          if (!bridge) { extStatus.textContent = '桌面桥不可用（需完整壳）'; return }
          try {
            const picked = await window.tintin.dialog.openFile({
              title: '选择扩展包（crx/zip）',
              filters: [{ name: '扩展包', extensions: ['crx', 'zip'] }],
            })
            if (!picked) return
            extStatus.textContent = '安装中…'
            const r = await bridge.extensionInstall(picked)
            extStatus.textContent = (r && r.message) || (r && r.success ? '已安装' : '安装失败')
          } catch (e) { extStatus.textContent = '安装失败：' + String((e && e.message) || e) }
        }

        const statusEls = new Map()
        function paintStatus(counts) {
          for (const [id, el] of statusEls) {
            const n = counts[id]
            el.textContent = n > 0 ? `已登录（${n} 条 cookie）` : '未登录'
            el.style.color = n > 0 ? '#4ade80' : 'var(--dsw-alias-label-tertiary,#8b8b88)'
          }
        }

        el.appendChild(root)
        if (!bridge) {
          panelStatus.textContent = '桌面桥不可用（需完整壳，纯浏览器预览无此能力）'
          return
        }
        void bridge.platforms().then(async (list) => {
          platforms = Array.isArray(list) ? list : []
          for (const p of platforms) {
            const card = document.createElement('div')
            // 入场 stagger + hover 抬升（SRC OtToolCard 口径，2026-09-25 动画层补齐）
            card.className = 'tintin-grid-card tintin-stagger-item'
            card.style.cssText = 'border-radius:14px;padding:16px;background:var(--dsw-alias-bg-layer-2,#1e1e20);border:0.5px solid var(--dsw-alias-border-l4,#555);display:flex;flex-direction:column;gap:8px;'
            const title = document.createElement('div')
            title.textContent = p.name
            title.style.cssText = 'font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary,#e8e8e6);'
            const status = document.createElement('div')
            status.textContent = '检测中…'
            status.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary,#8b8b88);'
            statusEls.set(p.id, status)
            const openBtn = document.createElement('button')
            openBtn.type = 'button'
            openBtn.textContent = '打开浏览器'
            openBtn.style.cssText = 'height:32px;margin-top:2px;padding:0 14px;border-radius:8px;border:none;background:#4f7cff;color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;align-self:flex-start;'
            openBtn.onclick = async () => {
              openBtn.disabled = true
              openBtn.textContent = '打开中…'
              try {
                const r = await bridge.open(p.id)
                openBtn.textContent = r && r.ok ? '已打开 ✓' : '打开失败'
                if (!(r && r.ok)) panelStatus.textContent = `打开失败：${(r && r.error) || '?'}`
              } catch (e) { openBtn.textContent = '打开失败'; panelStatus.textContent = `打开失败：${(e && e.message) || e}` }
              setTimeout(() => { openBtn.disabled = false; openBtn.textContent = '打开浏览器' }, 2000)
            }
            card.appendChild(title)
            card.appendChild(status)
            // 按钮行：打开浏览器 + 抽取当前页（2026-09-25 平台 DOM 抽取移植）
            const btnRow = document.createElement('div')
            btnRow.style.cssText = 'display:flex;gap:8px;'
            openBtn.style.marginTop = '2px'
            const extractBtn = document.createElement('button')
            extractBtn.type = 'button'
            extractBtn.textContent = '抽取当前页'
            extractBtn.style.cssText = 'height:32px;margin-top:2px;padding:0 14px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l4,#555);background:var(--dsw-alias-bg-layer-3,#2a2a2c);color:var(--dsw-alias-label-primary,#e8e8e6);font:inherit;font-size:13px;font-weight:600;cursor:pointer;'
            extractBtn.onclick = () => {
              extractBtn.disabled = true
              extractBtn.textContent = '抽取中…'
              void extractPlatform(p).finally(() => { extractBtn.disabled = false; extractBtn.textContent = '抽取当前页' })
            }
            btnRow.appendChild(openBtn)
            btnRow.appendChild(extractBtn)
            card.appendChild(btnRow)
            grid.appendChild(card)
          }
          paintStatus((await bridge.loginStatus().catch(() => ({ counts: {} }))).counts)
          // 扩展清单（ext-manager）+ 变更广播订阅（SRC browser:extensions-changed）
          try {
            const el = await bridge.extensionList()
            renderExtensions((el && el.data && el.data.extensions) || [])
          } catch { renderExtensions([]) }
          bridge.onExtensionsChanged((payload) => { renderExtensions(payload.extensions) })
          void refreshRecords()
          void refreshRecords()
        }).catch(() => { panelStatus.textContent = '平台表加载失败（需完整壳）' })
      }

      function render() {
        paintEntries()
        syncOverlayBounds()
        mountActive()
      }

      injectEntries()
      render()
    }

    // 按功能测试连接 → dsh-tintin-client-ui/client（由 apply() 调用）。

    // ── WP-2 window.tintin polyfill ─────────────────────────────────────────
    // Rebuild the old client's preload bridge with identical signatures so the
    // ported Vue views run unmodified. server.* forwards to /tintin/ipc/*;
    // event-style subscriptions (progress) become jobId polling (主方案 §3.1).
    // WP-3 growth: the 文案混剪 closure also drives the preload's named
    // channels — server.montageSplit/llmChat/downloadResult/…, ffmpeg.*,
    // liveclip.* and the dialog/shell surfaces. Namespaces are Proxies over a
    // base object: known members carry browser-capable implementations, any
    // other member forwards to /tintin/ipc/<ns>:<method> so an unbridged call
    // fails loudly with its exact channel name (铁律 7) instead of
    // "not a function"; the host whitelist grows channel by channel.
    function installTintinBridge() {
      if (window.tintin && window.tintin.__dshPolyfill) return // idempotent
      const call = (channel, payload) =>
        // 通道名（server:get）的冒号是路径的一部分，不编码——host 按
        // /tintin/ipc/server:get 匹配（encodeURIComponent 会把 : 编成 %3A 失配）。
        fetch(`/tintin/ipc/${channel}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload ?? {}),
        }).then(async (r) => {
          const j = await r.json().catch(() => ({}))
          if (!r.ok) {
            // 诊断打点（2026-09-27 405 报障）：渲染层→宿主这一跳的失败原本
            // 不落任何日志（宿主 ✗ warn 只覆盖宿主→服务端一段）。把状态与
            // body 形态带回 harness.log——body 是 {detail}（FastAPI 直答）、
            // {error}（宿主桥答）还是非 JSON，一望即知失败发生在哪一层。
            const bodyText = (() => { try { return JSON.stringify(j) } catch { return String(j) } })()
            try {
              // console 兜底：宿主不可达时 env:log 同样发不出去，DevTools 至少可见
              console.error(`[tintin][bridge] POST /tintin/ipc/${channel} -> ${r.status} ${bodyText.slice(0, 200)}`)
              void window.tintin?.env?.log?.({
                level: 'error',
                tag: 'bridge',
                message: `POST /tintin/ipc/${channel} -> ${r.status} body=${bodyText.slice(0, 300)}`,
              })
            } catch { /* 日志通道未就绪时静默，原始错误照常上抛 */ }
            throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status })
          }
          return j.result
        })
      // ipcRenderer.invoke 是位置参数；宿主 IPC 走单 JSON body，约定包成 { args }。
      // 回调参数（进度等）不可序列化且按主方案走轮询，置 undefined 剔除。
      const forwardArgs = (args) => Array.from(args, (a) => (typeof a === 'function' ? undefined : a))
      const namespaced = (ns, base) => new Proxy(base, {
        get: (target, prop) => {
          if (typeof prop !== 'string' || prop === 'then') return undefined
          const hit = target[prop]
          if (hit !== undefined) return hit
          return (...args) => call(`${ns}:${prop}`, { args: forwardArgs(args) })
        },
      })
      // Multipart upload: XHR gives native FormData multipart + real
      // upload progress (fetch cannot); host route /tintin/upload forwards
      // the body verbatim to the service. onProgress(ratio 0..1) optional.
      const serverUpload = (path, fields, onProgress, method) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        // 上游方法透传（默认 POST；frames 端点=PUT multipart——405 修复 2026-10-06）：
        // 传输层恒 POST /tintin/upload，上游方法经 query 带给宿主白名单转发
        const upstreamMethod = method === 'PUT' ? 'PUT' : 'POST'
        const methodQs = upstreamMethod === 'PUT' ? '&method=PUT' : ''
        xhr.open('POST', `/tintin/upload?path=${encodeURIComponent(path)}${methodQs}`)
        if (typeof onProgress === 'function') {
          xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
        }
        xhr.onload = () => {
          let j = null
          try { j = JSON.parse(xhr.responseText) } catch { /* non-json */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(j ? j.result : j)
          else reject(Object.assign(new Error((j && j.error) || `HTTP ${xhr.status}`), { status: xhr.status }))
        }
        xhr.onerror = () => reject(new Error('upload network error'))
        xhr.send(fields)
      })
      const server = namespaced('server', {
        get: (path, params) => call('server:get', { path, params }),
        post: (path, body, headers, timeout) => call('server:post', { path, body, headers, timeout }),
        put: (path, body, headers) => call('server:put', { path, body, headers }),
        delete: (path, params) => call('server:delete', { path, params }),
        upload: serverUpload,
        // SSE progress streams (2026-09-25, 封面制作卡首发)：渲染层 fetch 宿主
        // 透传路由 /tintin/sse（宿主把上游 text/event-stream body 原样转发）。
        // 解析语义对齐 SRC server:sse（L556-601）：只认 `data:` 行、[DONE] →
        // {done:true}、JSON 解析失败透传原始字符串、流结束补 {done:true}。
        // 退订 abort fetch → 宿主检测连接关闭销毁上游（SRC 只移除监听不关上游，
        // 这里按更严格语义关连接）。服务端离线表现为非 2xx fetch → onError。
        // 注意用具名 pump 而非 async IIFE 收尾——polyfill-coverage 审计以 IIFE
        // 立即调用序列定位 server 块结束，块内注释/代码不得提前出现该序列。
        sse: (path, onEvent, onError) => {
          const ctrl = new AbortController()
          const emit = typeof onEvent === 'function' ? onEvent : () => {}
          const pump = async () => {
            try {
              const resp = await fetch(`/tintin/sse?path=${encodeURIComponent(path)}`, {
                signal: ctrl.signal,
                headers: { Accept: 'text/event-stream' },
              })
              if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
              const reader = resp.body.getReader()
              const decoder = new TextDecoder()
              let buffer = ''
              for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() ?? ''
                for (const line of lines) {
                  if (!line.startsWith('data:')) continue
                  const data = line.slice(5).trim()
                  if (data === '[DONE]') {
                    emit({ done: true })
                    try { await reader.cancel() } catch { /* already closed */ }
                    return
                  }
                  try { emit(JSON.parse(data)) } catch { emit(data) }
                }
              }
              emit({ done: true })
            } catch (err) {
              if (ctrl.signal.aborted) return
              if (typeof onError === 'function') onError(err instanceof Error ? err : new Error(String(err)))
            }
          }
          pump().catch(() => { /* pump 已自捕获；兜底 onError 自身抛错 */ })
          return () => ctrl.abort()
        },

        // ── 命名通道（对照源 preload server 域逐个映射，2026-09-23 WP-1 续）──
        // 三类：HTTP 封装（方法+路径）、multipart 上传封装（File/Blob 进
        // FormData）、本地原生通道（lib/montage/ 已接线——命名方法 → 冒号
        // 通道，args 按源 invoke 的位置参数包一层）。未映射的本地通道
        // （montage:clearCache 等本地 fs 操作未搬）走 Proxy 转发 404，
        // 调用点 catch 降级。
        // ── 本地原生（lib/montage）──
        finalMix: (p, onProgress) => call('final:mix', { args: [p, undefined, onProgress] }),
        finalCollectOutputs: (dir) => call('final:collectOutputs', { args: [dir] }),
        finalFindSrt: (p) => call('final:findSrt', { args: [p] }),
        finalListResults: (dir) => call('final:listResults', { args: [dir] }),
        finalReadTiming: (p) => call('final:readTiming', { args: [p] }),
        jianyingExport: (p) => call('jianying:export', { args: [p] }),
        lutList: () => call('lut:list', { args: [] }),
        jyTemplatesList: (p) => call('jytpl:list', { args: [p] }),
        jyTemplatesSync: (p) => call('jytpl:sync', { args: [p] }),
        jyTemplatesDeleteServer: (p) => call('jytpl:deleteServer', { args: [p] }),
        // 2026-09-30：文字模板包「服务端→本机剪映」安装（进入剪映模板工具/第四步导出前自动触发）
        jyTemplatesInstall: (p) => call('jytpl:install', { args: [p] }),
        // 剪映模板页「字体（剪映）」分类（SRC preload jyfonts 域，2026-09-24 随卡片启用补映射）
        jyfontsScan: () => call('jyfonts:scan', { args: [] }),
        jyfontsServerList: () => call('jyfonts:serverList', { args: [] }),
        jyfontsUpload: (p) => call('jyfonts:upload', { args: [p] }),
        editorExportJianyingPackage: (p) => call('editor:exportJianyingPackage', { args: [p] }),
        bgmDownloadUrl: (p) => call('bgm:downloadUrl', { args: [p] }),
        voiceScanDir: (p) => call('voice:scanDir', { args: [p] }),
        voiceCloneBatch: (p, onProgress) => call('voice:cloneBatch', { args: [p, undefined, onProgress] }),
        voiceCloneBatchStop: (p) => call('voice:cloneBatchStop', { args: [p] }),
        voiceDubVideos: (p, onProgress) => call('voice:dubVideos', { args: [p, undefined, onProgress] }),
        voiceFonts: () => call('voice:fonts', { args: [] }),
        voiceFontFile: (p) => call('voice:fontFile', { args: [p] }),
        voiceSubtitleStyles: () => call('voice:subtitleStyles', { args: [] }),
        voiceExportAudio: (p) => call('voice:exportAudio', { args: [p] }),
        fancyListTemplates: () => call('fancy:listTemplates', { args: [] }),
        fancyServerTemplates: () => call('fancy:serverTemplates', { args: [] }),
        fancyEnsurePreviews: (p, onProgress) => call('fancy:ensurePreviews', { args: [p, undefined, onProgress] }),
        textfxServerTemplates: () => call('textfx:serverTemplates', { args: [] }),
        jyAudioSyncNow: () => call('jyaudio:syncNow', { args: [] }),
        jyAudioSyncStatus: () => call('jyaudio:status', { args: [] }),
        jyAudioSetEnabled: (enabled) => call('jyaudio:setEnabled', { args: [enabled] }),
        // ── HTTP 封装 ──
        llmChat: (payload) => call('server:post', { path: '/llm/chat/completions', body: payload }),
        llmModels: () => call('server:get', { path: '/llm/models' }),
        copywritingVoiceover: (payload) => call('server:post', { path: '/copywriting/voiceover', body: payload }),
        // 声音样本域（2026-09-24 补链：ttsVoicesSamples 未映射→样本试听复盘）。
        ttsVoicesSamples: (params) => call('server:get', { path: '/voice/samples', params: params ?? {} }),
        ttsQwen3Voices: () => call('server:get', { path: '/indextts/qwen3/voices' }),
        ttsUploadSample: (p, _onProgress) => call('tts:uploadSample', { args: [p] }),
        asrTranscribe: (p, _onProgress) => call('asr:transcribe', { args: [p] }),
        // TTS 生成（resp=json 模式）+ 音频落盘/下载 + 音频库上传（声音克隆域）
        ttsGenerate: (p) => call('tts:generate', { args: [p] }),
        ttsSaveAudio: (p) => call('tts:saveAudio', { args: [p] }),
        audioLibraryUpload: (p) => call('audio:libraryUpload', { args: [p] }),
        downloadResult: (path, savePath) => call('server:downloadResult', { args: [path, savePath] }),
        // 音频生成域三通道（2026-09-25 随音频生成卡出清 PENDING 白名单）：下载临时/
        // 归档落盘走宿主 httpRequest+fs（渲染层无请求能力），BGM 入库 multipart 由
        // 宿主读盘组装（相对 URL 的服务端基址解析在宿主 downloadTemp/archiveGen 内，
        // 生成结果的 /output 改写由 useAudioGen.toAbsolute 承担）。
        audioDownloadTemp: (p) => call('audio:downloadTemp', { args: [p] }),
        audioArchiveGen: (p) => call('audio:archiveGen', { args: [p] }),
        audioBgmUpload: (p) => call('audio:bgmUpload', { args: [p] }),
        // 图像抠图域（2026-09-25 随卡片启用补映射，SRC preload rembg 域）：
        // 模型列表走通用 GET，SRC rembg:models 的 {models} 归一化在此复刻
        // （离线 null/失败 → 组件用静态兜底，ImageMatting onMounted 同口径）；
        // 抠图提交是「multipart 上传 + 二进制 PNG 回包」，浏览器读不了 {path}
        // 本地文件、JSON 桥也驮不动二进制（字体冻结教训 5ee336c）——转发宿主
        // rembg:submit（读盘组 multipart、PNG 落盘原图旁、返 {path,bytes}）。
        // 上传进度事件不落桥（同 montage:split 口径），上传指示停在排队态直到完成。
        mattingModels: async () => {
          const res = await call('server:get', { path: '/matting/models' })
          const list = Array.isArray(res) ? res : (res && Array.isArray(res.models) ? res.models : [])
          return { models: list }
        },
        rembgSubmit: (p, _onProgress) => call('rembg:submit', { args: [p] }),
        skillsInstall: (id) => call('skills:install', { args: [id] }), // 客户端技能包落盘（2026-10-16 安装升级裁决）
        tasksProgress: (id) => call('server:get', { path: `/tasks/${encodeURIComponent(String(id ?? ''))}` }),
        tasksUnifiedItem: (id) => call('server:get', { path: `/tasks/unified/${encodeURIComponent(String(id ?? ''))}` }),
        materialList: (params) => call('server:get', { path: '/material/list', params: params ?? {} }),
        materialStockSearch: (payload) => call('server:post', { path: '/material/stock_search', body: payload }),
        audioGenBgm: (payload) => call('server:post', { path: '/audio/gen/bgm', body: payload }),
        audioGenSfx: (payload) => call('server:post', { path: '/audio/gen/sfx', body: payload }),
        // 仿爆款：multipart 上传本地视频到服务端 output/upload 区，返回 video_path（SRC preload viralCloneUpload；走通用 /tintin/upload + serverUpload 进度）
        viralCloneUpload: (p, onProgress) => {
          const fd = new FormData()
          for (const [k, v] of Object.entries(p || {})) {
            if (v === undefined || v === null) continue
            if (typeof File !== 'undefined' && v instanceof File) fd.append(k, v)
            else fd.append(k, String(v))
          }
          return serverUpload('/viral/clone/upload', fd, onProgress)
        },
        viralCloneAnalyze: (payload) => call('server:post', { path: '/viral/clone/analyze', body: payload }),
        viralClonePlan: (payload) => call('server:post', { path: '/viral/clone/plan', body: payload }),
        viralCloneFlow: (payload) => call('server:post', { path: '/viral/clone/flow', body: payload }),
        viralCloneGenerate: (payload) => call('server:post', { path: '/viral/clone/generate', body: payload }),
        viralCloneMontage: (payload) => call('server:post', { path: '/viral/clone/montage', body: payload }),
        viralCloneReview: (payload) => call('server:post', { path: '/viral/clone/review', body: payload }),
        listServerWorkflows: (scope) => call('server:get', { path: '/workflows', params: { scope } }),
        // SRC preload L299-302：multipart POST /workflows/{id}/run（fields+__values JSON），返回 {task_id}
        runServerWorkflow: (workflowId, fields, onProgress) => {
          const fd = new FormData()
          fd.append('__values', JSON.stringify(fields && fields.__values ? fields.__values : {}))
          for (const [k, v] of Object.entries(fields || {})) {
            if (k === '__values') continue
            if (typeof File !== 'undefined' && v instanceof File) fd.append(k, v, k)
            else if (typeof Blob !== 'undefined' && v instanceof Blob) fd.append(k, v, k)
            else fd.append(k, String(v))
          }
          return serverUpload('/workflows/' + encodeURIComponent(workflowId) + '/run', fd, onProgress)
        },
        serverWorkflowStatus: (taskId) => call('server:get', { path: `/workflows/task/${encodeURIComponent(taskId)}` }),
        // multipart 上传族：payload 字段 → FormData（File/Blob 原样，标量转字符串）
        ...(() => {
          const uploadNamed = (path) => (payload, onProgress) => {
            const fd = new FormData()
            const p = payload ?? {}
            for (const [k, v] of Object.entries(p)) {
              if (v === undefined || v === null) continue
              if (typeof File !== 'undefined' && v instanceof File) fd.append(k, v)
              else if (typeof Blob !== 'undefined' && v instanceof Blob) fd.append(k, v, k)
              else fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
            }
            return serverUpload(path, fd, onProgress)
          }
          return {
            // 2026-09-24 修复：分割的 file 字段是 {path} 本地文件包装，浏览器读
            // 不了盘——转发宿主 montage:split 通道由宿主读盘组 multipart
            // （此前 JSON.stringify 成字符串上传，服务端 422 Expected UploadFile）。
            // 去水印字幕（SRC preload vsr:remove 契约；进度事件不落桥）
            vsrRemove: (p, _onProgress) => call('vsr:remove', { args: [p] }),
            montageSplit: (p, _onProgress) => call('montage:split', { args: [p] }),
            // Step2-4 本地合成族（2026-09-25 出清 PENDING：宿主 final-ipc.js 通道已就绪）
            trimEdgeClips: (p) => call('montage:trimEdgeClips', { args: [p] }),
            montageConcatClips: (p) => call('montage:concatClips', { args: [p] }),
            montageValidateFinal: (path) => call('montage:validateFinal', { args: [{ path }] }),
            montageDeleteBadFinal: (path) => call('montage:deleteBadFinal', { args: [{ path }] }),
            clearMontageCache: (dir) => call('montage:clearCache', { args: [{ dir }] }),
            montageConcat: uploadNamed('/montage/concat'),
            montageBgm: uploadNamed('/montage/bgm'),
            promptVideo: uploadNamed('/prompt/video'),
            materialOcr: uploadNamed('/material/ocr'),
          }
        })(),
        // 进度事件订阅不落桥（主方案 §3.1：进度走 jobId 轮询）。返回 no-op
        // 退订函数，保持源调用点 offXxx?.() 清理语义；无事件到达时调用方
        // 按各自兜底路径（轮询/完成态回写）推进。
        onVoiceProgress: () => () => {},
        fancyOnPreviewProgress: () => () => {},
      })

      // ── dialog：浏览器原生 <input type=file> 重建 ─────────────────────────
      // 在 Electron 渲染进程里 File.path 携带真实绝对路径，选择器行为与源
      // preload 一致（main.js dialog:* 契约：取消→null，否则路径/数组）；
      // 纯浏览器里路径不可得 → canceled(null) 退化。
      const pickInputFiles = (opts) => new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        if (opts?.multiple) input.multiple = true
        if (opts?.directory) input.setAttribute('webkitdirectory', '')
        const filters = opts?.filters
        if (Array.isArray(filters) && filters.length) {
          input.accept = filters.flatMap((f) => (f?.extensions || [])
            .map((e) => (String(e).startsWith('.') ? String(e) : '.' + String(e)))).join(',')
        }
        input.style.display = 'none'
        const done = (files) => { input.remove(); resolve(files) }
        input.addEventListener('change', () => done(Array.from(input.files || [])), { once: true })
        input.addEventListener('cancel', () => done([]), { once: true })
        document.body.appendChild(input)
        input.click()
      })
      // Electron 43 移除 File.path，经 preload 桥解析绝对路径：fork 名
      // dshDesktopFilePath.forFile 之外再试通道契约名 __DSH_DESKTOP_FILE_PATH__.getPathForFile
      // （迁移只带来了消费方，暴露层用的是上游契约名——单试 fork 名会静默失效）。
      const pickedPath = (f) => {
        if (!f) return ''
        try {
          const viaBridge = window.dshDesktopFilePath?.forFile?.(f) || window.__DSH_DESKTOP_FILE_PATH__?.getPathForFile?.(f)
          if (typeof viaBridge === 'string' && viaBridge) return viaBridge
        } catch { /* 桥缺失走降级 */ }
        return f.path || ''
      }
      const dialog = namespaced('dialog', {
        // openFile 选中即登记（2026-10-08）：pickedPath 先等 media:unlock 落地
        // 再交出路径——消费方读取必然晚于登记，根除「登记与读取赛跑→403」。
        openFile: async (params) => {
          const p = pickedPath((await pickInputFiles({ filters: params?.filters }))[0]) || null
          if (p) { try { await call('media:unlock', { args: [p] }) } catch { /* 读取侧 403 暴露 */ } }
          return p
        },
        openFiles: async (params) => {
          const paths = (await pickInputFiles({ multiple: true, filters: params?.filters })).map(pickedPath).filter(Boolean)
          return paths.length ? paths : null
        },
        openDir: async () => {
          const first = (await pickInputFiles({ directory: true }))[0]
          const rel = first && String(first.webkitRelativePath || '').replace(/\\/g, '/')
          let abs = pickedPath(first).replace(/\\/g, '/')
          if (!abs) return null
          // 根目录 = 首文件绝对路径剥掉 webkitRelativePath 尾段
          if (rel && abs.endsWith('/' + rel)) abs = abs.slice(0, abs.length - rel.length - 1)
          return abs || null
        },
        // 浏览器无保存对话框：恒 null（=取消）。2026-10-12 定案：宿主 bundle 跑在
        // Harness 子进程（纯 node）无 electron 对话框能力（两次实障）；原生保存
        // 对话框由桌面壳 preload 桥 dshDesktopSaveFilePicker 承担（壳随包重打包
        // 生效）；桥未就绪保持 null=取消。下载直落下载文件夹走 env.downloadsDir。
        saveFile: async (params) => {
          try {
            const picked = await window.dshDesktopSaveFilePicker?.pick?.(params)
            if (typeof picked === 'string' && picked) return picked
          } catch { /* 桥缺失/异常走取消 */ }
          return null
        },
        // 渲染层无 fs 遍历能力：转发宿主 dialog:collectVideos（递归收集目录内
        // 视频，自然序排序；2026-09-24 用户报障”拖入文件夹只进文件夹本身”——
        // 此前此处恒 []，渲染层回退把目录路径当素材推入）。
        collectVideos: (p) => call('dialog:collectVideos', { args: [p] }),
      })

      // ── shell：浏览器可承载的轻量动作；本地路径类动作无等价能力 ──────────
      // 源调用点均为 try/catch fire-and-forget 的锦上添花动作，这里不 reject，
      // 避免 void 调用点产生 unhandled rejection 噪音。
      const shell = namespaced('shell', {
        openExternal: (url) => { if (/^https?:\/\//i.test(String(url))) window.open(url, '_blank', 'noopener') },
        openItem: (path) => {
          const s = String(path || '')
          // 2026-09-24 修复：此前仅支持 http（本地目录点击无反应）——本地路径
          // 转发宿主 shell:openItem（explorer/open/xdg-open 按平台）。
          if (/^https?:\/\//i.test(s)) { window.open(s, '_blank', 'noopener'); return Promise.resolve({ ok: true }) }
          return call('shell:openItem', { args: [s] })
        },
        // 2026-09-25 补实：转发宿主 shell:revealInFolder（Windows explorer
        // /select、macOS open -R、Linux 打开所在目录）。源调用点为
        // fire-and-forget 锦上添花动作，catch 掉避免 void 调用点 unhandled
        // rejection 噪音。
        revealInFolder: (path) => call('shell:revealInFolder', { args: [path] }).catch(() => {}),
        showNotification: (title, body) => {
          try {
            if (typeof Notification === 'function') void new Notification(String(title ?? ''), { body: String(body ?? '') })
          } catch { /* 通知被拒/不可用：静默；错误另有 clientLog console 通道 */ }
        },
      })

      // ── ffmpeg / liveclip：宿主媒体/文件通道转发（WP-1 TINTIN_BIN_DIR 链路
      // 的消费端）。探测/抽帧/写文件在宿主落地前按 404 显式失败，调用点既有
      // catch/兜底显示（时长列 —、缩略图占位等），不阻断向导。
      const ffmpeg = namespaced('ffmpeg', {})
      const liveclip = namespaced('liveclip', {})
      // ── ytdlp：参考视频下载门（2026-09-25 随卡移植，SRC preload ytdlp 域）──
      // 策略在宿主 lib/ytdlp-logic.js、I/O 在 lib/ytdlp.js；cookies 由壳层浏览器
      // 引擎导出到交接目录后宿主自动前置 --cookies。进度事件不落桥（同
      // montage:split 口径）：download 阻塞到终态，onProgress 返回 no-op 退订
      // 保持源调用点 off() 语义。
      const ytdlp = namespaced('ytdlp', {
        status: () => call('ytdlp:status', { args: [] }),
        probe: (payload) => call('ytdlp:probe', { args: [payload] }),
        download: (payload) => call('ytdlp:download', { args: [payload] }),
        saveAs: (payload) => call('ytdlp:saveAs', { args: [payload] }),
        // 未登录引导（2026-09-28 用户裁决）：login_required 时一键经壳层回环打开内置浏览器
        openLoginBrowser: (payload) => call('ytdlp:openLoginBrowser', { args: [payload] }),
        onProgress: () => () => {},
      })

      // ── env.log：渲染层业务日志回流 host（C-6 闭环，2026-09-23 补）──────
      // 源链路 clientError → env:log IPC → logger.logError → 落盘+服务端上报；
      // 无 env 命名空间时 clientLog 退化 console.*（浏览器 DevTools，不落盘）。
      // 这里把 env.log 指到宿主 env:log 通道：host ctx.logger.error 落
      // harness.log（log-bridge），error 级再由 host 自动 POST /api/logs/upload。
      const env = namespaced('env', {
        log: (entry) => call('env:log', {
          args: [{
            level: entry?.level ?? 'info',
            tag: entry?.tag ?? 'renderer',
            message: entry?.message ?? '',
            ...(entry?.stack ? { stack: entry.stack } : {}),
          }],
        }),
        // 2026-09-24 补链：serverPing（SRC env-ipc.js pingServer 契约）——
        // context.ts/useAudioGen 等经它取服务端地址做媒体直连基址。
        serverPing: () => call('env:serverPing', { args: [] }),
        // 固定缓存目录（$DSH_HOME/tintin/cache，2026-09-23 裁决不做设置项）——
        // 渲染层 readCacheDir 的数据源。
        cacheDir: () => call('env:cacheDir', { args: [] }),
        // 清空固定缓存目录内容（设置卡「本地配置 → 立即清理」用）。
        clearCache: () => call('env:clearCache', { args: [] }),
        // 机器码（SRC env:getMachineId 契约 {ok,machineId}）——产品资料域以它拼
        // /api/product-library/clients/<machine_id> 路径（与 X-Machine-ID 头同值）。
        getMachineId: () => call('env:getMachineId', { args: [] }),
        // 系统下载文件夹。args[0]=文件名时返回 {path: 去重后完整目标}，缺省 {dir}。
        // 「下载直落下载文件夹」按钮的数据源（宿主纯 node 拼接 USERPROFILE）。
        downloadsDir: (fileName) => call('env:downloadsDir', { args: [fileName] }),
      })

      // ── media：预览解锁（2026-09-25 图像抠图卡引入）─────────────────────
      // /tintin/media 白名单根只覆盖缓存/工作区，用户自选目录的文件（原图与
      // 落盘在原图旁的抠图结果）预览需先经 media:unlock 单文件登记（存在性
      // 校验，宿主侧 FIFO 上限）。unlock 永不 reject——调用点全部 fire-and-forget。
      const media = namespaced('media', {
        unlock: (p) => call('media:unlock', { args: [p] }).catch(() => {}),
      })

      // ── context：会话上下文条 → 工作区 task.json（WP-5b，2026-09-25）────
      // 不改 dsh 底层的业务上下文注入：上下文条（conversation.input.accessory
      // slot）选中产品/素材/脚本后调用；宿主派生路径（TINTIN_WORKSPACE_DIR 或
      // Documents\tintin-workspace）并防御解析，agent 经自带 read 工具消费。
      const context = namespaced('context', {
        writeTask: (task) => call('context:writeTask', { args: [task] }),
      })
      // config:store — TinTin 自有配置存储（0.1.7 起设置服务拒写宿主插件条目，
      // 设置卡/首启向导的持久化走这里；读返回合并视图 自有存储∪profile config）。
      const config = namespaced('config', {})

      window.tintin = {
        __dshPolyfill: true,
        server,
        dialog,
        shell,
        ffmpeg,
        liveclip,
        ytdlp,
        env,
        media,
        context,
        config,
        // OpenFilm 启动（2026-10-18 裁决：侧栏入口=独立窗口）：宿主通道同步
        // 技能/服务并启动 Studio（不弹系统浏览器），壳桥按地址开窗；无壳退化为新标签页。
        openfilm: { openStudio: () => call('openfilm:studio', { args: [{}] }).then((r) => { const url = r?.url; if (!url) throw new Error(r?.error || 'Studio 未启动'); const bridge = window.dshDesktopOpenStudio; return bridge ? bridge.open(url) : window.open(url, '_blank', 'noopener') }) },
      }
      console.info('[tintin] window.tintin polyfill installed')
    }

    // Generic settings RPC for the card below (same-origin fetch carries the
    // harness session cookie; settings/describe + settings/mutate are public).
    const settingsRpc = (method, args) => fetch(method === 'settings/describe' ? '/api/settings/describe' : '/api/settings/mutate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `tintin-card-${Date.now()}`, method, payload: { args } }),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (j?.result?.ok === false) throw new Error(j.result.error?.message ?? method)
      return j?.result?.value
    })

    // ── 服务端自动注册(2026-09-30 用户裁决:服务菜单方向)─────────────────
    // 旧版在 Electron main(src/main/tintin-first-boot.ts 的 ensureTinTinProvider/
    // ensureDefaultWorkspace)经 token→cookie 换取会话后走公开 RPC;新框架宿主
    // 插件拿不到 web token,而本 chrome 每次加载都带会话 cookie 且 settingsRpc
    // 在位——自愈移到这里,每次页面加载幂等执行:
    //   server.url 已配置时:缺失则注册 tintin-server provider(模型列表经宿主
    //   probe 拉全量)、凭据占位补齐、默认工作区登记;默认模型仅在用户尚未
    //   改动系统默认(deepseek-official)时接管。
    function installTintinProvisioning() {
      const rpc = (method, args) => fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `tintin-provision-${Date.now()}`, method, payload: { args } }),
      }).then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (j?.result?.ok === false) throw new Error(j.result.error?.message ?? method)
        return j?.result?.value
      })
      const ensure = async () => {
        let serverUrl = ''
        try {
          const cfg = await window.tintin?.config?.get?.()
          const raw = cfg?.value?.server?.url
          if (typeof raw === 'string' && raw.length > 0) serverUrl = raw.replace(/\/+$/u, '')
        } catch { /* store read failure → treat as unconfigured */ }
        if (serverUrl.length === 0) return // 未配置——等首启向导或设置卡
        const describe = await settingsRpc('settings/describe', {})
        const nsValue = (name) => describe?.namespaces?.find?.((n) => n?.ns === name)?.value
        const log = (what) => console.info(`[tintin] provisioning: ${what}`)

        // Provider half (缺失才注册;probe 失败降级占位模型,下次加载重试)
        if (nsValue('llm-pi-ai')?.providers?.['tintin-server'] === undefined) {
          let models = [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }]
          let preferred = models[0]
          try {
            const r = await fetch('/tintin/setup/probe', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ url: serverUrl }),
            })
            const j = await r.json().catch(() => ({}))
            if (r.ok && Array.isArray(j?.result?.models) && j.result.models.length > 0) {
              models = j.result.models
              preferred = j.result.preferred ?? models.find((m) => m.default) ?? models[0]
            }
          } catch { /* server offline — placeholder provider, self-heals next load */ }
          await settingsRpc('settings/mutate', {
            ns: 'llm-pi-ai',
            ops: [{
              op: 'set', path: ['providers', 'tintin-server'], value: {
                displayName: 'TinTin', apiKeyEnv: 'TINTIN_SERVER_API_KEY', api: 'openai-completions',
                baseURL: `${serverUrl}/llm`, models: models.map((m) => ({ id: m.id, name: m.name })),
              },
            }],
          })
          log(`tintin-server provider registered from ${serverUrl} (${String(models.length)} models)`)
          // 默认模型:仅当仍是系统默认时接管(用户自选的不动)
          const adm = nsValue('agent-default-model')
          if ((adm?.provider ?? 'deepseek-official') === 'deepseek-official' && preferred?.id) {
            await settingsRpc('settings/mutate', {
              ns: 'agent-default-model',
              ops: [{ op: 'set', path: [], value: { provider: 'tintin-server', model: preferred.id } }],
            })
            log(`default model -> tintin-server/${String(preferred.id)}`)
          }
        }

        // Credential half(占位 key;服务端无鉴权,用户后配的真实值优先)
        try {
          const cred = await rpc('credentials/describe', { refs: ['TINTIN_SERVER_API_KEY'] })
          if (cred?.TINTIN_SERVER_API_KEY?.configured !== true) {
            await rpc('credentials/set', { ref: 'TINTIN_SERVER_API_KEY', value: 'sk-tintin-local' })
            log('tintin-server credential restored (placeholder)')
          }
        } catch { /* credentials RPC unavailable — provider apiKeyRef 缺失时模型页会提示 */ }

        // Workspace half(宿主先 mkdir,再走公开幂等 RPC)
        try {
          const r = await fetch('/tintin/workspace/ensure', { method: 'POST' })
          const j = await r.json().catch(() => ({}))
          if (r.ok && j?.result?.dir) {
            await rpc('workspace/create', { request: { path: j.result.dir } })
            log(`default workspace ensured: ${String(j.result.dir)}`)
          }
        } catch { /* UI 里仍可手动选择工作区 */ }
      }
      ensure().catch((e) => console.warn('[tintin] provisioning skipped:', e?.message ?? e))
    }

    // Install now (see header comment): the media bundle's factory registers
    // its view provider against __tintinViews, which must already exist.
    // 按功能测试连接 lives in dsh-tintin-client-ui and is installed from apply().
    installTintinChrome()
    installTintinBridge()
    installTintinProvisioning()

    return { settingsRpc }
  })()

// ── 插件定义（factory 期执行；React 只在此处可用）────────────────────────
// 设置卡走 settings.plugin.item slot（ConfigurablePluginsTab 契约：列表只
// 分发 key，卡片组件由插件 client 贡献——image-generation 同款注册式样）。
window.__ModuleLoader__.load({
  id: 'dsh-tintin-bundle',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    function TintinSettingsCard() {
      const [url, setUrl] = React.useState('')
      const [state, setState] = React.useState('loading') // loading|ready|saving|saved|error
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        // 读自有存储合并视图（0.1.7 起本插件条目配置设置服务拒写，持久化在
        // <DSH_HOME>/tintin/config.json；settings/describe 读 profile 层不再是
        // 权威源）。
        window.tintin?.config?.get?.().then((res) => {
          const u = res?.value?.server?.url
          setUrl(typeof u === 'string' ? u : '')
          setState('ready')
        }).catch((e) => { setError(String(e?.message ?? e)); setState('error') })
      }, [])
      const save = () => {
        setState('saving'); setError('')
        window.tintin?.config?.merge?.({ server: { url: url.replace(/\/$/u, '') } })
          .then(() => setState('saved'))
          .catch((e) => { setError(String(e?.message ?? e)); setState('error') })
      }
      // 测试连接（对齐 SRC useSettingsGeneral.pingServer）：env:serverPing 回显
      // 当前生效地址 + 在线状态 + 延迟；成功后回填输入框为解析链实际地址。
      const [pingState, setPingState] = React.useState('idle') // idle|pinging|done
      const [pingText, setPingText] = React.useState('')
      const pingOk = pingText.includes('运行中')
      const testConnection = () => {
        setPingState('pinging'); setPingText('')
        window.tintin?.env?.serverPing?.().then((r) => {
          if (r?.url && typeof r.url === 'string') setUrl(r.url)
          setPingText(r?.online ? `${r.url} · 运行中（${r.latencyMs}ms）` : `${r?.url || ''} · 离线`)
          setPingState('done')
        }).catch(() => { setPingText('检测失败'); setPingState('done') })
      }
      return h('div', { style: { padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { style: { fontSize: '15px', fontWeight: 600 } }, 'TinTin 服务器'),
        h('div', { style: { display: 'flex', gap: '8px' } },
          h('input', {
            value: url,
            onChange: (e) => { setUrl(e.target.value); setState('ready') },
            placeholder: 'http://192.168.0.10:8000',
            style: {
              flex: 1, minWidth: 0, height: '34px', padding: '0 12px', font: 'inherit',
              border: '0.5px solid var(--dsw-alias-border-l4, #555)', borderRadius: '8px',
              background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'inherit',
            },
          }),
          h('button', {
            type: 'button', onClick: save, disabled: state === 'saving' || state === 'loading',
            style: {
              appearance: 'none', font: 'inherit', padding: '0 16px', height: '34px', cursor: 'pointer',
              border: '0.5px solid transparent', borderRadius: '8px',
              background: 'var(--dsw-alias-label-primary, #4f7cff)', color: 'var(--dsw-alias-bg-layer-3, #fff)',
            },
          }, state === 'saving' ? '保存中…' : '保存'),
          h('button', {
            type: 'button', onClick: testConnection, disabled: pingState === 'pinging',
            style: {
              appearance: 'none', font: 'inherit', padding: '0 16px', height: '34px', cursor: 'pointer',
              border: '0.5px solid var(--dsw-alias-border-l4, #555)', borderRadius: '8px',
              background: 'transparent', color: 'inherit',
            },
          }, pingState === 'pinging' ? '检测中…' : '测试连接'),
        ),
        pingState === 'done' && pingText && h('span', {
          style: { fontSize: '12px', color: pingOk ? '#4ade80' : '#f87171' },
        }, pingText),
        state === 'saved' && h('span', { style: { fontSize: '12px', color: '#4ade80' } }, '已保存'),
        state === 'error' && h('span', { style: { fontSize: '12px', color: '#f87171' } }, `保存失败：${error}`),
        h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
          'AI 推理服务地址（FastAPI）。修改后模型提供方的 API 地址需在「设置 → 模型 → TinTin」同步更新。'),
      )
    }

    // 本地配置卡（2026-09-24 用户裁决：挂在「通用设置」页 settings.general.item
    // 插槽；缓存目录默认 = 本机工作区目录，「更改」弹目录选择器持久化到
    // local.cacheDir——对齐原客户端 CardLocalConfig/useSettingsIntegration 流程）。
    function LocalConfigCard() {
      const [cacheDir, setCacheDir] = React.useState('')
      const [pickHint, setPickHint] = React.useState('')
      const [clearState, setClearState] = React.useState('idle') // idle|clearing|cleared|error
      React.useEffect(() => {
        window.tintin?.env?.cacheDir?.().then((res) => {
          if (res?.dir) setCacheDir(String(res.dir))
        }).catch(() => {})
      }, [])
      const clearCache = () => {
        setClearState('clearing')
        window.tintin?.env?.clearCache?.().then((res) => {
          setClearState(res && !res.error ? 'cleared' : 'error')
        }).catch(() => setClearState('error'))
      }
      // 更改（2026-09-24 用户裁决：与原客户端一致——弹出原生文件夹选择框，
      // 选择后持久化为新的缓存目录。桌面端经 dshDesktopDirectoryPicker 出
      // 原生对话框，选定路径写 TinTin 自有存储（0.1.7 起设置服务拒写宿主插件
      // 条目），解析链即时生效。）
      const pickCacheDir = async () => {
        const picker = window.dshDesktopDirectoryPicker
        if (!picker?.pick) return
        try {
          const d = await picker.pick('选择本地缓存目录')
          if (!d) return // 取消
          await window.tintin?.config?.merge?.({ local: { cacheDir: String(d) } })
          setCacheDir(String(d))
          setPickHint('缓存目录已保存')
        } catch (e) {
          setPickHint(`保存失败：${String(e?.message ?? e)}`)
        }
        setTimeout(() => setPickHint(''), 2000)
      }
      return h('div', { style: { padding: '14px 0', display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { style: { fontSize: '15px', fontWeight: 600 } }, '本地配置'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', { style: { fontSize: '13px', fontWeight: 500 } }, '缓存目录'),
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
              '智能混剪、分割等生成的中间文件统一存放目录（默认为本机工作区目录，可更改）'),
            cacheDir && h('span', {
              title: cacheDir,
              style: { fontSize: '12px', fontFamily: 'monospace', color: 'var(--dsw-alias-label-secondary, #aaa)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, cacheDir),
            pickHint && h('span', { style: { fontSize: '12px', color: '#4ade80' } }, pickHint),
          ),
          h('button', {
            type: 'button', onClick: pickCacheDir, title: '选择新的缓存目录',
            style: {
              appearance: 'none', font: 'inherit', padding: '0 14px', height: '32px', cursor: 'pointer',
              border: '0.5px solid var(--dsw-alias-border-l4, #555)', borderRadius: '8px',
              background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'inherit',
            },
          }, cacheDir ? '更改' : '浏览…'),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', { style: { fontSize: '13px', fontWeight: 500 } }, '缓存清理'),
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #888)' } },
              '释放临时文件与预览缓存占用的空间（下载结果默认存于上方缓存目录）'),
            clearState === 'cleared' && h('span', { style: { fontSize: '12px', color: '#4ade80' } }, '已清理'),
            clearState === 'error' && h('span', { style: { fontSize: '12px', color: '#f87171' } }, '清理失败：部分文件可能正被使用，请稍后重试'),
          ),
          h('button', {
            type: 'button', onClick: clearCache, disabled: clearState === 'clearing',
            style: {
              appearance: 'none', font: 'inherit', padding: '0 14px', height: '32px', cursor: 'pointer',
              border: '0.5px solid var(--dsw-alias-border-l4, #555)', borderRadius: '8px',
              background: 'var(--dsw-alias-bg-layer-3, transparent)', color: 'inherit',
            },
          }, clearState === 'clearing' ? '清理中…' : '立即清理'),
        ),
      )
    }

    return {
      name: 'dsh-tintin-bundle',
      inject: ['slots'],
      apply(ctx) {
        // 侧栏守卫把上游 panellist 行（0.2.1 的「自动化任务」）让给上游页面时，用它补一次主区选择。
        window.__tintinSelectPanel = (id) => { try { ctx.get('layout')?.selectPanel(id) } catch { /* layout not ready */ } }
        // 按功能测试连接（dsh-tintin-client-ui；缺包时不影响其余 UI）
        try { require('dsh-tintin-client-ui/client').installCapabilityTests() } catch { /* optional bundle */ }
        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: 'dsh-tintin-bundle', order: -90 }, TintinSettingsCard))
        // 本地配置（缓存目录/清理）挂「通用设置」页（2026-09-24 用户裁决）
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'tintin-local-config', order: -90 }, LocalConfigCard))

        // First-boot setup wizard (2026-09-24 user ruling): prompt for the
        // SERVER ADDRESS (host:port), not an API key — probe it host-side
        // (browser→LAN is cross-origin), fetch the model list, then configure
        // the tintin-server provider and default model from the answer.
        void maybeShowSetupWizard()

        // P0-V3 probe: proves this client module executed inside the workbench
        // renderer and that same-origin host routing answers it.
        fetch('/tintin/ping')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then(
            (j) => console.info('[tintin] host ping ok', j),
            (e) => console.error('[tintin] host ping fail', e),
          )
      },
    }
  },
})

async function maybeShowSetupWizard() {
  // Provisioned 状态与预填地址读 TinTin 自有存储合并视图（0.1.7 起设置服务
  // 拒写宿主插件条目，describe 的 tintin-bundle 命名空间不再是权威源）；
  // Settings may still be loading when plugins activate; retry briefly.
  let value
  for (let i = 0; i < 10 && value === undefined; i++) {
    try {
      const res = await window.tintin?.config?.get?.()
      value = res?.value
    } catch { /* retry */ }
    if (value === undefined) await new Promise((r) => setTimeout(r, 1500))
  }
  if (!value || value?.server?.provisioned === true) return

  const el = document.createElement('div')
  el.id = 'tintin-setup-wizard'
  el.style.cssText = 'position:fixed;inset:0;z-index:13000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);'
  el.innerHTML = [
    '<div style="width:min(460px,92vw);padding:28px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,#1e1e20);color:var(--dsw-alias-label-primary,#e8e8e6);box-shadow:0 12px 40px rgba(0,0,0,.4);font-family:inherit">',
    '  <div style="font-size:20px;font-weight:700;margin-bottom:6px">欢迎使用 TinTin</div>',
    '  <div style="font-size:13px;color:var(--dsw-alias-label-tertiary,#8b8b88);margin-bottom:18px">配置 TinTin 服务端地址（AI 推理服务，含端口），将自动拉取可用模型。</div>',
    '  <input id="tintin-setup-url" style="width:100%;box-sizing:border-box;height:40px;padding:0 14px;font:inherit;font-size:14px;border:.5px solid var(--dsw-alias-border-l4,#555);border-radius:10px;background:var(--dsw-alias-bg-layer-3,transparent);color:inherit" placeholder="http://192.168.0.10:8000" />',
    '  <div id="tintin-setup-status" style="min-height:20px;margin-top:10px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#8b8b88)"></div>',
    '  <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">',
    '    <button id="tintin-setup-skip" style="appearance:none;font:inherit;font-size:13px;padding:8px 14px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l4,#555);background:transparent;color:var(--dsw-alias-label-secondary,#bbb);cursor:pointer">暂不配置</button>',
    '    <button id="tintin-setup-go" style="appearance:none;font:inherit;font-size:13px;font-weight:600;padding:8px 20px;border-radius:8px;border:0;background:var(--dsw-alias-label-primary,#4f7cff);color:#fff;cursor:pointer">测试并配置</button>',
    '  </div>',
    '</div>',
  ].join('')
  document.body.appendChild(el)
  const input = el.querySelector('#tintin-setup-url')
  const status = el.querySelector('#tintin-setup-status')
  const go = el.querySelector('#tintin-setup-go')
  const skip = el.querySelector('#tintin-setup-skip')
  // 字符串守卫：schemastery volatile 占位符若未被存储层剥净，不能进输入框
  const prefill = value?.server?.url
  input.value = typeof prefill === 'string' ? prefill : ''

  const setBusy = (busy, text, isError) => {
    go.disabled = busy
    go.textContent = busy ? '连接中…' : '测试并配置'
    status.textContent = text ?? ''
    status.style.color = isError ? '#f87171' : (text && text.includes('✓') ? '#4ade80' : 'var(--dsw-alias-label-tertiary,#8b8b88)')
  }
  const finish = async (url, models, preferred) => {
    // TinTin 自有段写自有存储（设置服务拒写宿主插件条目）；provider 与默认
    // 模型是 profile 层条目（llm-pi-ai / agent-default-model），设置服务可写，
    // 仍走 settings/mutate。
    await window.tintin?.config?.merge?.({ server: { url, provisioned: true } })
    await tintinClient.settingsRpc('settings/mutate', {
      ns: 'llm-pi-ai',
      ops: [{
        op: 'set', path: ['providers', 'tintin-server'], value: {
          displayName: 'TinTin', apiKeyEnv: 'TINTIN_SERVER_API_KEY', api: 'openai-completions',
          baseURL: `${url}/llm`, models: models.map((m) => ({ id: m.id, name: m.name })),
        },
      }],
    })
    await tintinClient.settingsRpc('settings/mutate', {
      ns: 'agent-default-model',
      ops: [{ op: 'set', path: [], value: { provider: 'tintin-server', model: preferred.id } }],
    })
  }

  skip.onclick = async () => {
    try { await window.tintin?.config?.merge?.({ server: { provisioned: true } }) } catch { /* keep default */ }
    el.remove()
  }
  go.onclick = async () => {
    const url = input.value.trim().replace(/\/+$/u, '')
    if (!/^https?:\/\/[^\s/]+/i.test(url)) { setBusy(false, '地址需形如 http://<主机>:<端口>', true); return }
    setBusy(true, `正在连接 ${url} …`)
    try {
      const r = await fetch('/tintin/setup/probe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? `HTTP ${String(r.status)}`)
      const { models, preferred } = j.result
      setBusy(true, `✓ 连接成功，发现 ${String(models.length)} 个模型，正在配置…`)
      await finish(url, models, preferred)
      status.textContent = `✓ 配置完成（默认模型 ${preferred.name}），即将刷新…`
      status.style.color = '#4ade80'
      setTimeout(() => location.reload(), 900)
    } catch (e) {
      setBusy(false, e instanceof Error ? e.message : String(e), true)
    }
  }
}
