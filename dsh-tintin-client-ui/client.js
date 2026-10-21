// TinTin client bundle: the "按功能测试连接" panel injected under the model
// provider card on the settings page, and the embedded OpenFilm Studio view
// (registered with the chrome's view registry). Kept in its own package so the
// main client bundle stays inside its locked line baseline (iron rule 4). The
// package is mounted as a client plugin (profile row), so the factory returns
// the plugin object — a bare module would fail renderer boot.
window.__ModuleLoader__.load({
  id: 'dsh-tintin-client-ui',
  factory: () => {
    function installCapabilityTests() {
      const PROBES = [
        { name: 'LLM · 模型列表', ok: null, message: '未测试', run: async () => {
          const r = await window.tintin.server.llmModels()
          if (r && !('error' in r) && Array.isArray(r.models)) return r.models.length ? { ok: true, message: `正常（${r.models.length} 个模型）` } : { ok: false, message: '服务端未提供' }
          return { ok: false, message: '服务端离线' }
        } },
        // 空请求必触发服务端参数校验 → 4xx 恰好证明端点存在且网络可达
        { name: 'OCR · 文字识别', ok: null, message: '未测试', run: async () => {
          try { await window.tintin.server.post('/material/ocr', {}); return { ok: true, message: '正常（端点可达）' } } catch (e) {
            if (/HTTP\s+4\d\d/.test(String(e?.message || e))) return { ok: true, message: '正常（端点可达）' }
            throw e
          }
        } },
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
        const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:10px;'
        const titleWrap = document.createElement('div'); titleWrap.style.cssText = 'flex:1;min-width:0;'
        titleWrap.innerHTML = '<div style="font-size:13px;font-weight:600">按功能测试连接</div>' +
          '<div style="font-size:12px;opacity:.65">对各功能端点（openapi 实际路径）分发最小请求</div>'
        const allBtn = document.createElement('button'); allBtn.textContent = '全部测试'
        allBtn.style.cssText = 'appearance:none;font:inherit;font-size:12px;padding:4px 14px;cursor:pointer;border:0.5px solid var(--dsw-alias-border-l4,#555);border-radius:8px;background:var(--dsw-alias-bg-layer-3,transparent);color:inherit;'
        let testing = false
        allBtn.onclick = () => {
          if (testing) return
          testing = true; allBtn.textContent = '测试中…'
          Promise.all(PROBES.map((p) => runProbe(p))).finally(() => { testing = false; allBtn.textContent = '全部测试' })
        }
        head.append(titleWrap, allBtn); panel.appendChild(head)
        for (const p of PROBES) {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;gap:10px;'
          const dot = document.createElement('span'); dot.setAttribute('data-role', 'dot')
          dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${dotColor(p.ok)};flex:none;`
          const info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;'
          info.innerHTML = `<div style="font-size:13px">${p.name}</div>` +
            `<div data-role="msg" style="font-size:12px;opacity:.65"></div>`
          info.querySelector('[data-role=msg]').textContent = p.message
          const btn = document.createElement('button'); btn.textContent = '测试'; btn.style.cssText = allBtn.style.cssText
          btn.onclick = () => { if (!testing) runProbe(p) }
          row.append(dot, info, btn); rowEls.set(p.name, row); panel.appendChild(row)
        }
        return panel
      }

      // 自愈注入：设置弹窗开合/切页/React 重渲染都会触发；节流到一帧粒度。
      let scheduled = false
      const observer = new MutationObserver(() => {
        if (scheduled) return
        scheduled = true
        setTimeout(() => { scheduled = false; try { ensurePanel() } catch (_) { /* 注入失败等下一轮变更重试 */ } }, 200)
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
      // ── OpenFilm 壳（2026-10-18 用户裁决：内嵌 + 服务端编导会话）──────────
      // 左 Studio（iframe），右编导会话：按项目绑定一个 DSH 会话（cwd=影片目录，
      // 服务端默认模型与标准工具），映射存 localStorage；「新会话」另起一个。
      // 本包先于 tintin-host 装载，视图注册表可能未建立 → 短轮询等待。
      function injectOpenFilmCss() {
        if (document.getElementById('tintin-openfilm-css')) return
        const style = document.createElement('style')
        style.id = 'tintin-openfilm-css'
        style.textContent = [
          '.tintin-of-shell{position:absolute;inset:0;display:flex;background:#0b0c0f}.tintin-of-stage{position:relative;flex:1;min-width:0}.tintin-of-stage iframe{width:100%;height:100%;border:0;display:block;background:#0b0c0f}.tintin-of-note{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;white-space:pre-wrap;cursor:pointer;color:#9a9a9a;font:14px/1.6 system-ui;background:#0b0c0f}',
          '.tintin-of-chat{position:relative;width:420px;flex:none;display:flex;flex-direction:column;border-left:1px solid #202126;background:#0f1013;color:#e8e8e6;font:13px/1.55 system-ui;min-width:0}.tintin-of-top{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #1c1d21;min-height:38px}.tintin-of-top-session{flex:1;min-width:0;background:transparent;border:0;color:#c9c9cf;font:12px system-ui;outline:none;appearance:none}.tintin-of-top-session option{background:#16171a;color:#e8e8e6}.tintin-of-top-btn{width:26px;height:26px;border-radius:7px;border:1px solid #26272b;background:#15161a;color:#c9c9cf;cursor:pointer;font:13px system-ui;line-height:1;flex:none}',
          '.tintin-of-list{flex:1;min-height:0;overflow:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px}.tintin-of-empty2{margin:auto 0;padding:0 6px 20px;display:flex;flex-direction:column;gap:10px;max-width:360px}.tintin-of-mark{width:22px;height:28px;border-radius:3px;background:#e8e8e6;clip-path:polygon(0 0,100% 0,100% 70%,55% 70%,55% 100%,0 100%)}.tintin-of-h1{font-size:21px;font-weight:700;letter-spacing:.2px;margin-top:2px}.tintin-of-p{font-size:12px;color:#9a9aa0;margin-bottom:6px}',
          '.tintin-of-sugg-head{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#8a8a90;margin-top:4px}.tintin-of-sugg-head button{background:none;border:0;color:#8a8a90;font:11px system-ui;cursor:pointer}.tintin-of-sugg{display:flex;flex-direction:column;gap:7px}.tintin-of-sugg-card{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;border:1px solid #26272b;background:#16171a;color:#e2e2e6;font:13px/1.45 system-ui;text-align:left;cursor:pointer}.tintin-of-sugg-card:hover{background:#1b1c20}.tintin-of-sugg-card span:last-child{color:#6f7076;font-size:13px}',
          '.tintin-of-upload-hint{display:flex;align-items:center;gap:6px;margin-top:4px;padding:6px 2px;background:none;border:0;color:#8a8a90;font:11px system-ui;text-align:left;cursor:pointer}.tintin-of-upload-hint:hover{color:#b9b9c0}.tintin-of-msg{max-width:92%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-break:break-word}.tintin-of-msg.user{align-self:flex-end;background:#2b3a55;color:#f0f4fa}.tintin-of-msg.assistant{align-self:flex-start;background:#1a1b1f;border:1px solid #26272b}.tintin-of-live{opacity:.85}.tintin-of-running{align-self:flex-start;font-size:11px;color:#8a8a90}',
          '.tintin-of-tool{align-self:flex-start;max-width:96%;font-size:11px;color:#b9b9c0;background:#17181c;border:1px solid #26272b;border-radius:8px;padding:4px 8px}.tintin-of-tool summary{cursor:pointer;list-style:none;display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-tool summary::-webkit-details-marker{display:none}.tintin-of-tool pre{margin:6px 0 0;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.5 ui-monospace,monospace;color:#a9a9b2}.tintin-of-dot{width:6px;height:6px;border-radius:50%;flex:none}',
          '.tintin-of-approval{display:flex;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid #3a3a40;background:#1d1a12;color:#f0d9a8;font-size:12px}.tintin-of-approval-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-btn{appearance:none;font:inherit;font-size:11px;padding:3px 10px;border-radius:7px;border:1px solid #3a3a40;background:#1c1d21;color:#e8e8e6;cursor:pointer;white-space:nowrap}',
          '.tintin-of-composer{padding:10px 12px;border-top:1px solid #1c1d21}.tintin-of-inputwrap{display:flex;align-items:flex-end;gap:8px;background:#16171a;border:1px solid #2a2b31;border-radius:14px;padding:8px 8px 8px 12px}.tintin-of-input{flex:1;min-height:40px;max-height:140px;overflow-y:auto;background:transparent;border:0;color:#e8e8e6;font:13px/1.7 system-ui;outline:none;padding:0;white-space:pre-wrap;word-break:break-word}.tintin-of-input:empty::before{content:attr(data-placeholder);color:#6f727b;pointer-events:none}.tintin-of-pill{display:inline-flex;align-items:center;gap:4px;max-width:220px;vertical-align:-4px;margin:0 2px;padding:1px 5px 1px 3px;border:1px solid #2f3138;border-radius:8px;background:#1d1f24;color:#e8e8e6;font:12px/1.5 system-ui;user-select:none;cursor:pointer}.tintin-of-pill.is-lit{border-color:#3b6fd4;background:#20304d;box-shadow:0 0 0 1px #3b6fd4}.tintin-of-pill-icon{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;flex:none;background:#26282e}.tintin-of-pill-icon svg{width:12px;height:12px}.tintin-of-pill-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tintin-of-pill-detail{color:#8b8e96;font-variant-numeric:tabular-nums;flex:none}.tintin-of-pill-x{appearance:none;border:0;background:transparent;color:#6f727b;font:11px/1 system-ui;cursor:pointer;padding:0 0 0 2px}.tintin-of-pill-x:hover{color:#e8e8e6}.tintin-of-send{width:32px;height:32px;border-radius:50%;border:0;background:#3b6fd4;color:#fff;font-size:16px;line-height:1;cursor:pointer;flex:none}.tintin-of-stop{width:32px;height:32px;border-radius:50%;border:1px solid #7a3b3b;background:#2a1a1a;color:#f0b4b4;font-size:12px;cursor:pointer;flex:none}',
          '.tintin-of-bottom{display:flex;align-items:center;gap:8px;margin-top:8px}.tintin-of-chip{background:#1a1b1f;border:1px solid #2a2b31;border-radius:8px;color:#c9c9cf;font:11px system-ui;padding:3px 6px;max-width:150px;outline:none}.tintin-of-chip option{background:#16171a;color:#e8e8e6}.tintin-of-icon{width:26px;height:26px;border-radius:7px;border:1px solid #2a2b31;background:#1a1b1f;color:#c9c9cf;cursor:pointer;font:13px system-ui;line-height:1;flex:none}.tintin-of-spacer{flex:1}.tintin-of-status{padding:0 12px 8px;font-size:11px;color:#8a8a90;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.tintin-of-atmenu{position:absolute;left:12px;right:12px;bottom:104px;max-height:220px;overflow:auto;background:#1a1b1f;border:1px solid #2f3036;border-radius:10px;padding:4px;z-index:5;display:none}.tintin-of-atitem{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:none;font:11px/1.4 ui-monospace,monospace;color:#c9c9cf;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-atitem:hover{background:#24262b}.tintin-of-atgroup{padding:6px 8px 2px;font-size:10px;color:#6f7076}',
          '.tintin-of-atrow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:none;color:#c9c9cf;font:11px/1.4 system-ui;cursor:pointer}.tintin-of-atrow:hover{background:#24262b}.tintin-of-atrow.is-disabled{opacity:.45;cursor:default}.tintin-of-atrow.is-active{background:#24262b}.tintin-of-libmenu{position:fixed;z-index:70;background:#1a1b1f;border:1px solid #2f3036;border-radius:8px;padding:4px;min-width:170px;box-shadow:0 10px 28px rgba(0,0,0,.45)}.tintin-of-libmenu .tintin-of-atrow{font-size:12px}.tintin-of-libmenu .tintin-of-atrow-icon{color:#c9c9cf}.tintin-of-atrow-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:#26282e;flex:none}.tintin-of-atrow-icon svg{width:12px;height:12px}.tintin-of-atlabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tintin-of-atdetail{color:#77787e;font-size:10px;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}.tintin-of-provider{border:0;background:transparent;color:#e8e8e6;font-weight:600;padding-left:0}',
          '.tintin-of-assets{flex:1;min-height:0;display:none;flex-direction:column;background:#0f1013}.tintin-of-assets-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #1c1d21}.tintin-of-assets-search{flex:1;min-width:0;background:#16171a;border:1px solid #26272b;border-radius:8px;color:#e8e8e6;font:11px system-ui;padding:4px 8px;outline:none}.tintin-of-assets-body{flex:1;min-height:0;overflow:auto;padding:10px}.tintin-of-assets-all{font-size:11px;color:#8a8a90;padding:0 2px 8px}.tintin-of-assets-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
          '.tintin-of-asset{border:1px solid #26272b;background:#16171a;border-radius:9px;overflow:hidden;padding:0;color:#e2e2e6;font:11px system-ui;text-align:left;cursor:pointer}.tintin-of-asset:hover{border-color:#3b6fd4}.tintin-of-asset-thumb{position:relative;aspect-ratio:16/9;background:#0b0c0f;display:flex;align-items:center;justify-content:center;overflow:hidden}.tintin-of-asset-thumb img,.tintin-of-asset-thumb video{width:100%;height:100%;object-fit:cover;display:block}.tintin-of-asset-thumb img{-webkit-user-drag:none}.tintin-of-asset-badge{position:absolute;right:5px;bottom:5px;background:rgba(0,0,0,.65);border-radius:4px;padding:1px 4px;font-size:10px;color:#e8e8e6}.tintin-of-asset-name{padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-asset-empty{margin:auto;text-align:center;color:#8a8a90;font-size:12px;line-height:1.7}',
          '.tintin-of-skill-group{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;padding:10px 2px 0;border-top:1px solid #1c1d21;margin-top:2px;font-size:11px;color:#8a8a90}.tintin-of-skill-group.first{border-top:0;margin-top:0;padding-top:0}',
          '.tintin-of-skill-card{border:1px solid #26272b;background:#16171a;border-radius:9px;overflow:hidden;padding:0;color:#e2e2e6;font:11px system-ui;text-align:left;cursor:pointer}.tintin-of-skill-card:hover{border-color:#3b6fd4}.tintin-of-skill-cover{position:relative;aspect-ratio:16/9;background:#0b0c0f;display:flex;align-items:center;justify-content:center;overflow:hidden}.tintin-of-skill-cover img{width:100%;height:100%;object-fit:cover;display:block}.tintin-of-skill-name{padding:6px 8px 2px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-skill-desc{padding:0 8px 7px;color:#8a8a90;font-size:10px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
          '.tintin-of-skill-list{grid-column:1/-1;display:flex;flex-direction:column;gap:6px}.tintin-of-skill-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;border:1px solid #26272b;border-radius:9px;background:#16171a;color:#e2e2e6;font:11px system-ui;cursor:pointer}.tintin-of-skill-row:hover{border-color:#3b6fd4}.tintin-of-skill-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.tintin-of-skill-row-name{font-size:12px}.tintin-of-skill-row-desc{color:#8a8a90;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-skill-state{flex:none;font-size:10px;padding:2px 6px;border-radius:999px;border:1px solid #2a2b31;color:#b9b9c0}.tintin-of-skill-state.installed{border-color:#2f5a3a;color:#8fd6a4}',
          '.tintin-of-preview{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;z-index:60}.tintin-of-preview-box{max-width:82vw;background:#16171a;border:1px solid #2a2b31;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}.tintin-of-preview-bar{display:flex;gap:8px;align-items:center}.tintin-of-preview-name{flex:1;min-width:0;font-size:11px;color:#b9b9c0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-preview-media{max-width:78vw;max-height:70vh;display:block}',
          '.tintin-of-question{gap:6px}.tintin-of-question .tintin-of-btn.is-on{border-color:#3b6fd4;background:#20304d;color:#fff}.tintin-of-question div[style]>.tintin-of-btn{margin:2px 4px 0 0}.tintin-of-question input{margin-top:2px}',
          '.tintin-of-srctabs{display:flex;gap:4px;align-items:center}.tintin-of-srctab{border:1px solid #2a2b31;background:#1a1b1f;color:#c9c9cf;font:11px system-ui;padding:3px 8px;border-radius:7px;cursor:pointer}.tintin-of-srctab.is-on{background:#3b6fd4;border-color:#3b6fd4;color:#fff}.tintin-of-headcol{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}.tintin-of-headrow{display:flex;gap:6px;align-items:center}.tintin-of-athint{padding:4px 8px 2px;font-size:10px;color:#6f7076;display:flex;gap:10px}',
        ].join('\n')
        document.head.appendChild(style)
      }

      const openFilmText = (parts) => (Array.isArray(parts)
        ? parts.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('')
        : '')
      const openFilmArgPreview = (args) => {
        const text = String(args || '').replace(/\s+/g, ' ').trim()
        return text.length > 80 ? `${text.slice(0, 80)}…` : text
      }
      const openFilmRows = (binding) => {
        const rows = []
        const calls = new Map()
        for (const entry of binding.eventSource.getSnapshot().entries) {
          if (entry.type !== 'event') continue
          const event = entry.event
          if (event.type === 'user/message') {
            const text = openFilmText(event.data?.content)
            if (text) rows.push({ role: 'user', text })
          } else if (event.type === 'assistant/message') {
            const text = openFilmText(event.data?.message?.content)
            if (text) rows.push({ role: 'assistant', text })
          } else if (event.type === 'tool/call') {
            const callId = String(event.data?.callId || '')
            const row = { role: 'tool', callId, name: String(event.data?.name || 'tool'), args: String(event.data?.arguments || ''), status: 'running', result: '' }
            if (callId) calls.set(callId, row)
            rows.push(row)
          } else if (event.type === 'tool/result') {
            const callId = String(event.data?.message?.toolCallId || '')
            const row = calls.get(callId)
            const result = openFilmText(event.data?.message?.content)
            const failed = Boolean(event.data?.message?.isError || event.data?.error)
            if (row) {
              row.status = failed ? 'error' : 'done'
              row.result = event.data?.error?.reason ? `${result}
${event.data.error.reason}` : result
            } else {
              rows.push({ role: 'tool', name: 'tool', args: '', status: failed ? 'error' : 'done', result })
            }
          }
        }
        return rows
      }
      const openFilmShort = (path) => String(path || '').split(/[\\/]/).pop() || ''
      // 我们的"agent"= DSH 角色预设 × 服务端模型；这里只列预览成过的 TinTin 角色。
      const OPENFILM_ROLES = [
        { id: 'tintin-assistant', label: '总助手' }, // 默认角色（2026-10-19 用户裁决）
        { id: 'tintin-director', label: '编导' },
        { id: 'tintin-producer', label: '制作' },
        { id: 'tintin-qc', label: '质检' },
        { id: 'tintin-librarian', label: '素材库' },
      ]
      const OPENFILM_SUGGESTIONS = [
        ['为我的频道做一段 Logo 片头动画', '一个小狐狸寻找星星的动画睡前故事', '一支香水广告：红色花瓣，黄昏光线', '把这份销售数据做一段讲故事的动画图表', '一步步讲解这道物理题的解法'],
        ['做一支 30 秒的产品发布片', '用一段口播讲清楚一个概念，配卡点画面', '把现有素材剪成 9:16 竖屏短视频', '给一段影片加字幕、配音和背景音乐', '用代码动画做一张会动的数据海报'],
      ]
      function mountOpenFilm(el, ctx) {
        el.style.cssText = 'position:absolute;inset:0;'
        injectOpenFilmCss()
        const shell = document.createElement('div'); shell.className = 'tintin-of-shell'
        const stage = document.createElement('div'); stage.className = 'tintin-of-stage'
        const frame = document.createElement('iframe')
        frame.setAttribute('allow', 'clipboard-read; clipboard-write; fullscreen')
        const note = document.createElement('div'); note.className = 'tintin-of-note'
        stage.append(frame, note)
        const chat = document.createElement('aside'); chat.className = 'tintin-of-chat'

        const top = document.createElement('div'); top.className = 'tintin-of-top'
        const sessionSelect = document.createElement('select'); sessionSelect.className = 'tintin-of-top-session'
        const newBtn = document.createElement('button'); newBtn.className = 'tintin-of-top-btn'; newBtn.textContent = '+'; newBtn.title = '新会话'
        const syncBtn = document.createElement('button'); syncBtn.className = 'tintin-of-top-btn'; syncBtn.textContent = '⟳'; syncBtn.title = '同步 Studio 项目'
        top.append(sessionSelect, newBtn, syncBtn)

        const list = document.createElement('div'); list.className = 'tintin-of-list'

        const assetsPanel = document.createElement('div'); assetsPanel.className = 'tintin-of-assets'; assetsPanel.style.display = 'none'
        const assetsHead = document.createElement('div'); assetsHead.className = 'tintin-of-assets-head'
        const assetsSearch = document.createElement('input'); assetsSearch.className = 'tintin-of-assets-search'; assetsSearch.placeholder = '搜索'
        const assetsUpload = document.createElement('button'); assetsUpload.className = 'tintin-of-icon'; assetsUpload.textContent = '上传'; assetsUpload.style.width = 'auto'; assetsUpload.style.padding = '0 8px'
        const assetsClose = document.createElement('button'); assetsClose.className = 'tintin-of-icon'; assetsClose.textContent = '×'; assetsClose.title = '关闭面板'
        const assetsBody = document.createElement('div'); assetsBody.className = 'tintin-of-assets-body'; const assetsAll = document.createElement('div'); assetsAll.className = 'tintin-of-assets-all'; assetsAll.textContent = '全部'; const assetsGrid = document.createElement('div'); assetsGrid.className = 'tintin-of-assets-grid'
        // 在线素材库抽屉（2026-10-20 用户裁决：删「项目」页签——本地素材已由左侧
        // Studio 素材面板承载，抽屉只保留在线素材库；类型页签（视频/图片/音频）保留）
        const typeTabs = document.createElement('div'); typeTabs.className = 'tintin-of-srctabs'; typeTabs.style.display = 'none'
        const headCol = document.createElement('div'); headCol.className = 'tintin-of-headcol'
        const headRow1 = document.createElement('div'); headRow1.className = 'tintin-of-headrow'
        const headRow2 = document.createElement('div'); headRow2.className = 'tintin-of-headrow'
        headRow1.append(typeTabs); headRow2.append(assetsSearch, assetsUpload, assetsClose)
        headCol.append(headRow1, headRow2); assetsHead.append(headCol); assetsBody.append(assetsAll, assetsGrid); assetsPanel.append(assetsHead, assetsBody)

        const approvalBar = document.createElement('div'); approvalBar.className = 'tintin-of-approval'
        approvalBar.style.display = 'none'
        const approvalText = document.createElement('div'); approvalText.className = 'tintin-of-approval-text'
        const approvalAllow = document.createElement('button'); approvalAllow.className = 'tintin-of-btn'; approvalAllow.textContent = '允许一次'
        const approvalReject = document.createElement('button'); approvalReject.className = 'tintin-of-btn'; approvalReject.textContent = '拒绝'
        approvalBar.append(approvalText, approvalAllow, approvalReject)
        // ask_user_question 提问卡（编导卡在提问等待回答时的可交互面板，2026-10-19 报障：壳只渲染审批导致「编导正在工作」假象）
        const questionBar = document.createElement('div'); questionBar.className = 'tintin-of-approval tintin-of-question'; questionBar.style.display = 'none'; questionBar.style.flexDirection = 'column'; questionBar.style.alignItems = 'stretch'

        const composer = document.createElement('div'); composer.className = 'tintin-of-composer'
        const inputWrap = document.createElement('div'); inputWrap.className = 'tintin-of-inputwrap'
        // 引用 pill 组合器（2026-10-20 用户裁决：对齐官方桌面端——引用在输入框里是
        // 图标+标签+详情的 pill，不再是一行裸 token 文本）。发送模型不变：pill 序列化
        // 回 `@路径` / `[时间 …]` 等 token 文本，服务端解析无感。
        const input = document.createElement('div')
        input.className = 'tintin-of-input'
        input.contentEditable = 'true'
        input.spellcheck = false
        input.dataset.placeholder = '描述你的影片。输入 @ 可指向文件、某个时刻或当前选中的内容'
        const stopBtn = document.createElement('button'); stopBtn.className = 'tintin-of-stop'; stopBtn.textContent = '■'; stopBtn.title = '停止'
        stopBtn.style.display = 'none'
        const sendBtn = document.createElement('button'); sendBtn.className = 'tintin-of-send'; sendBtn.textContent = '↑'; sendBtn.title = '发送'
        inputWrap.append(input, stopBtn, sendBtn)
        const bottom = document.createElement('div'); bottom.className = 'tintin-of-bottom'
        const roleSelect = document.createElement('select'); roleSelect.className = 'tintin-of-chip'; roleSelect.title = '新会话角色'
        for (const role of OPENFILM_ROLES) {
          const option = document.createElement('option'); option.value = role.id; option.textContent = role.label
          roleSelect.append(option)
        }
        const modelSelect = document.createElement('select'); modelSelect.className = 'tintin-of-chip'; modelSelect.title = '模型'
        modelSelect.style.display = 'none'; modelSelect.style.maxWidth = '110px'
        const spacer = document.createElement('div'); spacer.className = 'tintin-of-spacer'
        const attachBtn = document.createElement('button'); attachBtn.className = 'tintin-of-icon'; attachBtn.textContent = '+'; attachBtn.title = '添加文件'
        const assetsBtn = document.createElement('button'); assetsBtn.className = 'tintin-of-icon'; assetsBtn.textContent = '☰'; assetsBtn.title = '素材列表'
        const skillsBtn = document.createElement('button'); skillsBtn.className = 'tintin-of-icon'; skillsBtn.textContent = '▦'; skillsBtn.title = '技能'
        const providerChip = document.createElement('span'); providerChip.className = 'tintin-of-chip tintin-of-provider'; providerChip.textContent = '服务端'; providerChip.title = 'TinTin 服务端（模型由服务端提供）'
        bottom.append(providerChip, roleSelect, modelSelect, spacer, skillsBtn, assetsBtn, attachBtn)
        const fileInput = document.createElement('input')
        fileInput.type = 'file'; fileInput.multiple = true; fileInput.style.display = 'none'
        composer.append(inputWrap, bottom, fileInput)
        const status = document.createElement('div'); status.className = 'tintin-of-status'
        const atMenu = document.createElement('div'); atMenu.className = 'tintin-of-atmenu'
        chat.append(top, assetsPanel, list, approvalBar, questionBar, composer, status, atMenu)
        shell.append(stage, chat)
        el.append(shell)
        // 系统字幕带（窗口顶条，titleBarOverlay）会吞掉原生 Studio 视图的顶栏点击（2026-10-19 裁决：编辑器
        // 不落到标题栏上）——只让本视图让出条高：壳顶内边距把舞台推到条下，聊天列顶部为纯背景；共享覆盖层
        // 保持整窗遮盖，其余自定义视图不露原生页头（页头条缺失时如测试页 body→0）。
        const stripEl = document.elementsFromPoint(Math.round(innerWidth / 2), 10).find((n) => !n.closest('#tintin-view-overlay'))
        const stripRect = stripEl ? stripEl.getBoundingClientRect() : null
        const stripH = stripRect && stripRect.height < 120 ? Math.max(0, Math.round(stripRect.bottom)) : 0
        // 舞台（原生视图）让出字幕带保顶栏可点；聊天列背景顶到最上、交互行仍在带下（2026-10-19 用户裁决：不留空白区）
        if (stripH) { stage.style.marginTop = stripH + 'px'; chat.style.paddingTop = stripH + 'px' }

        let project = ''
        let reference = null
        let binding = null
        let directory = null
        let suggestionBatch = 0
        let unsubscribes = []
        const atState = { project: '', files: [], pages: [] }; let atRows = []; let atIndex = 0
        const sessionKey = () => `tintin.openfilm.session:${project}`
        const roleKey = () => `tintin.openfilm.role:${project}`
        const applyRole = () => {
          const saved = project ? localStorage.getItem(roleKey()) : ''
          roleSelect.value = OPENFILM_ROLES.some((role) => role.id === saved) ? saved : OPENFILM_ROLES[0].id
        }
        applyRole()
        // 官方客户端契约：apply 的 ctx 是 Cordis 代理，直读未声明服务属性会抛
        // 「cannot get property … without inject」（2026-10-19 实机 CDP＝视图半死
        // 根因）——服务只能经 ctx.inject 解析后捕获使用；动态注入不受声明门限制
        // （官方 approval 在声明外 inject ["shortcuts"] 同款）。
        let sessionsSvc = null
        let uiSessionSvc = null
        let modelDirs = null
        let svcWired = false
        const wireServices = () => {
          if (svcWired || !sessionsSvc) return
          svcWired = true
          if (sessionsSvc.list?.subscribe) unsubscribes.push(sessionsSvc.list.subscribe(() => renderSessions()))
          if (uiSessionSvc?.sessionStatus?.subscribe) unsubscribes.push(uiSessionSvc.sessionStatus.subscribe(() => renderApproval()))
          void sessionsSvc.refresh?.()
          renderSessions()
          renderApproval()
        }
        let canInject = false
        try { canInject = typeof ctx?.inject === 'function' } catch { canInject = false }
        if (canInject) {
          try {
            ctx.inject(['sessions', 'uiSession'], (scope) => {
              sessionsSvc = scope.sessions ?? null; uiSessionSvc = scope.uiSession ?? null; wireServices()
            })
          } catch { /* 服务未就绪：动作时会提示「会话服务不可用」 */ }
          try {
            ctx.inject(['modelDirectories'], (scope) => {
              modelDirs = scope.modelDirectories ?? null
              if (binding) void loadModels()
            })
          } catch { modelDirs = null }
        } else {
          sessionsSvc = ctx?.sessions ?? null; uiSessionSvc = ctx?.uiSession ?? null; modelDirs = ctx?.modelDirectories ?? null
          wireServices()
        }
        const nativeView = window.dshDesktopOpenFilm
        let studioSelection = null
        const formatTime = (seconds) => {
          const total = Math.max(0, Number(seconds) || 0)
          const minutes = Math.floor(total / 60)
          const rest = total - minutes * 60
          return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
        }
        const refLabel = (ref) => String(ref?.label || ref?.id || ref?.path || ref?.kind || '引用')
        const refToken = (ref) => {
          if (!ref || typeof ref !== 'object') return ''
          switch (ref.kind) {
            case 'time': return `[时间 ${formatTime(ref.time)}]`
            case 'range': return `[范围 ${formatTime(ref.start)}–${formatTime(ref.end)}]`
            case 'clip': return `[片段 ${ref.label || ref.id || ''}]`
            case 'track': return `[轨道 ${Number(ref.track) + 1}]`
            case 'file': return `@${ref.path || ''}`
            default: return `[${refLabel(ref)}]`
          }
        }
        // ── pill 图标与配色（移植自 dsh-openfilm chat/src/components/prompt-editor/PromptPill.tsx
        //    的 PILL_ICON/PILL_TONE：lucide 线性图标 + 各 kind 主题色，SVG path 内联以离线使用）──
        const PILL_ICON_PATHS = {
          time: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
          range: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
          element: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>',
          track: '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="18" height="7" x="3" y="14" rx="1"/>',
          subtitle: '<path d="M3 5h18v14H3z" opacity="0"/><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" opacity="0"/><path d="M6 17c3 -.5 4.5 -1.5 4.5 -2.5C10.5 13.5 9.5 13 9 13c-1 0 -2 1 -2 2.5zM18 17c-3 -.5 -4.5 -1.5 -4.5 -2.5 0 -1 1 -1.5 1.5 -1.5 1 0 2 1 2 2.5z" opacity="0"/><path d="M10 11 6 19M14 19l4-14" opacity="0"/><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M7 15h4M7 11h2M13 15h4M15 11h2"/>',
          file: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
          clipMg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" opacity="0"/><path d="m21 15-5-5L5 21"/><path d="M12 3h.01M3 9h.01M21 9h.01M9 21h.01M15 21h.01M3 15h.01M3 21h.01"/>',
          clipVideo: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
          clipVoice: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
          clipSfx: '<path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3"/>',
          clipMusic: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
          clipCaption: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
        }
        const PILL_TONE = {
          time: '#d48a1f', range: '#d48a1f', element: '#0d99ff', region: '#0d99ff',
          track: '#7a8290', subtitle: '#7a8290', file: '',
          clipMg: '#8f7bf5', clipVideo: '#4fa3ff', clipVoice: '#e06c9f', clipSfx: '#4fbf9f', clipMusic: '#c9a23f', clipCaption: '#7a8290',
        }
        const pillSvg = (kind) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PILL_ICON_PATHS[kind] || PILL_ICON_PATHS.file}</svg>`
        // 视图骨架图标（同源 lucide 线形，移植自 dsh-openfilm——桌面版底栏/顶栏的图标面）
        const UI_ICON_PATHS = {
          plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
          refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
          send: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
          stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
          close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
          paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
          blocks: '<rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="3" y="8" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="20" rx="1"/>',
          assets: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
        }
        const uiSvg = (name, size = 15) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICON_PATHS[name] || ''}</svg>`
        // 顶栏/底栏按钮统一换 lucide 图标（对齐桌面版，替换文本字符 ☰ ▦ + ⟳ ↑ ■ ×）
        ;(() => {
          const flex = (button) => { button.style.display = 'inline-flex'; button.style.alignItems = 'center'; button.style.justifyContent = 'center'; button.style.padding = '0' }
          flex(newBtn); newBtn.innerHTML = uiSvg('plus')
          flex(syncBtn); syncBtn.innerHTML = uiSvg('refresh')
          flex(stopBtn); stopBtn.innerHTML = uiSvg('stop', 13)
          flex(sendBtn); sendBtn.innerHTML = uiSvg('send')
          flex(attachBtn); attachBtn.innerHTML = uiSvg('paperclip', 14)
          flex(assetsBtn); assetsBtn.innerHTML = uiSvg('assets', 14)
          flex(skillsBtn); skillsBtn.innerHTML = uiSvg('blocks', 14)
          flex(assetsClose); assetsClose.innerHTML = uiSvg('close', 13)
        })()
        const pillKindOf = (ref) => {
          const kind = String(ref?.kind || '')
          if (PILL_ICON_PATHS[kind]) return kind
          if (kind === 'clip') {
            const hit = String(ref?.clipKind || ref?.mediaKind || '').toLowerCase()
            if (hit.includes('music') || hit.includes('bgm')) return 'clipMusic'
            if (hit.includes('voice') || hit.includes('tts') || hit.includes('audio')) return 'clipVoice'
            if (hit.includes('sfx') || hit.includes('sound')) return 'clipSfx'
            if (hit.includes('caption') || hit.includes('subtitle') || hit.includes('vtt')) return 'clipCaption'
            if (hit.includes('mg') || hit.includes('page') || hit.includes('html')) return 'clipMg'
            return 'clipVideo'
          }
          if (kind === 'page' || kind === 'mg') return 'clipMg'
          return 'file'
        }
        const pillTextOf = (ref) => {
          const kind = pillKindOf(ref)
          if (kind === 'time') return { label: formatTime(ref.time), detail: '' }
          if (kind === 'range') return { label: `${formatTime(ref.start)}–${formatTime(ref.end)}`, detail: '' }
          return { label: refLabel(ref), detail: '' }
        }
        // token → 供恢复草稿时反解（发送侧 ref 对象可能已不在手上）
        const pillMetaOfToken = (token) => {
          let m = /^\[时间 ([^\]]+)\]$/.exec(token)
          if (m) return { kind: 'time', label: m[1], detail: '' }
          m = /^\[范围 ([^\]]+)\]$/.exec(token)
          if (m) return { kind: 'range', label: m[1], detail: '' }
          m = /^\[片段 ([^\]]+)\]$/.exec(token)
          if (m) return { kind: 'clipVideo', label: m[1], detail: '' }
          m = /^\[轨道 ([^\]]+)\]$/.exec(token)
          if (m) return { kind: 'track', label: `轨道 ${m[1]}`, detail: '' }
          if (token.startsWith('@')) {
            const path = token.slice(1)
            // 只有像路径的 @token 才 pill 化（含 / 或扩展名）：用户手打的 @someone 不受影响
            if (!/[./]/.test(path)) return null
            return { kind: 'file', label: path.split('/').pop() || path, detail: '' }
          }
          return null
        }
        const TOKEN_RE = /(\[[^\][]*\]|@[^\s]+)/g
        const composerRefs = new Map()
        const makePillNode = (token, readOnly = false) => {
          const ref = composerRefs.get(token)
          const meta = (ref && pillTextOf(ref)) || pillMetaOfToken(token) || { kind: 'file', label: token, detail: '' }
          const kind = ref ? pillKindOf(ref) : meta.kind
          const pill = document.createElement('span')
          pill.className = 'tintin-of-pill'
          pill.contentEditable = 'false'
          pill.dataset.token = token
          pill.title = '点击跳转到该引用'
          // 点击 = Studio 定位；悬停 = 高亮对应对象（对齐桌面端 canRevealPill/reveal）
          pill.onclick = (event) => { event.stopPropagation(); revealPillToken(token) }
          pill.onmouseenter = () => { const r = refFromToken(token); if (r && r.kind !== 'file') highlightPillRef(r) }
          pill.onmouseleave = () => highlightPillRef(null)
          const icon = document.createElement('span')
          icon.className = 'tintin-of-pill-icon'
          const tone = PILL_TONE[kind] || ''
          if (tone) icon.style.color = tone
          icon.innerHTML = pillSvg(kind)
          const label = document.createElement('span')
          label.className = 'tintin-of-pill-label'
          label.textContent = meta.label || token
          pill.append(icon, label)
          if (meta.detail) {
            const detail = document.createElement('span')
            detail.className = 'tintin-of-pill-detail'
            detail.textContent = meta.detail
            pill.append(detail)
          }
          if (!readOnly) {
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.className = 'tintin-of-pill-x'
            remove.textContent = '×'
            remove.title = '移除引用'
            remove.onmousedown = (event) => { event.preventDefault(); event.stopPropagation() }
            remove.onclick = (event) => { event.stopPropagation(); pill.remove(); fireComposerChange() }
            pill.append(remove)
          }
          return pill
        }
        // 消息气泡里的引用 pill（对齐桌面端：发送后句子看起来不变——引用仍是同一颗 pill）
        const renderPillText = (container, text) => {
          for (const part of String(text ?? '').split(TOKEN_RE)) {
            if (!part) continue
            if (/^(\[[^\][]*\]|@[^\s]+)$/.test(part) && (composerRefs.has(part) || pillMetaOfToken(part))) container.append(makePillNode(part, true))
            else container.append(document.createTextNode(part))
          }
        }
        // ── pill → Studio 通道（官方 StudioHost.onCommand 契约）──────────────
        // 点击 pill = 定位（seek/选中/开面板）；悬停 pill = 高亮对应对象；输入框里的
        // 引用变化 = draft-refs（Studio 在画面上标 ①②③）。走主进程转发进 Studio 视图。
        const studioCommand = (command) => { try { nativeView?.command?.(command) } catch { /* 视图未开或旧宿主 */ } }
        const parseTimeLabel = (label) => {
          const parts = String(label).split(':')
          const value = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0])
          return Number.isFinite(value) ? value : 0
        }
        const commandForRef = (ref) => {
          switch (ref?.kind) {
            case 'clip': return { type: 'select-clip', ...(ref.id ? { id: ref.id } : {}), ...(ref.loc ? { loc: ref.loc } : {}), seek: true }
            case 'time': return { type: 'seek', time: Number(ref.time) || 0 }
            case 'range': return { type: 'show-range', start: Number(ref.start) || 0, end: Number(ref.end) || 0 }
            case 'layer': case 'region': return Number.isFinite(Number(ref.time)) && ref.box ? { type: 'show-box', time: Number(ref.time), box: ref.box } : null
            case 'track': return { type: 'show-track', track: Number(ref.track) || 0 }
            case 'file': return ref.path ? { type: 'show-file', path: String(ref.path) } : null
            case 'subtitle': return { type: 'show-subtitle', start: Number(ref.start) || 0, end: Number(ref.end) || 0 }
            default: return null
          }
        }
        const refFromToken = (token) => {
          const known = composerRefs.get(token)
          if (known) return known
          const m = /^\[时间 ([^\]]+)\]$/.exec(token)
          if (m) return { kind: 'time', time: parseTimeLabel(m[1]) }
          const r = /^\[范围 ([^\]]+)\]$/.exec(token)
          if (r) { const [a, b] = String(r[1]).split('–'); return { kind: 'range', start: parseTimeLabel(a), end: parseTimeLabel(b) } }
          return null
        }
        const revealPillToken = (token) => {
          const ref = refFromToken(token)
          const command = ref && commandForRef(ref)
          if (command) { studioCommand(command); setStatus(`已在 Studio 定位 ${refLabel(ref)}`) }
        }
        let highlightTimer = 0
        const highlightPillRef = (ref) => {
          clearTimeout(highlightTimer)
          highlightTimer = setTimeout(() => studioCommand({ type: 'highlight', ref: ref ?? null }), 80)
        }
        let draftTimer = 0
        const updateDraftRefs = () => {
          clearTimeout(draftTimer)
          draftTimer = setTimeout(() => {
            const refs = []
            for (const node of input.querySelectorAll('[data-token]')) {
              const ref = composerRefs.get(String(node.dataset.token))
              if (ref && ref.kind !== 'file') refs.push(ref) // 文件引用不参与 Studio 编号（对齐桌面端）
            }
            studioCommand({ type: 'draft-refs', refs })
          }, 200)
        }
        // Studio 悬停回程：指针指到的对象点亮输入框/消息里指向同一对象的 pill
        nativeView?.onHover?.((ref) => {
          const keyOf = (r) => (r ? `${r.kind}:${r.id ?? r.label ?? r.path ?? r.time ?? ''}` : '')
          const key = keyOf(ref)
          for (const node of input.querySelectorAll('[data-token]')) {
            const pillRef = refFromToken(String(node.dataset.token))
            node.classList.toggle('is-lit', Boolean(key) && keyOf(pillRef) === key)
          }
        })

        const serializeComposer = () => {
          let text = ''
          const walk = (node) => {
            for (const child of node.childNodes) {
              if (child.nodeType === Node.TEXT_NODE) text += child.textContent
              else if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.dataset?.token !== undefined) text += child.dataset.token
                else if (child.tagName === 'BR') text += '\n'
                else walk(child)
              }
            }
          }
          walk(input)
          return text
        }
        const nodeLength = (child) => {
          if (child.nodeType === Node.TEXT_NODE) return child.textContent.length
          if (child.nodeType !== Node.ELEMENT_NODE) return 0
          if (child.dataset?.token !== undefined) return String(child.dataset.token).length
          if (child.tagName === 'BR') return 1
          return child.textContent.length
        }
        const caretOffsetIn = () => {
          const selection = window.getSelection()
          if (!selection || !selection.rangeCount || !input.contains(selection.anchorNode)) return serializeComposer().length
          const { endContainer, endOffset } = selection.getRangeAt(0)
          let offset = 0
          let done = false
          const walk = (node) => {
            if (done) return
            for (const child of node.childNodes) {
              if (done) return
              if (child === endContainer) { offset += endOffset; done = true; return }
              if (child.contains && child.contains(endContainer)) { walk(child); return }
              offset += nodeLength(child)
            }
          }
          walk(input)
          return done ? offset : serializeComposer().length
        }
        const composerSetValue = (text, caretAtEnd = true) => {
          input.replaceChildren()
          const parts = String(text ?? '').split(TOKEN_RE)
          for (const part of parts) {
            if (!part) continue
            if (TOKEN_RE.test(part) && /^(\[[^\][]*\]|@[^\s]+)$/.test(part) && (pillMetaOfToken(part) || composerRefs.has(part))) input.append(makePillNode(part))
            else input.append(document.createTextNode(part))
            TOKEN_RE.lastIndex = 0
          }
          if (caretAtEnd) {
            const range = document.createRange()
            range.selectNodeContents(input)
            range.collapse(false)
            const selection = window.getSelection()
            selection?.removeAllRanges(); selection?.addRange(range)
          }
          updateDraftRefs()
        }
        const composerInsert = (text) => {
          const before = serializeComposer()
          const offset = caretOffsetIn()
          const next = before.slice(0, offset) + text + before.slice(offset)
          composerSetValue(next)
          const at = offset + text.length
          setComposerCaret(at)
        }
        const setComposerCaret = (target) => {
          const fallback = () => {
            const range = document.createRange()
            range.selectNodeContents(input)
            range.collapse(false)
            window.getSelection()?.removeAllRanges()
            window.getSelection()?.addRange(range)
          }
          let walked = 0
          let host = null
          let hostOffset = 0
          const visit = (node) => {
            for (const child of node.childNodes) {
              const len = nodeLength(child)
              if (walked + len >= target) {
                if (child.nodeType === Node.TEXT_NODE) { host = child; hostOffset = target - walked }
                else { host = node; hostOffset = Array.prototype.indexOf.call(node.childNodes, child) + (target > walked ? 1 : 0) }
                return true
              }
              walked += len
            }
            return false
          }
          if (!visit(input) || !host) { fallback(); return }
          try {
            const range = document.createRange()
            range.setStart(host, Math.min(hostOffset, host.nodeType === Node.TEXT_NODE ? host.textContent.length : host.childNodes.length))
            range.collapse(true)
            window.getSelection()?.removeAllRanges()
            window.getSelection()?.addRange(range)
          } catch { fallback() }
        }
        let composerChangeHandler = null
        const fireComposerChange = () => { try { composerChangeHandler?.() } catch { /* 监听器异常不阻断输入 */ } updateDraftRefs() }
        input.addEventListener('input', fireComposerChange)
        input.addEventListener('paste', (event) => {
          // 粘贴图片/文件 = 走导入通道成为引用（对齐桌面端 composer-attachments，2026-10-21 第三批）
          const imageFiles = [...(event.clipboardData?.items || [])]
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFile())
            .filter(Boolean)
          if (imageFiles.length) { event.preventDefault(); void importFiles(imageFiles); return }
          const text = String(event.clipboardData?.getData('text/plain') || '')
          if (text) { event.preventDefault(); composerInsert(text) }
        })
        // 文件拖进组合器同样成为引用（与粘贴同通道）
        input.addEventListener('dragover', (event) => {
          if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file')) event.preventDefault()
        })
        input.addEventListener('drop', (event) => {
          const files = [...(event.dataTransfer?.files || [])]
          if (!files.length) return
          event.preventDefault()
          void importFiles(files)
        })
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Backspace') return
          const selection = window.getSelection()
          if (!selection || !selection.rangeCount || !selection.isCollapsed) return
          // 光标紧跟 pill 右缘时整颗删除（对齐桌面端：pill 是一个不可拆的词元）
          const value = serializeComposer()
          const caret = caretOffsetIn()
          if (!caret) return
          for (const match of value.matchAll(TOKEN_RE)) {
            if (match.index === undefined) continue
            if (match.index + match[0].length !== caret) continue
            if (!composerRefs.has(match[0]) && !pillMetaOfToken(match[0])) continue
            const pill = input.querySelector(`[data-token="${CSS.escape(match[0])}"]`)
            if (pill) { pill.remove(); event.preventDefault(); fireComposerChange() }
            return
          }
        })
        // 输入框 value 门面：读写都是 token 文本（pills 只是显示形态），发送/草稿链路零改动
        let composerValue = ''
        Object.defineProperty(input, 'value', {
          configurable: true,
          get() { composerValue = serializeComposer(); return composerValue },
          set(text) { composerValue = String(text ?? ''); composerSetValue(composerValue) },
        })
        const insertReference = (ref) => {
          const token = refToken(ref)
          if (!token) return
          composerRefs.set(token, ref)
          composerInsert(`${token} `)
          input.focus()
          setStatus(`已引用 ${refLabel(ref)}`)
        }
        const nativeOverlayOpen = () => Array.from(document.body.children).some((element) => {
          const style = getComputedStyle(element)
          return style.position === 'fixed' && style.zIndex === '1000'
        })
        let nativeShown = false
        let lastBounds = ''
        async function syncBounds() {
          if (!nativeView?.show) return
          const rect = stage.getBoundingClientRect()
          if (rect.width < 8 || rect.height < 8 || nativeOverlayOpen()) {
            if (nativeShown) { nativeShown = false; lastBounds = ''; await nativeView.hide() }
            return
          }
          nativeShown = true
          // bounds 去重（2026-10-21 报障：每 800ms/每次 DOM 变更都无条件 show → 主进程
          // 反复 setBounds，合成器不断重排原生视图，播放时播放条抖动）。四值不变不发包。
          const next = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
          if (next === lastBounds) return
          lastBounds = next
          await nativeView.show({
            x: Math.round(rect.left), y: Math.round(rect.top),
            width: Math.round(rect.width), height: Math.round(rect.height),
          })
        }
        const watchNativeView = () => {
          if (!nativeView?.show) return
          try { new ResizeObserver(() => { void syncBounds() }).observe(stage) } catch { /* no observer */ }
          try { new MutationObserver(() => { void syncBounds() }).observe(document.body, { childList: true }) } catch { /* no observer */ }
          window.addEventListener('resize', () => { void syncBounds() })
          setInterval(() => { void syncBounds() }, 800)
          void syncBounds()
        }
        nativeView?.onSelection?.((selection) => {
          studioSelection = selection
          if (atMenu.style.display === 'block') void refreshAtMenu()
        })
        nativeView?.onRefer?.((ref) => { insertReference(ref) })
        watchNativeView()


        const setNote = (text) => { note.textContent = text || ''; note.style.display = text ? 'flex' : 'none' }
        const setStatus = (text) => {
          status.textContent = text || ''
          // 空状态不占位（2026-10-20 报障：会话列底部常驻 16px 空状态条被看成「没铺满」的空隙）
          status.style.display = text ? 'block' : 'none'
        }
        const release = () => {
          for (const off of unsubscribes.splice(0)) { try { off() } catch { /* stale */ } }
          try { reference?.release?.() } catch { /* already released */ }
          reference = null
          binding = null
          directory = null
          modelSelect.style.display = 'none'
          delete modelSelect.dataset.signature
        }

        const ofIpc = async (channel, payload) => {
          const response = await fetch(`/tintin/ipc/${channel}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: [payload] }),
          })
          const body = await response.json().catch(() => ({}))
          const result = body?.result ?? {}
          if (!response.ok || result?.error) throw new Error(result?.error || body?.error || `HTTP ${response.status}`)
          return result
        }
        const filePathOf = (file) => {
          try {
            // 桥名以桌面壳 preload 实际暴露为准（verify-bridge-surface 把关）：
            // 现行上游契约 __DSH_HOST_PATHS__.pathFor；旧名为降级兜底。
            return window.__DSH_HOST_PATHS__?.pathFor?.(file)
              || window.dshDesktopFilePath?.forFile?.(file)
              || window.__DSH_DESKTOP_FILE_PATH__?.getPathForFile?.(file)
              || file?.path
              || ''
          } catch { return '' }
        }
        const readBase64 = (file) => new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
          reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
          reader.readAsDataURL(file)
        })
        const insertAtCursor = (text) => {
          composerInsert(String(text ?? ''))
          input.focus()
        }
        const pickFiles = () => { if (!project) { setStatus('先在 Studio 打开一部影片'); return } fileInput.click() }
        async function importFiles(files) {
          if (!files.length) return
          if (!project) { setStatus('先在 Studio 打开一部影片'); return }
          for (const file of files.slice(0, 12)) {
            try {
              const payload = { project, name: file.name }
              const path = filePathOf(file)
              if (path) payload.sourcePath = path
              else {
                if (file.size > 40 * 1024 * 1024) throw new Error(`${file.name} 超过 40MB`)
                payload.base64 = await readBase64(file)
              }
              const result = await ofIpc('openfilm:importFile', payload)
              insertAtCursor('@' + result.path + ' ')
              setStatus(`已导入 ${result.path}`)
            } catch (error) { setStatus(`导入失败：${error?.message || error}`) }
          }
        }
        fileInput.addEventListener('change', () => {
          const files = Array.from(fileInput.files || [])
          fileInput.value = ''
          void importFiles(files)
        })

        function currentAtToken() {
          const text = serializeComposer()
          const position = caretOffsetIn()
          const before = text.slice(0, position)
          const match = before.match(/(?:^|\s)@([^\s@]*)$/)
          if (!match) return null
          const query = match[1] || ''
          return { query, start: position - query.length - 1, end: position }
        }
        // `/` 触发（对齐桌面版 matchSlashTrigger）：仅消息最开头的 `/` 是技能调用
        function currentSlashToken() {
          const text = serializeComposer()
          const position = caretOffsetIn()
          const before = text.slice(0, position)
          const match = /^\s*\/([^\s/]{0,40})$/.exec(before)
          if (!match) return null
          const query = match[1] || ''
          return { query, start: before.length - query.length - 1, end: position }
        }
        const hideAtMenu = () => { atMenu.style.display = 'none' }
        async function ensureProjectFiles() {
          if (!project) return []
          if (atState.project === project && atState.files.length) return atState.files
          try {
            const result = await ofIpc('openfilm:projectFiles', { project })
            atState.project = project
            atState.files = Array.isArray(result.files) ? result.files.filter((file) => file && typeof file.path === 'string') : []; atState.pages = Array.isArray(result.pages) ? result.pages : []
            return atState.files
          } catch { return [] }
        }
        function insertAtPath(path, token) {
          const value = serializeComposer()
          const next = value.slice(0, token.start) + '@' + path + ' ' + value.slice(token.end)
          composerSetValue(next)
          input.focus()
          setComposerCaret(token.start + path.length + 2)
          hideAtMenu()
        }
        const formatSize = (bytes) => {
          const value = Number(bytes) || 0
          if (value < 1024) return `${value} B`
          if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
          return `${(value / (1024 * 1024)).toFixed(1)} MB`
        }
        async function refreshAtMenu() {
          // `/` 技能菜单（2026-10-21 用户报障：桌面版输入 / 可列出技能，集成版缺这个）
          const slash = currentSlashToken()
          if (slash) {
            // 技能未就绪时先加载，完成后若 / 仍在触发态则重跑一次刷新（否则菜单停在「加载中…」）
            if (!skillsLoaded) {
              void loadSkills().then(() => { if (currentSlashToken()) void refreshAtMenu() })
            }
            const needle = slash.query.toLowerCase()
            const hit = (text) => !needle || String(text).toLowerCase().includes(needle)
            const entries = []
            for (const skill of [...skillsData.native, ...skillsData.server]) {
              const kind = skillsData.native.includes(skill) ? 'native' : 'server'
              const name = String(skill.name || '')
              const description = String(skill.description || '')
              if (!name || (!hit(name) && !hit(description))) continue
              const needsInstall = kind === 'server' && !skill.installed && Boolean(skill.id)
              entries.push({
                uiIcon: 'blocks',
                label: name,
                detail: `${description}${needsInstall ? '（回车安装并使用）' : ''}`,
                fire: async () => {
                  hideAtMenu()
                  if (needsInstall) {
                    setStatus(`正在安装「${name}」…`)
                    try {
                      const result = await ofIpc('skills:install', skill.id)
                      if (result?.error) throw new Error(result.error)
                      skill.installed = true
                    } catch (error) { setStatus(`技能安装失败：${error?.message || error}`); return }
                  }
                  const lead = kind === 'native'
                    ? `请使用 OpenFilm 的「${name}」技能（openfilm skill ${skill.id}）：\n`
                    : `请使用「${name}」技能：\n`
                  const value = serializeComposer()
                  composerSetValue(value.slice(0, slash.start) + lead + value.slice(slash.end))
                  input.focus()
                  setComposerCaret(slash.start + lead.length)
                  setStatus(`已插入技能：${name}`)
                },
              })
            }
            const nodes = []; atRows = []; atIndex = 0
            const head = document.createElement('div'); head.className = 'tintin-of-atgroup'; head.textContent = '技能'
            nodes.push(head)
            if (!entries.length) {
              const empty = document.createElement('div'); empty.className = 'tintin-of-atrow is-disabled'
              empty.textContent = skillsLoaded ? '没有匹配的技能' : '技能加载中…'
              nodes.push(empty)
            }
            for (const item of entries.slice(0, 12)) {
              const row = document.createElement('button'); row.type = 'button'; row.className = 'tintin-of-atrow'
              const iconBox = document.createElement('span'); iconBox.className = 'tintin-of-atrow-icon'
              iconBox.innerHTML = uiSvg(item.uiIcon, 12)
              const label = document.createElement('span'); label.className = 'tintin-of-atlabel'; label.textContent = item.label
              const detail = document.createElement('span'); detail.className = 'tintin-of-atdetail'; detail.style.maxWidth = '240px'; detail.textContent = item.detail || ''
              row.append(iconBox, label, detail)
              const entryRow = { el: row, fire: item.fire }
              row.onmousedown = (event) => { event.preventDefault(); item.fire() }
              row.onmouseenter = () => { atIndex = atRows.indexOf(entryRow); atRows.forEach((r, i) => r.el.classList.toggle('is-active', i === atIndex)) }
              atRows.push(entryRow)
              nodes.push(row)
            }
            if (atRows[atIndex]) atRows[atIndex].el.classList.add('is-active')
            const hint = document.createElement('div'); hint.className = 'tintin-of-athint'; hint.textContent = '↑↓ 选择 · Enter 插入技能 · Esc 关闭'; nodes.push(hint)
            atMenu.replaceChildren(...nodes)
            atMenu.style.display = 'block'
            return
          }
          const token = currentAtToken()
          if (!token) { hideAtMenu(); return }
          const files = project ? await ensureProjectFiles() : []
          const needle = token.query.toLowerCase()
          const hit = (text) => !needle || String(text).toLowerCase().includes(needle)
          const selection = studioSelection
          const selectedRefs = Array.isArray(selection?.refs) ? selection.refs : []
          const moments = []
          if (Number.isFinite(Number(selection?.time))) moments.push({ icon: 'time', label: '当前时间', detail: formatTime(selection.time), text: `[时间 ${formatTime(selection.time)}] ` })
          else moments.push({ icon: 'time', label: '当前时间', detail: '等待 Studio 选择', disabled: true })
          if (selectedRefs.length) moments.push({ icon: 'element', label: '当前选中', detail: `${refLabel(selectedRefs[0])}${selectedRefs.length > 1 ? ` +${selectedRefs.length - 1}` : ''}`, text: `${selectedRefs.map(refToken).join(' ')} ` })
          else moments.push({ icon: 'element', label: '当前选中', detail: '请先在画面或时间轴上选中内容', disabled: true })
          const range = selection?.range
          if (range && Number(range.end) > Number(range.start)) moments.push({ icon: 'range', label: '当前范围', detail: `${formatTime(range.start)}–${formatTime(range.end)}`, text: `[范围 ${formatTime(range.start)}–${formatTime(range.end)}] ` })
          const visibleMoments = moments.filter((item) => hit(item.label) || hit(item.detail))
          const groups = []
          if (hit('时刻') || visibleMoments.length) groups.push({ label: '时刻', items: visibleMoments })
          const mediaHits = files.filter((file) => mediaKind(file.path) && hit(file.path)).slice(0, 8).map((file) => ({ icon: 'file', label: String(file.path).split('/').pop() || file.path, detail: formatSize(file.size), path: file.path }))
          const pageHits = atState.pages.filter((page) => hit(page.path)).slice(0, 8).map((page) => ({ icon: 'clipMg', label: String(page.path).replace(/\.html?$/i, ''), detail: formatSize(page.size), path: page.path }))
          if (hit('素材') || mediaHits.length || pageHits.length) groups.push({ label: '素材', items: [...mediaHits, ...pageHits] })
          if (!groups.length) { hideAtMenu(); return }
          const nodes = []; atRows = []; atIndex = 0
          for (const group of groups) {
            const head = document.createElement('div'); head.className = 'tintin-of-atgroup'; head.textContent = group.label
            nodes.push(head)
            for (const item of group.items) {
              const row = document.createElement('button'); row.type = 'button'; row.className = 'tintin-of-atrow'
              if (item.disabled) row.classList.add('is-disabled')
              const iconBox = document.createElement('span'); iconBox.className = 'tintin-of-atrow-icon'
              if (item.icon && PILL_TONE[item.icon]) iconBox.style.color = PILL_TONE[item.icon]
              iconBox.innerHTML = pillSvg(item.icon || 'file')
              const label = document.createElement('span'); label.className = 'tintin-of-atlabel'; label.textContent = item.label
              const detail = document.createElement('span'); detail.className = 'tintin-of-atdetail'; detail.textContent = item.detail || ''
              row.append(iconBox, label, detail)
              // 键盘导航（对齐官方 ↑↓/Enter/Esc）：可选中行入 atRows，高亮位=Enter 落点
              const fire = item.disabled ? null : item.path ? () => insertAtPath(String(item.path), token) : item.text ? () => { insertAtCursor(String(item.text)); hideAtMenu() } : null
              if (fire) {
                const entryRow = { el: row, fire }
                row.onmousedown = (event) => { event.preventDefault(); fire() }
                row.onmouseenter = () => { atIndex = atRows.indexOf(entryRow); atRows.forEach((r, i) => r.el.classList.toggle('is-active', i === atIndex)) }
                atRows.push(entryRow)
              }
              nodes.push(row)
            }
          }
          if (atRows[atIndex]) atRows[atIndex].el.classList.add('is-active')
          const hint = document.createElement('div'); hint.className = 'tintin-of-athint'; hint.textContent = '↑↓ 选择 · Enter 插入 · Esc 关闭'; nodes.push(hint)
          atMenu.replaceChildren(...nodes)
          atMenu.style.display = 'block'
        }

        const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
        const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm'])
        const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac'])
        let assetsOpen = false; let assetsQuery = ''; let panelMode = 'assets'
        let libTab = 'video'; let libItems = []; let libLoaded = false; let libServer = ''; let libBusy = false; let syncBusy = false
        // 服务端分页（2026-10-20 用户报障：素材库只有第一页、搜索只搜了一页）：
        // 滚动近底加载下一页；搜索词变化防抖后回第 1 页重新向服务端查
        const LIB_PAGE_SIZE = 60
        let libPage = 1; let libExhausted = false; let libSearchTimer = 0
        for (const t of [['video', '视频'], ['image', '图片'], ['audio', '音频']]) {
          const b = document.createElement('button'); b.className = 'tintin-of-srctab' + (t[0] === 'video' ? ' is-on' : ''); b.textContent = t[1]
          b.onclick = () => { libTab = t[0]; [...typeTabs.children].forEach((x) => x.classList.toggle('is-on', x === b)); libLoaded = false; libPage = 1; libExhausted = false; if (assetsOpen && panelMode === 'assets') void loadLibrary() }
          typeTabs.append(b)
        }
        let skillsLoaded = false; let skillsData = { native: [], server: [] }
        const mediaKind = (path) => {
          const ext = ((String(path).match(/\.[^.]+$/) || [''])[0] || '').toLowerCase()
          return IMAGE_EXT.has(ext) ? 'image' : VIDEO_EXT.has(ext) ? 'video' : AUDIO_EXT.has(ext) ? 'audio' : ''
        }
        const mediaSrc = (item) => `/tintin/media?path=${encodeURIComponent(item.abs)}`
        const formatDuration = (seconds) => {
          const total = Math.max(0, Number(seconds) || 0)
          return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`
        }
        // 「项目」源已删（2026-10-20 用户裁决）：本地素材由左侧 Studio 素材面板承载，
        // 抽屉只保留在线素材库；项目源的 loadMedia/renderAssets/openPreview 已一并移除。
        // ── 在线素材库（2026-10-19 用户裁决：媒体工具素材库移植；点击=下载落项目 assets/download + 插入 @）──
        async function ensureLibServer() {
          if (libServer) return libServer
          try { const ping = await window.tintin?.env?.serverPing?.(); libServer = String(ping?.url || '').replace(/\/+$/, '') } catch { libServer = '' }
          return libServer
        }
        async function loadLibrary(append = false) {
          if (libBusy) return
          if (append && libExhausted) return
          libBusy = true
          if (!append) { libPage = 1; libExhausted = false; assetsAll.textContent = '素材库加载中…'; assetsGrid.replaceChildren() }
          libServer = await ensureLibServer()
          try {
            const q = { page: libPage, size: LIB_PAGE_SIZE, media_type: libTab }
            if (assetsQuery.trim()) q.search = assetsQuery.trim()
            const res = await window.tintin.server.get('/material/list', q)
            const data = res && typeof res === 'object' ? (res.data ?? res) : {}
            const items = Array.isArray(data.items) ? data.items : Array.isArray(data.list) ? data.list : []
            libExhausted = items.length < LIB_PAGE_SIZE
            libItems = append ? [...libItems, ...items] : items
            libLoaded = true
            libPage += 1 // 成功才前进：失败/空页留在当前页可重试
            if (assetsOpen && panelMode === 'assets') {
              renderLibrary()
              assetsAll.textContent = `全部（${libItems.length}）${libExhausted ? '' : ' · 下滑加载更多'}`
            }
          } catch (error) { if (!append) assetsAll.textContent = `素材库加载失败：${error?.message || error}` }
          libBusy = false
        }
        function libIdOf(item) { return String(item.material_id ?? item.id ?? '').trim() }
        function libNameOf(item) { return String(item.filename || item.name || (libIdOf(item) ? `material-${libIdOf(item)}` : '未命名素材')) }
        function libExtOf() { return libTab === 'video' ? '.mp4' : libTab === 'audio' ? '.mp3' : '.jpg' }
        function libFileOf(item) {
          const id = libIdOf(item)
          const stem = libNameOf(item).replace(/[/:*?"<>|]/g, '-').slice(0, 80) || `material-${id}`
          return /\.[a-z0-9]+$/i.test(stem) ? stem : stem + libExtOf()
        }
        function libServeUrlOf(item) {
          return `${libServer}/material/serve?material_id=${encodeURIComponent(libIdOf(item))}`
        }
        function renderLibrary() {
          const needle = assetsQuery.trim().toLowerCase()
          const items = libItems.filter((item) => !needle || libNameOf(item).toLowerCase().includes(needle) || libIdOf(item).includes(needle))
          assetsAll.textContent = `全部（${items.length}）`
          if (!items.length) {
            const empty = document.createElement('div'); empty.className = 'tintin-of-asset-empty'; empty.style.gridColumn = '1/-1'
            empty.textContent = libServer ? '没有匹配的素材。' : '素材库不可用：服务端未连通。'
            assetsGrid.replaceChildren(empty)
            return
          }
          assetsGrid.replaceChildren(...items.map((item) => {
            const id = libIdOf(item)
            const card = document.createElement('button'); card.type = 'button'; card.className = 'tintin-of-asset'; card.title = libNameOf(item)
            const thumb = document.createElement('div'); thumb.className = 'tintin-of-asset-thumb'
            if (id && libServer) {
              const img = document.createElement('img'); img.src = `${libServer}/material/thumbnail?material_id=${encodeURIComponent(id)}`
              img.onerror = () => { img.remove() }
              img.draggable = false // 封面不参与拖拽：默认图片拖拽会把缩略图当成素材（thumbnail.jpg 事故，2026-10-20）
              thumb.append(img)
            } else { const icon = document.createElement('span'); icon.textContent = '▤'; icon.style.fontSize = '22px'; icon.style.color = '#4a4b52'; thumb.append(icon) }
            const name = document.createElement('div'); name.className = 'tintin-of-asset-name'; name.textContent = libNameOf(item)
            card.append(thumb, name); card.onclick = () => { showLibPreview(item) }
            // 真拖拽体验 + 拖动即下载（2026-10-21 用户裁决：只有拖动和右键两种下载方式，
            // 左键=预览）。卡片可拖、拖影跟随、光标 copy；拖动开始的同时后台把原素材
            // 下载进项目——交付由下载完成（文件落地后左侧 Studio 面板自动出现）。
            if (id && libServer) {
              card.draggable = true
              card.addEventListener('dragstart', (event) => {
                const transfer = event.dataTransfer
                transfer.effectAllowed = 'copy'
                transfer.setData('text/plain', libFileOf(item))
                transfer.setData('text/uri-list', libServeUrlOf(item))
                void downloadLibraryItem(item)
                  .then((rel) => setStatus(`已下载到项目 ${rel}（左侧素材面板可用）`))
                  .catch((error) => setStatus(`素材下载失败：${error?.message || error}`))
              })
            }
            card.oncontextmenu = (event) => {
              event.preventDefault()
              event.stopPropagation() // 否则冒泡到 window 的关闭监听会把刚弹出的菜单立刻关掉
              showLibContextMenu(event.clientX, event.clientY, item)
            }
            return card
          }))
        }
        // 下载素材到本项目（assets/download/）；拖拽与右键/点击共用这条交付通道
        async function downloadLibraryItem(item) {
          if (!project) throw new Error('先在 Studio 打开一部影片')
          const id = libIdOf(item)
          if (!id) throw new Error('素材缺少 id')
          const file = libFileOf(item)
          const rel = `assets/download/${file}`
          const sep = String.fromCharCode(92)
          const saved = await window.tintin.server.downloadResult(`/material/serve?material_id=${encodeURIComponent(id)}`, `${project.replace(/[/]+$/, '')}${sep}assets${sep}download${sep}${file}`)
          if (!saved || saved.error) throw new Error(saved?.error || '下载失败')
          return rel
        }
        async function pickLibrary(item) {
          try {
            const rel = await downloadLibraryItem(item)
            insertAtCursor(`@${rel} `)
            setStatus(`已下载并引用 ${rel}`)
          } catch (error) { setStatus(`素材下载失败：${error?.message || error}`) }
        }
        // 右键菜单：下载到本地项目（2026-10-21 用户裁决：替代撤掉的拖拽路径；视频/图片/音频通用）
        let libCtxMenu = null
        const hideLibCtxMenu = () => { libCtxMenu?.remove(); libCtxMenu = null }
        function showLibContextMenu(x, y, item) {
          hideLibCtxMenu()
          const menu = document.createElement('div'); menu.className = 'tintin-of-libmenu'
          const row = document.createElement('button'); row.type = 'button'; row.className = 'tintin-of-atrow'
          const icon = document.createElement('span'); icon.className = 'tintin-of-atrow-icon'; icon.textContent = '⤓'
          const label = document.createElement('span'); label.className = 'tintin-of-atlabel'; label.textContent = '下载到本地项目'
          row.append(icon, label)
          row.onclick = (event) => { event.stopPropagation(); hideLibCtxMenu(); void pickLibrary(item) }
          menu.append(row)
          menu.style.left = `${Math.min(x, innerWidth - 200)}px`
          menu.style.top = `${Math.min(y, innerHeight - 60)}px`
          document.body.append(menu)
          libCtxMenu = menu
        }
        window.addEventListener('click', hideLibCtxMenu)
        window.addEventListener('blur', hideLibCtxMenu)
        window.addEventListener('contextmenu', (event) => {
          if (libCtxMenu && !(event.target instanceof Node && libCtxMenu.contains(event.target))) hideLibCtxMenu()
        })
        // 左键 = 预览（2026-10-19 裁决恢复：素材点击=播放/查看；下载只走拖动与右键）
        function showLibPreview(item) {
          const backdrop = document.createElement('div'); backdrop.className = 'tintin-of-preview'
          const box = document.createElement('div'); box.className = 'tintin-of-preview-box'
          const bar = document.createElement('div'); bar.className = 'tintin-of-preview-bar'
          const label = document.createElement('span'); label.className = 'tintin-of-preview-name'; label.textContent = libNameOf(item)
          const close = document.createElement('button'); close.className = 'tintin-of-icon'; close.textContent = '×'
          bar.append(label, close)
          let media
          if (libTab === 'video') { media = document.createElement('video'); media.controls = true; media.autoplay = true }
          else if (libTab === 'audio') { media = document.createElement('audio'); media.controls = true; media.autoplay = true; media.style.width = '100%' }
          else { media = document.createElement('img'); media.alt = libNameOf(item) }
          media.className = 'tintin-of-preview-media'; media.src = libServeUrlOf(item)
          box.append(bar, media); backdrop.append(box); document.body.append(backdrop)
          close.onclick = () => { if (libTab !== 'image') { try { media.pause() } catch { /* already stopped */ } } backdrop.remove() }
          backdrop.onclick = (ev) => { if (ev.target === backdrop) close.onclick() }
        }
        // 素材预览浮层已随「项目」源移除（点击在线素材=下载落项目并引用，语义更直接）
        async function loadSkills() {
          assetsAll.textContent = '正在加载技能…'
          try {
            const result = await ofIpc('openfilm:skills', {})
            skillsData = { native: Array.isArray(result.native) ? result.native : [], server: Array.isArray(result.server) ? result.server : [] }
            skillsLoaded = true
            for (const skill of skillsData.native) { if (skill.cover) { try { window.tintin?.media?.unlock?.(skill.cover) } catch { /* cache route */ } } }
            renderSkills()
          } catch (error) {
            skillsData = { native: [], server: [] }
            assetsAll.textContent = `技能加载失败：${error?.message || error}`
            assetsGrid.replaceChildren()
          }
        }
        function useSkill(skill, kind) {
          const lead = kind === 'native' ? `请使用 OpenFilm 的「${skill.name}」技能（openfilm skill ${skill.id}）：\n` : `请使用「${skill.name}」技能：\n`
          insertAtCursor(lead); togglePanel(false); input.focus()
          setStatus(`已插入技能：${skill.name}`)
        }
        async function pickServerSkill(skill) {
          if (skill.installed || !skill.id) { useSkill(skill, 'server'); return }
          setStatus(`正在安装「${skill.name}」…`)
          try {
            const result = await ofIpc('skills:install', skill.id)
            if (result?.error) throw new Error(result.error)
            skill.installed = true
            setStatus(`已安装「${skill.name}」`)
            useSkill(skill, 'server')
          } catch (error) { setStatus(`安装失败：${error?.message || error}`) }
        }
        function skillGroup(label, count, first) {
          const group = document.createElement('div'); group.className = `tintin-of-skill-group${first ? ' first' : ''}`
          const name = document.createElement('span'); name.textContent = label; const total = document.createElement('span'); total.textContent = String(count)
          group.append(name, total); return group
        }
        function skillEmpty(text) { const empty = document.createElement('div'); empty.className = 'tintin-of-asset-empty'; empty.textContent = text; empty.style.gridColumn = '1/-1'; return empty }
        function skillCard(skill) {
          const card = document.createElement('button'); card.type = 'button'; card.className = 'tintin-of-skill-card'; card.title = skill.description || skill.name
          const cover = document.createElement('div'); cover.className = 'tintin-of-skill-cover'
          if (skill.cover) {
            const img = document.createElement('img'); img.loading = 'lazy'; img.src = mediaSrc({ abs: skill.cover }); cover.append(img)
          } else { const icon = document.createElement('span'); icon.textContent = '◫'; icon.style.fontSize = '20px'; icon.style.color = '#4a4b52'; cover.append(icon) }
          const name = document.createElement('div'); name.className = 'tintin-of-skill-name'; name.textContent = skill.name
          const desc = document.createElement('div'); desc.className = 'tintin-of-skill-desc'; desc.textContent = skill.description || ''
          card.append(cover, name, desc); card.onclick = () => useSkill(skill, 'native'); return card
        }
        function skillRow(skill) {
          const row = document.createElement('button'); row.type = 'button'; row.className = 'tintin-of-skill-row'; row.title = skill.description || ''
          const main = document.createElement('div'); main.className = 'tintin-of-skill-row-main'
          const name = document.createElement('span'); name.className = 'tintin-of-skill-row-name'; name.textContent = skill.name
          const desc = document.createElement('span'); desc.className = 'tintin-of-skill-row-desc'; desc.textContent = skill.description || ''; main.append(name, desc)
          const state = document.createElement('span'); state.className = `tintin-of-skill-state${skill.installed ? ' installed' : ''}`; state.textContent = skill.installed ? '已安装' : '安装'
          row.append(main, state); row.onclick = () => { void pickServerSkill(skill) }; return row
        }
        function renderSkills() {
          const needle = assetsQuery.trim().toLowerCase()
          const hit = (skill) => !needle || [skill.name, skill.description, skill.id].some((value) => String(value || '').toLowerCase().includes(needle))
          const native = skillsData.native.filter(hit)
          const server = skillsData.server.filter(hit)
          assetsAll.textContent = `原生 ${skillsData.native.length} · 服务端 ${skillsData.server.length}`
          const nodes = [skillGroup('OpenFilm 原生技能', native.length, true)]
          if (!native.length) nodes.push(skillEmpty(needle ? '没有匹配的原生技能' : '原生技能不可用（运行时未安装）'))
          for (const skill of native) nodes.push(skillCard(skill))
          nodes.push(skillGroup('服务端技能', server.length, false))
          const list = document.createElement('div'); list.className = 'tintin-of-skill-list'
          if (!server.length) list.append(skillEmpty(needle ? '没有匹配的服务端技能' : '服务端暂无技能'))
          for (const skill of server) list.append(skillRow(skill))
          nodes.push(list)
          assetsGrid.replaceChildren(...nodes)
        }
        function paintSource() {
          const skills = panelMode === 'skills'
          typeTabs.style.display = skills ? 'none' : 'flex'
          assetsUpload.style.display = 'none'
          assetsSearch.placeholder = skills ? '搜索技能' : '搜索素材库'
          assetsAll.textContent = ''
          if (skills) { if (skillsLoaded) renderSkills(); else void loadSkills(); return }
          if (libLoaded) renderLibrary(); else void loadLibrary()
        }
        function togglePanel(open, mode = panelMode) {
          if (mode !== panelMode) { assetsQuery = ''; assetsSearch.value = ''; libPage = 1; libExhausted = false; libLoaded = false }
          panelMode = mode; assetsOpen = open
          assetsPanel.style.display = open ? 'flex' : 'none'
          list.style.display = open ? 'none' : 'flex'
          if (!open) return
          paintSource()
        }

        function renderEmpty() {
          const wrap = document.createElement('div'); wrap.className = 'tintin-of-empty2'
          const mark = document.createElement('div'); mark.className = 'tintin-of-mark'
          const heading = document.createElement('div'); heading.className = 'tintin-of-h1'; heading.textContent = '你想做什么？'
          const subline = document.createElement('div'); subline.className = 'tintin-of-p'; subline.textContent = '一句话就够了，剩下的交给我。'
          const head = document.createElement('div'); head.className = 'tintin-of-sugg-head'
          const headText = document.createElement('span'); headText.textContent = '试试这些，点一下就发'
          const shuffle = document.createElement('button'); shuffle.type = 'button'; shuffle.textContent = '换一批'
          shuffle.onclick = () => { suggestionBatch += 1; render() }
          head.append(headText, shuffle)
          const cards = document.createElement('div'); cards.className = 'tintin-of-sugg'
          const batch = OPENFILM_SUGGESTIONS[suggestionBatch % OPENFILM_SUGGESTIONS.length]
          for (const text of batch) { const card = document.createElement('button'); card.type = 'button'; card.className = 'tintin-of-sugg-card'; const label = document.createElement('span'); label.textContent = text; const arrow = document.createElement('span'); arrow.textContent = '↗'; card.append(label, arrow); card.onclick = () => sendSuggestion(text); cards.append(card) }
          const upload = document.createElement('button'); upload.type = 'button'; upload.className = 'tintin-of-upload-hint'
          upload.textContent = '⬆ 上传你的文件：视频、图片、音频、幻灯片、文档，什么都行'
          upload.onclick = () => pickFiles()
          wrap.append(mark, heading, subline, head, cards, upload)
          return wrap
        }

        function render() {
          const snap = binding?.session?.getSnapshot?.()
          const rows = binding ? openFilmRows(binding) : []
          list.replaceChildren()
          if (!rows.length) {
            if (snap?.running) {
              const running = document.createElement('div'); running.className = 'tintin-of-running'; running.textContent = '编导正在工作…'
              list.append(running)
            } else {
              list.append(renderEmpty())
            }
            stopBtn.style.display = snap?.running ? 'inline-block' : 'none'
            renderSessions()
            renderApproval()
            return
          }
          for (const row of rows) {
            if (row.role === 'tool') {
              const details = document.createElement('details'); details.className = 'tintin-of-tool'
              const summary = document.createElement('summary')
              const dot = document.createElement('span'); dot.className = 'tintin-of-dot'
              dot.style.background = row.status === 'error' ? '#f87171' : row.status === 'running' ? '#eab308' : '#4ade80'
              const name = document.createElement('span'); name.textContent = row.name
              const preview = document.createElement('span'); preview.style.opacity = '.6'; preview.style.overflow = 'hidden'; preview.style.textOverflow = 'ellipsis'
              preview.textContent = row.status === 'running' ? '运行中…' : openFilmArgPreview(row.args)
              summary.append(dot, name, preview)
              const body = document.createElement('pre')
              body.textContent = [row.args, row.result].filter(Boolean).join('\n\n').slice(0, 4000)
              details.append(summary, body)
              list.append(details)
              continue
            }
            const bubble = document.createElement('div'); bubble.className = `tintin-of-msg ${row.role}`
            // 编导回复里的引用 token 同样渲染为只读 pill（对齐桌面端 agent-refs 的句子不变性）
            renderPillText(bubble, row.text)
            list.append(bubble)
          }
          let live = ''
          try {
            for (const entry of binding.eventSource.getSnapshot().entries) {
              if (entry.type !== 'transient') continue
              const event = entry.event
              if (event?.type !== 'assistant/live-chunk') continue
              const chunk = event.data?.chunk
              if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') live += chunk.text
            }
          } catch { /* event window not open yet */ }
          if (live) {
            const bubble = document.createElement('div'); bubble.className = 'tintin-of-msg assistant tintin-of-live'
            bubble.textContent = `${live}▍`
            list.append(bubble)
          }
          stopBtn.style.display = snap?.running ? 'inline-block' : 'none'
          if (snap?.running && !live) {
            const running = document.createElement('div'); running.className = 'tintin-of-running'; running.textContent = '编导正在工作…'
            list.append(running)
          }
          list.scrollTop = list.scrollHeight
          renderSessions()
          renderApproval()
        }

        function renderModels() {
          const state = directory?.store?.getSnapshot?.()
          if (!directory || !state) { modelSelect.style.display = 'none'; return }
          const groups = Array.isArray(state.groups) ? state.groups : []
          const current = state.current
          const currentValue = current ? `${current.provider}::${current.model}` : ''
          const options = []
          if (!currentValue) options.push({ value: '', label: '默认模型' })
          for (const group of groups) {
            for (const model of (group.models || [])) options.push({ value: `${group.id}::${model.id}`, label: `${model.name || model.id}` })
          }
          const signature = `${options.map((option) => `${option.value}|${option.label}`).join('\n')}#${currentValue}`
          if (modelSelect.dataset.signature !== signature) {
            modelSelect.dataset.signature = signature
            modelSelect.replaceChildren(...options.map((option) => { const el = document.createElement('option'); el.value = option.value; el.textContent = option.label; return el }))
            modelSelect.value = options.some((option) => option.value === currentValue) ? currentValue : ''
          }
          modelSelect.disabled = state.status === 'selecting'
          modelSelect.style.display = 'inline-block'
        }
        async function loadModels() {
          renderModels()
          const resolver = modelDirs
          if (!resolver || !binding) { modelSelect.style.display = 'none'; return }
          try {
            directory = resolver.directoryFor(binding.sessionId)
            unsubscribes.push(directory.store.subscribe(renderModels))
            renderModels()
            await directory.load()
          } catch {
            directory = null; modelSelect.style.display = 'none'
          }
        }
        async function changeModel() {
          const value = modelSelect.value
          if (!value || !directory) return
          const at = value.indexOf('::')
          if (at < 1) return
          const provider = value.slice(0, at)
          const model = value.slice(at + 2)
          setStatus('正在切换模型…')
          try {
            const result = await directory.select({ provider, model })
            if (!result?.ok) throw new Error(result?.error?.message || '切换失败')
            setStatus('')
          } catch (error) { setStatus(`切换模型失败：${error?.message || error}`) }
        }

        // 会话自动命名（对齐桌面端：以首条消息的词命名，引用读作名字）：客户端侧覆盖名，
        // 只影响本视图显示，不动宿主会话记录
        const titlesKey = () => `tintin.openfilm.titles:${project}`
        const sessionTitleOverride = (id) => {
          try { return String((JSON.parse(localStorage.getItem(titlesKey()) || '{}'))[id] || '') } catch { return '' }
        }
        const rememberSessionTitle = (id, text) => {
          const clean = String(text || '')
            .replace(/\[[^\][]*\]/g, ' ').replace(/@[^\s]+/g, ' ').replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 24)
          if (!id || !clean) return
          try {
            const map = JSON.parse(localStorage.getItem(titlesKey()) || '{}')
            if (map[id]) return
            map[id] = clean
            localStorage.setItem(titlesKey(), JSON.stringify(map))
            renderSessions()
          } catch { /* 存储不可用：保持兜底名 */ }
        }
        function renderSessions() {
          const state = sessionsSvc?.list?.getSnapshot?.()
          const ids = Array.isArray(state?.ids) ? state.ids : []
          const byId = state?.byId || {}
          const rows = []
          const seen = new Set()
          for (const id of ids) {
            const summary = byId[id]
            if (!summary || summary.origin === 'subagent' || seen.has(id)) continue
            if (project && summary.cwd && summary.cwd !== project) continue
            seen.add(id)
            rows.push(summary)
          }
          if (binding && !seen.has(binding.sessionId)) {
            rows.unshift(byId[binding.sessionId] || { id: binding.sessionId, displayTitle: '当前会话', running: false, updatedAt: Date.now() })
          }
          rows.sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0))
          const options = rows.map((summary) => ({
            value: summary.id,
            label: `${sessionTitleOverride(summary.id) || summary.displayTitle || summary.title || '未命名会话'}${summary.running ? ' · 运行中' : ''}`,
          }))
          const signature = `${options.map((option) => `${option.value}|${option.label}`).join('\n')}#${binding?.sessionId || ''}`
          if (sessionSelect.dataset.signature !== signature) {
            sessionSelect.dataset.signature = signature
            if (!options.length) {
              const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = project ? '（暂无会话）' : '（未打开影片）'
              sessionSelect.replaceChildren(placeholder)
            } else sessionSelect.replaceChildren(...options.map((option) => { const element = document.createElement('option'); element.value = option.value; element.textContent = option.label; return element }))
          }
          if (binding && options.some((option) => option.value === binding.sessionId)) sessionSelect.value = binding.sessionId
          sessionSelect.disabled = !project || options.length === 0
          sessionSelect.title = project || 'OpenFilm'
        }
        async function switchSession(id) {
          if (!sessionsSvc || !id) return false
          release()
          setStatus('正在切换会话…')
          try {
            reference = sessionsSvc.retain(id, { source: 'openfilm' })
            binding = await reference.ready
            localStorage.setItem(sessionKey(), id)
            unsubscribes.push(binding.eventSource.subscribe(render))
            unsubscribes.push(binding.session.subscribe(render))
            setStatus('')
            render()
            void loadModels()
            return true
          } catch (error) {
            setStatus(`切换会话失败：${error?.message || error}`)
            render()
            return false
          }
        }
        async function createSession() {
          if (!sessionsSvc) { setStatus('会话服务不可用：请重载 TinTin'); return }
          if (!project) { setStatus('请先打开一部影片'); return }
          try {
            const id = await sessionsSvc.create({ cwd: project, agentPreset: roleSelect.value || OPENFILM_ROLES[0].id })
            localStorage.setItem(sessionKey(), id)
            await switchSession(id)
            void sessionsSvc.refresh?.()
          } catch (error) { setStatus(`新建会话失败：${error?.message || error}`) }
        }
        async function openSession() {
          if (!sessionsSvc) { setStatus('会话服务不可用：请重载 TinTin'); render(); return }
          if (!project) {
            release()
            render()
            return
          }
          applyRole()
          const saved = localStorage.getItem(sessionKey())
          if (saved && await switchSession(saved)) return
          if (saved) localStorage.removeItem(sessionKey())
          return createSession()
        }
        // ── 引用配图（第二批对齐：桌面端 ref-pictures.ts + studio-refs.ts 契约）────
        // Studio 给的引用帧图（ref.image.src，Studio 源上的地址）取回为 JPEG——裁剪按
        // stage 比例、宽 ≤1280、q0.85——经 openfilm:saveRefImage 落盘
        // `.film/refs/<turn>-<n>.jpg`，消息后附 <studio_references> 块点名每个文件。
        // 失败只让该行没有图，不阻断发送；每条消息最多 8 张。
        const REF_MAX_PICTURES = 8
        const REF_MAX_WIDTH = 1280
        let studioOrigin = ''
        async function ensureStudioOrigin() {
          if (studioOrigin) return studioOrigin
          try {
            const info = await ofIpc('openfilm:studio', {})
            studioOrigin = new URL(String(info.url || '')).origin
          } catch { studioOrigin = '' }
          return studioOrigin
        }
        const refSec3 = (t) => `${Number(t).toFixed(3)} s`
        const refQuote = (text, maxWords) => JSON.stringify(String(text || '').split(/\s+/).filter(Boolean).slice(0, maxWords).join(' '))
        const refBox = (box) => `at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)} px`
        function refLine(ref) {
          switch (ref?.kind) {
            case 'clip': return [
              `clip ${ref.id ? `\`${ref.id}\`` : refQuote(ref.label, 80)}${ref.src ? ` (${ref.src})` : ''}`,
              typeof ref.track === 'number' ? `track ${ref.track}` : null,
              `${Number(ref.start).toFixed(3)}–${Number(ref.end).toFixed(3)} s of the film`,
              typeof ref.in === 'number' ? `in ${refSec3(ref.in)}` : null,
              typeof ref.speed === 'number' ? `speed ${ref.speed}` : null,
              ref.loc || null,
            ].filter(Boolean).join(' · ')
            case 'layer': return [
              `layer${ref.tag ? ` <${ref.tag}>` : ''} ${refQuote(ref.text || ref.label, 200)}${ref.clipId ? ` in clip \`${ref.clipId}\`` : ''}${typeof ref.time === 'number' ? ` at ${refSec3(ref.time)}` : ''}`,
              ref.box ? refBox(ref.box) : null,
              ref.source ? `source ${ref.source}` : null,
              ref.loc || null,
            ].filter(Boolean).join(' · ')
            case 'region': return [
              `region of the picture at ${refSec3(ref.time)}`,
              ref.box ? refBox(ref.box) : null,
              Array.isArray(ref.clipIds) && ref.clipIds.length ? `clips ${ref.clipIds.join(', ')}` : null,
              Array.isArray(ref.texts) && ref.texts.length ? `words: ${ref.texts.map((text) => refQuote(text, 200)).join(', ')}` : null,
            ].filter(Boolean).join(' · ')
            case 'time': return `moment ${refSec3(ref.time)}`
            case 'range': return [
              `range ${Number(ref.start).toFixed(3)}–${Number(ref.end).toFixed(3)} s`,
              Array.isArray(ref.clipIds) && ref.clipIds.length ? `clips ${ref.clipIds.join(', ')}` : null,
            ].filter(Boolean).join(' · ')
            case 'track': return [
              `track ${ref.track}${ref.label ? ` ${refQuote(ref.label, 80)}` : ''}`,
              Array.isArray(ref.clipIds) && ref.clipIds.length ? `clips ${ref.clipIds.join(', ')}` : null,
            ].filter(Boolean).join(' · ')
            case 'file': {
              const facts = [ref.fileKind, ref.w && ref.h ? `${ref.w}×${ref.h}` : null, ref.duration ? refSec3(ref.duration) : null].filter(Boolean)
              return `file ${ref.path}${facts.length ? ` (${facts.join(', ')})` : ''}`
            }
            case 'subtitle': return [
              `subtitle ${Number(ref.start).toFixed(3)}–${Number(ref.end).toFixed(3)} s ${refQuote(ref.text, 300)}${ref.lang ? ` (${ref.lang})` : ''}`,
              typeof ref.index === 'number' ? `line ${ref.index}` : null,
            ].filter(Boolean).join(' · ')
            default: return refLabel(ref)
          }
        }
        function studioReferencesText(refs, { stage, pictures = [] } = {}) {
          if (!refs.length) return ''
          const size = stage ?? refs.find((ref) => ref.image?.stage)?.image?.stage
          const lines = refs.map((ref, i) => `[${i + 1}] ${refLine(ref)}${pictures[i] ? ` · picture: ${pictures[i]}` : ''}`)
          const attrs = `film="film.html"${size ? ` stage="${Math.round(size.w)}x${Math.round(size.h)}"` : ''}`
          return `\n\n<studio_references ${attrs}>\n${lines.join('\n')}\n</studio_references>`
        }
        async function encodeRefImage(image) {
          if (!image?.src) throw new Error('no picture was taken')
          const origin = await ensureStudioOrigin()
          const absolute = /^https?:/i.test(image.src) ? image.src : `${origin}${image.src}`
          const response = await fetch(absolute, { signal: AbortSignal.timeout(15_000) })
          if (!response.ok) throw new Error(`Studio answered ${response.status}`)
          const bitmap = await createImageBitmap(await response.blob())
          try {
            let sx = 0; let sy = 0; let sw = bitmap.width; let sh = bitmap.height
            if (image.crop && image.stage && image.stage.w > 0) {
              const scale = bitmap.width / image.stage.w
              sx = Math.max(0, Math.round(image.crop.x * scale))
              sy = Math.max(0, Math.round(image.crop.y * scale))
              sw = Math.min(bitmap.width - sx, Math.round(image.crop.w * scale))
              sh = Math.min(bitmap.height - sy, Math.round(image.crop.h * scale))
            }
            if (sw < 1 || sh < 1) throw new Error('nothing to cut')
            const out = Math.min(1, REF_MAX_WIDTH / sw)
            const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * out)), Math.max(1, Math.round(sh * out)))
            const context = canvas.getContext('2d')
            if (!context) throw new Error('no canvas')
            context.fillStyle = '#fff'
            context.fillRect(0, 0, canvas.width, canvas.height)
            context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
            return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
          } finally { bitmap.close() }
        }
        const blobBase64 = async (blob) => {
          const view = new Uint8Array(await blob.arrayBuffer())
          let text = ''
          for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000))
          return btoa(text)
        }
        // 桌面端 referencePictures 契约：只取带 image 的引用（≤8 张），失败留空不阻断
        async function referencePictures(refs, project, turnId) {
          const wanted = refs.flatMap((ref, i) => (ref.image ? [{ n: i + 1, image: ref.image }] : [])).slice(0, REF_MAX_PICTURES)
          const made = await Promise.all(wanted.map(async ({ n, image }) => {
            try {
              const blob = await encodeRefImage(image)
              const saved = await ofIpc('openfilm:saveRefImage', { project, turnId, n, base64: await blobBase64(blob) })
              if (!saved?.path) throw new Error(saved?.error || 'save failed')
              return { n, path: saved.path }
            } catch { return null }
          }))
          const pictures = refs.map(() => undefined)
          for (const picture of made) { if (picture) pictures[picture.n - 1] = picture.path }
          return { pictures }
        }
        // 输入框 pill 的引用（去重、文件除外——文件不参与编号，对齐桌面端），按出现顺序
        function orderedPillRefs() {
          const refs = []
          const seen = new Set()
          for (const node of input.querySelectorAll('[data-token]')) {
            const token = String(node.dataset.token)
            if (seen.has(token)) continue
            seen.add(token)
            const ref = refFromToken(token)
            if (ref && ref.kind !== 'file') refs.push(ref)
          }
          return refs
        }
        async function sendMessage() {
          const text = input.value.trim()
          if (!text) return
          if (!binding) { setStatus('请先打开一部影片'); return }
          let full = text
          const refs = orderedPillRefs()
          if (refs.length && project) {
            setStatus('正在为引用截取画面…')
            try {
              const turnId = `local-${Date.now().toString(36)}`
              const { pictures } = await referencePictures(refs, project, turnId)
              full = text + studioReferencesText(refs, { stage: studioSelection?.stage ?? null, pictures })
            } catch { full = text + studioReferencesText(refs, { stage: studioSelection?.stage ?? null }) }
          }
          input.value = ''
          hideAtMenu()
          setStatus('已发送，等待编导…')
          try {
            const result = await binding.session.prompt([{ type: 'text', text: full }], 'queue')
            if (!result?.ok) throw new Error(result?.error?.message || '发送失败')
            rememberSessionTitle(binding.sessionId, text)
            setStatus('')
          } catch (error) { setStatus(`发送失败：${error?.message || error}`) }
        }
        function sendSuggestion(text) {
          if (!project) { setStatus('先在 Studio 打开一部影片'); return }
          if (!binding) { input.value = text; setStatus('会话准备中…'); return }
          input.value = text
          void sendMessage()
        }
        async function stopTurn() {
          if (!binding) return
          try {
            const result = await binding.session.cancel()
            if (!result?.ok) throw new Error(result?.error?.message || '取消失败')
            setStatus('已停止')
          } catch (error) { setStatus(`停止失败：${error?.message || error}`) }
        }
        function renderApproval() {
          const statusValue = uiSessionSvc?.sessionStatus?.getSnapshot?.()?.get?.(binding?.sessionId)
          const pending = statusValue?.pendingInteraction
          const isApproval = pending && pending.kind === 'approval' && pending.answerable !== false
          approvalBar.style.display = isApproval ? 'flex' : 'none'
          if (isApproval) approvalText.textContent = `${pending.toolName || '操作'} 需要审批${pending.reason ? `：${pending.reason}` : ''}`
          const questions = pending && (pending.kind === 'question' || pending.kind === 'plan-review') && Array.isArray(pending.questions) ? pending.questions : []
          if (!questions.length || pending.key === questionKey) { questionBar.style.display = 'none'; return }
          questionKey = pending.key
          buildQuestionCard(pending, questions)
          questionBar.style.display = 'flex'
        }
        // ask_user_question 契约（dsh-client-ui-user-questions REA）：questions[]{id,question,detail?,options?[{label,description?}],multiSelect?}；
        // 提交 pending.answer({ answers:[{id,selected:[label...],custom?}] }），跳过={id,selected:[]}。
        let questionKey = ''
        const qPicks = new Map(); const qCustom = new Map()
        function buildQuestionCard(pending, questions) {
          qPicks.clear(); qCustom.clear()
          const head = document.createElement('div'); head.className = 'tintin-of-approval-text'; head.textContent = '编导需要你确认以下问题：'
          const rows = [head]
          for (const q of questions) {
            const qel = document.createElement('div'); qel.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:2px 0'
            const qt = document.createElement('div'); qt.textContent = (q.header ? q.header + ' · ' : '') + q.question + (q.multiSelect ? '（可多选）' : '')
            qel.append(qt)
            const picked = new Set()
            for (const opt of (q.options || [])) {
              const b = document.createElement('button'); b.type = 'button'; b.className = 'tintin-of-btn'; b.textContent = opt.label
              if (opt.description) b.title = opt.description
              b.onclick = () => {
                if (q.multiSelect === true) { picked.has(opt.label) ? picked.delete(opt.label) : picked.add(opt.label); b.classList.toggle('is-on', picked.has(opt.label)) }
                else { picked.clear(); picked.add(opt.label); [...qel.querySelectorAll('.tintin-of-btn')].forEach((x) => x.classList.toggle('is-on', x === b)) }
                qPicks.set(q.id, [...picked])
              }
              qel.append(b)
            }
            const custom = document.createElement('input'); custom.className = 'tintin-of-assets-search'; custom.placeholder = q.options && q.options.length ? '或输入自定义回答（可选）' : '输入你的回答'
            custom.oninput = () => { qCustom.set(q.id, custom.value) }
            qel.append(custom)
            rows.push(qel)
          }
          const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'
          const skip = document.createElement('button'); skip.className = 'tintin-of-btn'; skip.textContent = '跳过'
          skip.onclick = () => { void answerQuestion(pending, questions, qPicks, qCustom, true) }
          const submit = document.createElement('button'); submit.className = 'tintin-of-btn'; submit.textContent = '提交回答'
          submit.onclick = () => { void answerQuestion(pending, questions, qPicks, qCustom, false) }
          actions.append(skip, submit); rows.push(actions)
          questionBar.replaceChildren(...rows)
        }
        async function answerQuestion(pending, questions, picks, customs, skipAll) {
          const payload = { answers: questions.map((q) => {
            if (skipAll) return { id: q.id, selected: [] }
            const selected = picks.get(q.id) || []; const custom = String(customs.get(q.id) || '').trim()
            if (custom === '') return { id: q.id, selected }
            return q.options && q.options.length && selected.length ? { id: q.id, selected, custom } : { id: q.id, selected: selected.length ? selected : [], ...(custom ? { custom } : {}) }
          }) }
          try {
            await pending.answer(payload)
            setStatus('已回答编导的提问')
            questionKey = ''
            questionBar.style.display = 'none'
          } catch (error) { setStatus(`回答提交失败：${error?.message || error}`) }
        }
        async function answerApproval(outcome) {
          const statusValue = uiSessionSvc?.sessionStatus?.getSnapshot?.()?.get?.(binding?.sessionId)
          const pending = statusValue?.pendingInteraction
          if (!pending || typeof pending.answer !== 'function') return
          try {
            await pending.answer(outcome)
            setStatus(outcome === 'allowed-once' ? '已允许本次操作' : '已拒绝本次操作')
          } catch (error) { setStatus(`审批失败：${error?.message || error}`) }
          renderApproval()
        }
        // 项目切换的统一落点（原版语义：会话随项目走）。Studio 内切项目时聊天壳
        // 收不到任何事件（2026-10-19 报障：新项目旧会话挂着）→ 由 3s 轮询经
        // openfilm:currentProject 感知后也走这里。
        async function applyProject(next) {
          const changed = next !== project
          if (!changed) return
          project = next
          studioSelection = null; assetsQuery = ''; assetsSearch.value = ''
          atState.project = ''; atState.files = []; atState.pages = []
          if (assetsOpen && panelMode === 'assets') void loadLibrary()
          applyRole()
          await openSession()
          void sessionsSvc?.refresh?.()
          setStatus(project ? '' : '请在 Studio 中打开一部影片')
        }
        async function syncProject() {
          try {
            setStatus('正在同步 Studio 项目…')
            const info = await window.tintin?.openfilm?.studio?.()
            if (!info?.url) throw new Error('Studio 未返回地址')
            if (nativeView?.open) {
              const opened = await nativeView.open(info.url)
              if (!opened?.ok) throw new Error(opened?.error || 'Studio 视图打开失败')
              frame.style.display = 'none'
              setNote('')
              await syncBounds()
            } else {
              frame.style.display = 'block'
              frame.src = info.url
            }
            await applyProject(info.project || '')
          } catch (error) { setStatus(`同步失败：${error?.message || error}`) }
        }
        // Studio 当前项目轮询：studio.json recent[0]（Studio 切项目即重写）→ 变更即切会话
        const projectPoll = setInterval(() => {
          if (document.hidden || syncBusy) return
          void (async () => {
            try {
              const r = await ofIpc('openfilm:currentProject', {})
              const next = String((r && r.project) || '')
              if (next && next !== project) { syncBusy = true; await applyProject(next); syncBusy = false }
            } catch { syncBusy = false }
          })()
        }, 3000)

        input.addEventListener('keydown', (event) => {
          // Ctrl/Cmd+L：引用 Studio 当前选中（对齐桌面端 onComposerKey：引用随光标插入）
          if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'l') {
            const picked = Array.isArray(studioSelection?.refs) ? studioSelection.refs : []
            if (picked.length) {
              event.preventDefault()
              for (const ref of picked) { const token = refToken(ref); if (token) composerRefs.set(token, ref) }
              composerInsert(`${picked.map(refToken).filter(Boolean).join(' ')} `)
            }
            return
          }
          const open = atMenu.style.display === 'block'
          if (event.key === 'Escape') { hideAtMenu(); return }
          if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            if (atRows.length) { atIndex = (atIndex + (event.key === 'ArrowDown' ? 1 : atRows.length - 1)) % atRows.length; atRows.forEach((r, i) => r.el.classList.toggle('is-active', i === atIndex)) }
            return
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            const hitRow = open ? atRows[atIndex] : null
            if (hitRow && hitRow.fire) { hitRow.fire(); return }
            void sendMessage()
          }
        })
        input.addEventListener('input', () => { void refreshAtMenu() })
        input.addEventListener('blur', () => { setTimeout(hideAtMenu, 120) })
        sendBtn.onclick = () => { void sendMessage() }
        stopBtn.onclick = () => { void stopTurn() }
        newBtn.onclick = () => { void createSession() }
        syncBtn.onclick = () => { void syncProject() }
        attachBtn.onclick = () => pickFiles()
        assetsBtn.onclick = () => togglePanel(!(assetsOpen && panelMode === 'assets'), 'assets')
        skillsBtn.onclick = () => togglePanel(!(assetsOpen && panelMode === 'skills'), 'skills')
        assetsClose.onclick = () => togglePanel(false)
        assetsUpload.onclick = () => pickFiles()
        assetsSearch.oninput = () => {
          assetsQuery = assetsSearch.value
          if (panelMode === 'skills') { renderSkills(); return }
          renderLibrary() // 已载入条目即时过滤
          clearTimeout(libSearchTimer)
          // 防抖后回第 1 页向服务端重查：匹配项可能不止已加载的这一页（2026-10-20 报障）
          libSearchTimer = setTimeout(() => { libPage = 1; libExhausted = false; void loadLibrary() }, 400)
        }
        // 滚动近底 → 拉下一页（在线素材库服务端分页；页码推进在 loadLibrary 成功后自增）
        assetsBody.addEventListener('scroll', () => {
          if (!assetsOpen || panelMode !== 'assets' || libBusy || libExhausted || !libLoaded) return
          const nearBottom = assetsBody.scrollTop + assetsBody.clientHeight >= assetsBody.scrollHeight - 240
          if (nearBottom) void loadLibrary(true)
        })
        roleSelect.addEventListener('change', () => {
          if (project) localStorage.setItem(roleKey(), roleSelect.value)
          setStatus('角色将在新会话生效')
        })
        modelSelect.addEventListener('change', () => { void changeModel() })
        sessionSelect.addEventListener('change', () => { if (sessionSelect.value) void switchSession(sessionSelect.value) })
        approvalAllow.onclick = () => { void answerApproval('allowed-once') }
        approvalReject.onclick = () => { void answerApproval('rejected') }
        frame.addEventListener('load', () => setNote(''))
        void syncProject()
      }

      function installOpenFilmView(ctx, tries = 0) {
        if (window.__tintinViews) {
          window.__tintinViews.register('openfilm', { mount: (el) => mountOpenFilm(el, ctx), unmount() {} })
          return
        }
        if (tries < 50) setTimeout(() => installOpenFilmView(ctx, tries + 1), 100)
      }

      // Embedded browser view (2026-10-19 方案 4, same native-view pattern as OpenFilm):
      // the chrome sidebar 浏览器 row activates the 'browser' view; this driver hosts the
      // placeholder rect and drives window.dshDesktopBrowserView (browser UI page view +
      // platform partition views compose on the main window, see tintin main-hook).
      // Browser fallback management panel（2026-10-19 解耦铁律：从 chrome renderBrowserPanel
      // 原样搬入——浏览器域 UI 归 client-ui 层；仅内嵌视图桥缺失时使用。dshDesktopBrowser
      // 完整桥由 browser-page-preload 提供，主窗无此桥时面板呈桥缺失降级态）
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
        // 平台 DOM 抽取（原 chrome 版 extractPlatform 仅调用无定义的 day-one 潜伏 bug，搬移时补内联实现）
        async function extractPlatform(p) {
          extractTitle.textContent = `抽取中：${p.name}…`
          extractBox.style.display = 'block'
          try {
            const r = await bridge.extractDOM(p.id)
            extractTitle.textContent = `抽取结果：${p.name}${r && r.ok === false ? '（失败）' : ''}`
            extractBody.textContent = typeof (r && r.data) === 'string' ? r.data : JSON.stringify(r, null, 2)
          } catch (e) {
            extractTitle.textContent = `抽取失败：${p.name}`
            extractBody.textContent = String((e && e.message) || e)
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
        }).catch(() => { panelStatus.textContent = '平台表加载失败（需完整壳）' })
      }

      function mountBrowserView(el) {
        el.style.cssText = 'position:absolute;inset:0;'
        const nativeView = window.dshDesktopBrowserView
        if (!nativeView?.show) { renderBrowserPanel(el); return }
        const stage = document.createElement('div')
        stage.style.cssText = 'position:absolute;inset:0;background:var(--dsw-alias-bg-layer-1,#141416);'
        const note = document.createElement('div')
        note.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#8b8b88);font-size:13px;pointer-events:none;'
        note.textContent = '浏览器加载中…'
        stage.append(note)
        el.append(stage)
        let opened = false
        let shown = false
        let lastBounds = ''
        const nativeOverlayOpen = () => Array.from(document.body.children).some((element) => {
          const style = getComputedStyle(element)
          return style.position === 'fixed' && style.zIndex === '1000'
        })
        async function syncBounds() {
          if (!nativeView?.show) return
          const rect = stage.getBoundingClientRect()
          if (rect.width < 8 || rect.height < 8 || nativeOverlayOpen()) {
            if (shown) { shown = false; lastBounds = ''; await nativeView.hide() }
            return
          }
          if (!opened) {
            opened = true
            const result = await nativeView.open()
            if (!result?.ok) { note.textContent = result?.error || '浏览器视图启动失败'; return }
            note.style.display = 'none'
          }
          shown = true
          // bounds 去重（与 OpenFilm 视图同修：不变不发包，避免反复 setBounds 重排）
          const next = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`
          if (next === lastBounds) return
          lastBounds = next
          await nativeView.show({
            x: Math.round(rect.left), y: Math.round(rect.top),
            width: Math.round(rect.width), height: Math.round(rect.height),
          })
        }
        if (nativeView?.show) {
          try { new ResizeObserver(() => { void syncBounds() }).observe(stage) } catch { /* no observer */ }
          try { new MutationObserver(() => { void syncBounds() }).observe(document.body, { childList: true }) } catch { /* no observer */ }
          window.addEventListener('resize', () => { void syncBounds() })
          setInterval(() => { void syncBounds() }, 800)
          void syncBounds()
        }
      }
      function installBrowserView(tries = 0) {
        if (window.__tintinViews) {
          // 无条件注册：桥在=内嵌驱动；桥缺=面板兜底（mount 内分流）
          window.__tintinViews.register('browser', { mount: (el) => mountBrowserView(el), unmount() {} })
          return
        }
        if (tries < 50) setTimeout(() => installBrowserView(tries + 1), 100)
      }
      return {
        name: 'dsh-tintin-client-ui',
        apply(ctx) { installCapabilityTests(); installOpenFilmView(ctx); installBrowserView() },
        installCapabilityTests,
        installOpenFilmView,
      }
  },
})
