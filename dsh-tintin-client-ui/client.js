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
          '.tintin-of-composer{padding:10px 12px;border-top:1px solid #1c1d21}.tintin-of-inputwrap{display:flex;align-items:flex-end;gap:8px;background:#16171a;border:1px solid #2a2b31;border-radius:14px;padding:8px 8px 8px 12px}.tintin-of-input{flex:1;resize:none;min-height:40px;max-height:140px;background:transparent;border:0;color:#e8e8e6;font:13px/1.5 system-ui;outline:none;padding:0}.tintin-of-send{width:32px;height:32px;border-radius:50%;border:0;background:#3b6fd4;color:#fff;font-size:16px;line-height:1;cursor:pointer;flex:none}.tintin-of-stop{width:32px;height:32px;border-radius:50%;border:1px solid #7a3b3b;background:#2a1a1a;color:#f0b4b4;font-size:12px;cursor:pointer;flex:none}',
          '.tintin-of-bottom{display:flex;align-items:center;gap:8px;margin-top:8px}.tintin-of-chip{background:#1a1b1f;border:1px solid #2a2b31;border-radius:8px;color:#c9c9cf;font:11px system-ui;padding:3px 6px;max-width:150px;outline:none}.tintin-of-chip option{background:#16171a;color:#e8e8e6}.tintin-of-icon{width:26px;height:26px;border-radius:7px;border:1px solid #2a2b31;background:#1a1b1f;color:#c9c9cf;cursor:pointer;font:13px system-ui;line-height:1;flex:none}.tintin-of-spacer{flex:1}.tintin-of-status{padding:0 12px 8px;font-size:11px;color:#8a8a90;min-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
          '.tintin-of-atmenu{position:absolute;left:12px;right:12px;bottom:104px;max-height:220px;overflow:auto;background:#1a1b1f;border:1px solid #2f3036;border-radius:10px;padding:4px;z-index:5;display:none}.tintin-of-atitem{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:none;font:11px/1.4 ui-monospace,monospace;color:#c9c9cf;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-atitem:hover{background:#24262b}.tintin-of-atgroup{padding:6px 8px 2px;font-size:10px;color:#6f7076}',
          '.tintin-of-atrow{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:none;color:#c9c9cf;font:11px/1.4 system-ui;cursor:pointer}.tintin-of-atrow:hover{background:#24262b}.tintin-of-atrow.is-disabled{opacity:.45;cursor:default}.tintin-of-atlabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tintin-of-atdetail{color:#77787e;font-size:10px;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis}.tintin-of-provider{border:0;background:transparent;color:#e8e8e6;font-weight:600;padding-left:0}',
          '.tintin-of-assets{flex:1;min-height:0;display:none;flex-direction:column;background:#0f1013}.tintin-of-assets-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #1c1d21}.tintin-of-assets-search{flex:1;min-width:0;background:#16171a;border:1px solid #26272b;border-radius:8px;color:#e8e8e6;font:11px system-ui;padding:4px 8px;outline:none}.tintin-of-assets-body{flex:1;min-height:0;overflow:auto;padding:10px}.tintin-of-assets-all{font-size:11px;color:#8a8a90;padding:0 2px 8px}.tintin-of-assets-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
          '.tintin-of-asset{border:1px solid #26272b;background:#16171a;border-radius:9px;overflow:hidden;padding:0;color:#e2e2e6;font:11px system-ui;text-align:left;cursor:pointer}.tintin-of-asset:hover{border-color:#3b6fd4}.tintin-of-asset-thumb{position:relative;aspect-ratio:16/9;background:#0b0c0f;display:flex;align-items:center;justify-content:center;overflow:hidden}.tintin-of-asset-thumb img,.tintin-of-asset-thumb video{width:100%;height:100%;object-fit:cover;display:block}.tintin-of-asset-badge{position:absolute;right:5px;bottom:5px;background:rgba(0,0,0,.65);border-radius:4px;padding:1px 4px;font-size:10px;color:#e8e8e6}.tintin-of-asset-name{padding:6px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tintin-of-asset-empty{margin:auto;text-align:center;color:#8a8a90;font-size:12px;line-height:1.7}',
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
        // 抽屉两个来源（2026-10-19 用户裁决：默认显示在线素材库=媒体工具素材库移植；项目=本地文件）
        const sourceTabs = document.createElement('div'); sourceTabs.className = 'tintin-of-srctabs'
        const libTabBtn = document.createElement('button'); libTabBtn.className = 'tintin-of-srctab is-on'; libTabBtn.textContent = '素材库'
        const projTabBtn = document.createElement('button'); projTabBtn.className = 'tintin-of-srctab'; projTabBtn.textContent = '项目'
        const typeTabs = document.createElement('div'); typeTabs.className = 'tintin-of-srctabs'; typeTabs.style.display = 'none'
        sourceTabs.append(libTabBtn, projTabBtn)
        const headCol = document.createElement('div'); headCol.className = 'tintin-of-headcol'
        const headRow1 = document.createElement('div'); headRow1.className = 'tintin-of-headrow'
        const headRow2 = document.createElement('div'); headRow2.className = 'tintin-of-headrow'
        headRow1.append(sourceTabs, typeTabs); headRow2.append(assetsSearch, assetsUpload, assetsClose)
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
        const input = document.createElement('textarea'); input.className = 'tintin-of-input'; input.rows = 2
        input.placeholder = '描述你的影片。输入 @ 可使用此项目中的文件'
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
        let nativeShown = false
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
        const insertReference = (ref) => {
          const token = refToken(ref)
          if (!token) return
          insertAtCursor(`${token} `)
          setStatus(`已引用 ${refLabel(ref)}`)
        }
        const nativeOverlayOpen = () => Array.from(document.body.children).some((element) => {
          const style = getComputedStyle(element)
          return style.position === 'fixed' && style.zIndex === '1000'
        })
        async function syncBounds() {
          if (!nativeView?.show) return
          const rect = stage.getBoundingClientRect()
          if (rect.width < 8 || rect.height < 8 || nativeOverlayOpen()) {
            if (nativeShown) { nativeShown = false; await nativeView.hide() }
            return
          }
          nativeShown = true
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
        const setStatus = (text) => { status.textContent = text || '' }
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
            return window.dshDesktopFilePath?.forFile?.(file)
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
          const start = input.selectionStart ?? input.value.length
          const end = input.selectionEnd ?? start
          input.value = input.value.slice(0, start) + text + input.value.slice(end)
          input.focus()
          input.selectionStart = input.selectionEnd = start + text.length
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
          if (assetsOpen && panelMode === 'assets') void loadMedia()
        }
        fileInput.addEventListener('change', () => {
          const files = Array.from(fileInput.files || [])
          fileInput.value = ''
          void importFiles(files)
        })

        function currentAtToken() {
          const position = input.selectionStart ?? input.value.length
          const before = input.value.slice(0, position)
          const match = before.match(/(?:^|\s)@([^\s@]*)$/)
          if (!match) return null
          const query = match[1] || ''
          return { query, start: position - query.length - 1, end: position }
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
          const value = input.value
          input.value = value.slice(0, token.start) + '@' + path + ' ' + value.slice(token.end)
          input.focus()
          input.selectionStart = input.selectionEnd = token.start + path.length + 2
          hideAtMenu()
        }
        const formatSize = (bytes) => {
          const value = Number(bytes) || 0
          if (value < 1024) return `${value} B`
          if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
          return `${(value / (1024 * 1024)).toFixed(1)} MB`
        }
        async function refreshAtMenu() {
          const token = currentAtToken()
          if (!token) { hideAtMenu(); return }
          const files = project ? await ensureProjectFiles() : []
          const needle = token.query.toLowerCase()
          const hit = (text) => !needle || String(text).toLowerCase().includes(needle)
          const selection = studioSelection
          const selectedRefs = Array.isArray(selection?.refs) ? selection.refs : []
          const moments = []
          if (Number.isFinite(Number(selection?.time))) moments.push({ label: '当前时间', detail: formatTime(selection.time), text: `[时间 ${formatTime(selection.time)}] ` })
          else moments.push({ label: '当前时间', detail: '等待 Studio 选择', disabled: true })
          if (selectedRefs.length) moments.push({ label: '当前选中', detail: `${refLabel(selectedRefs[0])}${selectedRefs.length > 1 ? ` +${selectedRefs.length - 1}` : ''}`, text: `${selectedRefs.map(refToken).join(' ')} ` })
          else moments.push({ label: '当前选中', detail: '请先在画面或时间轴上选中内容', disabled: true })
          const range = selection?.range
          if (range && Number(range.end) > Number(range.start)) moments.push({ label: '当前范围', detail: `${formatTime(range.start)}–${formatTime(range.end)}`, text: `[范围 ${formatTime(range.start)}–${formatTime(range.end)}] ` })
          const visibleMoments = moments.filter((item) => hit(item.label) || hit(item.detail))
          const groups = []
          if (hit('时刻') || visibleMoments.length) groups.push({ label: '时刻', items: visibleMoments })
          const mediaHits = files.filter((file) => mediaKind(file.path) && hit(file.path)).slice(0, 8).map((file) => ({ label: String(file.path).split('/').pop() || file.path, detail: formatSize(file.size), path: file.path }))
          const pageHits = atState.pages.filter((page) => hit(page.path)).slice(0, 8).map((page) => ({ label: String(page.path).replace(/\.html?$/i, ''), detail: formatSize(page.size), path: page.path }))
          if (hit('素材') || mediaHits.length || pageHits.length) groups.push({ label: '素材', items: [...mediaHits, ...pageHits] })
          if (!groups.length) { hideAtMenu(); return }
          const nodes = []; atRows = []; atIndex = 0
          for (const group of groups) {
            const head = document.createElement('div'); head.className = 'tintin-of-atgroup'; head.textContent = group.label
            nodes.push(head)
            for (const item of group.items) {
              const row = document.createElement('button'); row.type = 'button'; row.className = 'tintin-of-atrow'
              if (item.disabled) row.classList.add('is-disabled')
              const label = document.createElement('span'); label.className = 'tintin-of-atlabel'; label.textContent = item.label
              const detail = document.createElement('span'); detail.className = 'tintin-of-atdetail'; detail.textContent = item.detail || ''
              row.append(label, detail)
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
        let assetsOpen = false; let assetsQuery = ''; let mediaItems = []; let panelMode = 'assets'; let activeSource = 'library'
        let libTab = 'video'; let libItems = []; let libLoaded = false; let libServer = ''; let libBusy = false; let syncBusy = false
        libTabBtn.onclick = () => { activeSource = 'library'; paintSource() }
        projTabBtn.onclick = () => { activeSource = 'project'; paintSource() }
        for (const t of [['video', '视频'], ['image', '图片'], ['audio', '音频']]) {
          const b = document.createElement('button'); b.className = 'tintin-of-srctab' + (t[0] === 'video' ? ' is-on' : ''); b.textContent = t[1]
          b.onclick = () => { libTab = t[0]; [...typeTabs.children].forEach((x) => x.classList.toggle('is-on', x === b)); libLoaded = false; if (assetsOpen && panelMode === 'assets' && activeSource === 'library') void loadLibrary() }
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
        async function loadMedia() {
          if (!project) { mediaItems = []; renderAssets(); return }
          try {
            const result = await ofIpc('openfilm:projectFiles', { project })
            const files = Array.isArray(result.files) ? result.files : []
            mediaItems = files
              .filter((file) => mediaKind(file.path))
              .map((file) => ({ ...file, kind: mediaKind(file.path), abs: `${project.replace(/[\/]+$/, '')}/${file.path}` }))
            for (const item of mediaItems) { try { await window.tintin?.media?.unlock?.(item.abs) } catch { /* the workspace route already allows it */ } }
            // 等解锁登记完成再渲染：缩略图请求先于 unlock 到达会 403 破图（2026-10-19 报障）
            renderAssets()
          } catch { mediaItems = []; renderAssets() }
        }
        function renderAssets() {
          const needle = assetsQuery.trim().toLowerCase()
          const items = mediaItems.filter((item) => !needle || item.path.toLowerCase().includes(needle))
          assetsAll.textContent = `全部（${items.length}）`
          if (!items.length) {
            const empty = document.createElement('div'); empty.className = 'tintin-of-asset-empty'
            empty.textContent = '还没有素材：上传文件，或让编导生成。'
            assetsGrid.replaceChildren(empty)
            return
          }
          assetsGrid.replaceChildren(...items.map((item) => {
            const card = document.createElement('button'); card.type = 'button'; card.className = 'tintin-of-asset'; card.title = item.path
            const thumb = document.createElement('div'); thumb.className = 'tintin-of-asset-thumb'
            const badge = document.createElement('span'); badge.className = 'tintin-of-asset-badge'; badge.textContent = formatSize(item.size)
            if (item.kind === 'image') {
              // 不用 lazy：网格判离屏则永不发起请求（2026-10-19 报障缩略图恒 pending）；403 自愈=宿主重载清解锁集后重试一次
              const img = document.createElement('img'); img.src = mediaSrc(item)
              img.onerror = async () => { if (img.dataset.retried) return; img.dataset.retried = '1'; try { await window.tintin?.media?.unlock?.(item.abs) } catch { /* offline */ } img.src = `${mediaSrc(item)}&r=${Date.now()}` }
              thumb.append(img)
            } else if (item.kind === 'video') {
              const video = document.createElement('video'); video.muted = true; video.preload = 'metadata'; video.playsInline = true; video.src = mediaSrc(item)
              video.onloadedmetadata = () => { badge.textContent = formatDuration(video.duration); try { video.currentTime = Math.min(0.1, (video.duration || 0) / 2) } catch { /* not seekable */ } }
              thumb.append(video)
            } else {
              const icon = document.createElement('span'); icon.textContent = '♪'; icon.style.fontSize = '22px'; icon.style.color = '#4a4b52'
              const audio = document.createElement('audio'); audio.preload = 'metadata'; audio.src = mediaSrc(item); audio.style.display = 'none'
              audio.onloadedmetadata = () => { badge.textContent = formatDuration(audio.duration) }
              thumb.append(icon, audio)
            }
            thumb.append(badge)
            const name = document.createElement('div'); name.className = 'tintin-of-asset-name'
            name.textContent = item.path.split('/').pop() || item.path
            card.append(thumb, name)
            card.onclick = () => openPreview(item)
            return card
          }))
        }
        // ── 在线素材库（2026-10-19 用户裁决：媒体工具素材库移植；点击=下载落项目 assets/download + 插入 @）──
        async function ensureLibServer() {
          if (libServer) return libServer
          try { const ping = await window.tintin?.env?.serverPing?.(); libServer = String(ping?.url || '').replace(/\/+$/, '') } catch { libServer = '' }
          return libServer
        }
        async function loadLibrary() {
          libBusy = true; assetsAll.textContent = '素材库加载中…'; assetsGrid.replaceChildren()
          libServer = await ensureLibServer()
          try {
            const q = { page: 1, size: 60, media_type: libTab }
            if (assetsQuery.trim()) q.search = assetsQuery.trim()
            const res = await window.tintin.server.get('/material/list', q)
            const data = res && typeof res === 'object' ? (res.data ?? res) : {}
            libItems = Array.isArray(data.items) ? data.items : Array.isArray(data.list) ? data.list : []
            libLoaded = true
            if (assetsOpen && panelMode === 'assets' && activeSource === 'library') renderLibrary()
          } catch (error) { libBusy = false; assetsAll.textContent = `素材库加载失败：${error?.message || error}` }
          libBusy = false
        }
        function libIdOf(item) { return String(item.material_id ?? item.id ?? '').trim() }
        function libNameOf(item) { return String(item.filename || item.name || (libIdOf(item) ? `material-${libIdOf(item)}` : '未命名素材')) }
        function libExtOf() { return libTab === 'video' ? '.mp4' : libTab === 'audio' ? '.mp3' : '.jpg' }
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
              thumb.append(img)
            } else { const icon = document.createElement('span'); icon.textContent = '▤'; icon.style.fontSize = '22px'; icon.style.color = '#4a4b52'; thumb.append(icon) }
            const name = document.createElement('div'); name.className = 'tintin-of-asset-name'; name.textContent = libNameOf(item)
            card.append(thumb, name); card.onclick = () => { void pickLibrary(item) }
            return card
          }))
        }
        async function pickLibrary(item) {
          if (!project) { setStatus('先在 Studio 打开一部影片'); return }
          const id = libIdOf(item)
          if (!id) { setStatus('素材缺少 id'); return }
          const stem = libNameOf(item).replace(/[/:*?"<>|]/g, '-').slice(0, 80) || `material-${id}`
          const file = /\.[a-z0-9]+$/i.test(stem) ? stem : stem + libExtOf()
          const rel = `assets/download/${file}`
          setStatus(`正在下载素材 ${file} …`)
          try {
            const sep = String.fromCharCode(92)
            const saved = await window.tintin.downloadResult(`/material/serve?material_id=${encodeURIComponent(id)}`, `${project.replace(/[/]+$/, '')}${sep}assets${sep}download${sep}${file}`)
            if (!saved || saved.error) throw new Error(saved?.error || '下载失败')
            insertAtCursor(`@${rel} `)
            setStatus(`已下载并引用 ${rel}`)
          } catch (error) { setStatus(`素材下载失败：${error?.message || error}`) }
        }
        // 素材点击=播放/预览（2026-10-19 用户裁决：对齐官方 app 素材列表）；引用改走预览条按钮
        function openPreview(item) {
          const backdrop = document.createElement('div'); backdrop.className = 'tintin-of-preview'
          const box = document.createElement('div'); box.className = 'tintin-of-preview-box'
          const bar = document.createElement('div'); bar.className = 'tintin-of-preview-bar'
          const label = document.createElement('span'); label.className = 'tintin-of-preview-name'; label.textContent = item.path
          const quote = document.createElement('button'); quote.className = 'tintin-of-btn'; quote.textContent = '引用 @'
          quote.onclick = () => { insertAtCursor(`@${item.path} `); setStatus(`已引用 ${item.path}`) }
          const close = document.createElement('button'); close.className = 'tintin-of-icon'; close.textContent = '×'
          bar.append(label, quote, close)
          let media
          if (item.kind === 'video') { media = document.createElement('video'); media.controls = true; media.autoplay = true }
          else if (item.kind === 'audio') { media = document.createElement('audio'); media.controls = true; media.autoplay = true; media.style.width = '100%' }
          else { media = document.createElement('img'); media.alt = item.path }
          media.className = 'tintin-of-preview-media'; media.src = mediaSrc(item)
          box.append(bar, media); backdrop.append(box); document.body.append(backdrop)
          close.onclick = () => { if (item.kind !== 'image') { try { media.pause() } catch { /* already stopped */ } } backdrop.remove() }
          backdrop.onclick = (ev) => { if (ev.target === backdrop) close.onclick() }
        }
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
          sourceTabs.style.display = skills ? 'none' : 'flex'
          libTabBtn.classList.toggle('is-on', activeSource === 'library'); projTabBtn.classList.toggle('is-on', activeSource === 'project')
          typeTabs.style.display = !skills && activeSource === 'library' ? 'flex' : 'none'
          assetsUpload.style.display = skills || activeSource === 'library' ? 'none' : ''
          assetsSearch.placeholder = skills ? '搜索技能' : activeSource === 'library' ? '搜索素材库' : '搜索素材'
          assetsAll.textContent = ''
          if (skills) { if (skillsLoaded) renderSkills(); else void loadSkills(); return }
          if (activeSource === 'library') { if (libLoaded) renderLibrary(); else void loadLibrary() }
          else void loadMedia()
        }
        function togglePanel(open, mode = panelMode) {
          if (mode !== panelMode) { assetsQuery = ''; assetsSearch.value = '' }
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
            bubble.textContent = row.text
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
            label: `${summary.displayTitle || summary.title || '未命名会话'}${summary.running ? ' · 运行中' : ''}`,
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
        async function sendMessage() {
          const text = input.value.trim()
          if (!text) return
          if (!binding) { setStatus('请先打开一部影片'); return }
          input.value = ''
          hideAtMenu()
          setStatus('已发送，等待编导…')
          try {
            const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
            if (!result?.ok) throw new Error(result?.error?.message || '发送失败')
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
          studioSelection = null; mediaItems = []; assetsQuery = ''; assetsSearch.value = ''
          atState.project = ''; atState.files = []; atState.pages = []
          if (assetsOpen && panelMode === 'assets') void loadMedia()
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
        assetsSearch.oninput = () => { assetsQuery = assetsSearch.value; if (panelMode === 'skills') renderSkills(); else if (activeSource === 'library') renderLibrary(); else renderAssets() }
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
        const nativeOverlayOpen = () => Array.from(document.body.children).some((element) => {
          const style = getComputedStyle(element)
          return style.position === 'fixed' && style.zIndex === '1000'
        })
        async function syncBounds() {
          if (!nativeView?.show) return
          const rect = stage.getBoundingClientRect()
          if (rect.width < 8 || rect.height < 8 || nativeOverlayOpen()) {
            if (shown) { shown = false; await nativeView.hide() }
            return
          }
          if (!opened) {
            opened = true
            const result = await nativeView.open()
            if (!result?.ok) { note.textContent = result?.error || '浏览器视图启动失败'; return }
            note.style.display = 'none'
          }
          shown = true
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
