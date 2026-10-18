// TinTin client bundle: the "按功能测试连接" panel injected under the model
// provider card on the settings page. Kept in its own package so the main
// client bundle stays inside its locked line baseline (iron rule 4). The
// package is mounted as a client plugin (profile row), so the factory returns
// the plugin object — a bare module would fail renderer boot.
window.__ModuleLoader__.load({
  id: 'dsh-tintin-client-ui',
  factory: () => {
    function installCapabilityTests() {
      const PROBES = [
        {
          name: 'LLM · 模型列表', ok: null, message: '未测试',
          run: async () => {
            const r = await window.tintin.server.llmModels()
            if (r && !('error' in r) && Array.isArray(r.models)) {
              return r.models.length ? { ok: true, message: `正常（${r.models.length} 个模型）` } : { ok: false, message: '服务端未提供' }
            }
            return { ok: false, message: '服务端离线' }
          },
        },
        {
          name: 'OCR · 文字识别', ok: null, message: '未测试',
          // 空请求必触发服务端参数校验 → 4xx 恰好证明端点存在且网络可达
          run: async () => {
            try {
              await window.tintin.server.post('/material/ocr', {})
              return { ok: true, message: '正常（端点可达）' }
            } catch (e) {
              if (/HTTP\s+4\d\d/.test(String(e?.message || e))) return { ok: true, message: '正常（端点可达）' }
              throw e
            }
          },
        },
        { name: '向量 · 图文检索', ok: null, message: '未测试', path: '/clip/health' },
        { name: 'TTS · 语音合成', ok: null, message: '未测试', path: '/indextts/health' },
        { name: 'ASR · 语音识别', ok: null, message: '未测试', path: '/whisper/health' },
      ]
      let panel = null
      const errText = (e) => String(e?.message || e).replace(/^.*Error:\s*/, '')
      const dotColor = (ok) => (ok === true ? '#4ade80' : ok === false ? '#f87171' : '#8a8a8a')
      const rowEls = new Map()

      async function runProbe(p) {
        const row = rowEls.get(p.name)
        const dot = row?.querySelector('[data-role=dot]')
        const msg = row?.querySelector('[data-role=msg]')
        if (dot) dot.style.background = '#eab308'
        if (msg) msg.textContent = '测试中…'
        try {
          let r2
          if (p.path) {
            const r = await window.tintin.server.get(p.path)
            if (r === null || r === undefined) r2 = { ok: false, message: '服务端离线' }
            else if (r && typeof r === 'object' && 'error' in r) r2 = { ok: false, message: String(r.error) }
            else r2 = { ok: true, message: '正常' }
          } else {
            r2 = await p.run()
          }
          p.ok = r2.ok
          p.message = r2.message
        } catch (e) { p.ok = false; p.message = errText(e) }
        if (dot) dot.style.background = dotColor(p.ok)
        if (msg) msg.textContent = p.message
      }

      function buildPanel() {
        panel = document.createElement('div')
        panel.id = 'tintin-capability-tests'
        panel.style.cssText = 'margin:10px 0 2px;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l4,#555);border-radius:10px;display:flex;flex-direction:column;gap:8px;'
        const head = document.createElement('div')
        head.style.cssText = 'display:flex;align-items:center;gap:10px;'
        const titleWrap = document.createElement('div')
        titleWrap.style.cssText = 'flex:1;min-width:0;'
        titleWrap.innerHTML = '<div style="font-size:13px;font-weight:600">按功能测试连接</div>' +
          '<div style="font-size:12px;opacity:.65">对各功能端点（openapi 实际路径）分发最小请求</div>'
        head.appendChild(titleWrap)
        const allBtn = document.createElement('button')
        allBtn.textContent = '全部测试'
        allBtn.style.cssText = 'appearance:none;font:inherit;font-size:12px;padding:4px 14px;cursor:pointer;border:0.5px solid var(--dsw-alias-border-l4,#555);border-radius:8px;background:var(--dsw-alias-bg-layer-3,transparent);color:inherit;'
        let testing = false
        allBtn.onclick = () => {
          if (testing) return
          testing = true
          allBtn.textContent = '测试中…'
          Promise.all(PROBES.map((p) => runProbe(p))).finally(() => { testing = false; allBtn.textContent = '全部测试' })
        }
        head.appendChild(allBtn)
        panel.appendChild(head)
        for (const p of PROBES) {
          const row = document.createElement('div')
          row.style.cssText = 'display:flex;align-items:center;gap:10px;'
          const dot = document.createElement('span')
          dot.setAttribute('data-role', 'dot')
          dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${dotColor(p.ok)};flex:none;`
          const info = document.createElement('div')
          info.style.cssText = 'flex:1;min-width:0;'
          info.innerHTML = `<div style="font-size:13px">${p.name}</div>` +
            `<div data-role="msg" style="font-size:12px;opacity:.65"></div>`
          info.querySelector('[data-role=msg]').textContent = p.message
          const btn = document.createElement('button')
          btn.textContent = '测试'
          btn.style.cssText = allBtn.style.cssText
          btn.onclick = () => { if (!testing) runProbe(p) }
          row.append(dot, info, btn)
          rowEls.set(p.name, row)
          panel.appendChild(row)
        }
        return panel
      }

      // 自愈注入：设置弹窗开合/切页/React 重渲染都会触发；节流到一帧粒度。
      let scheduled = false
      const observer = new MutationObserver(() => {
        if (scheduled) return
        scheduled = true
        setTimeout(() => {
          scheduled = false
          try { ensurePanel() } catch (_) { /* 注入失败等下一轮变更重试 */ }
        }, 200)
      })
      function ensurePanel() {
        // 锚点双文案：0.1.5 按钮「添加提供方」，0.1.7 改版为「添加模型提供商」
        // （2026-09-28 实机事故：单文案锚点在 0.1.7 下永失配，面板不再注入）。
        const anchor = [...document.querySelectorAll('button')]
          .find((b) => {
            const t = b.textContent?.trim() ?? ''
            return t === '添加提供方' || t.includes('添加模型提供商') || t === '添加提供商'
          })
        if (!anchor) return
        const row = anchor.parentElement
        const host = row?.parentElement
        if (!host) return
        if (host.querySelector('#tintin-capability-tests')) return
        if (!panel) buildPanel()
        host.insertBefore(panel, row)
      }
      observer.observe(document.body, { childList: true, subtree: true })
    }
    return {
      name: 'dsh-tintin-client-ui',
      apply() { installCapabilityTests() },
      installCapabilityTests,
    }
  },
})
