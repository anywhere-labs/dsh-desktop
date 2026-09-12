const tools = [
  ['诊断', 'dbs', '诊断导航中枢', '不知道从哪里开始时，先识别问题并推荐下一步。'],
  ['诊断', 'dbs-diagnosis', '商业模式诊断', '消解伪问题，检查产品、定价、客户与交易是否成立。'],
  ['诊断', 'dbs-benchmark', '对标分析', '通过五重过滤找到真正值得学习的对标对象。'],
  ['诊断', 'dbs-jtbd', 'JTBD 需求诊断', '从用户任务、替代方案和触发场景判断真实需求。'],
  ['内容', 'dbs-content', '内容创作诊断', '用五维框架检查内容为什么不成立。'],
  ['内容', 'dbs-hook', '短视频开头优化', '诊断前几秒的问题并给出可拍摄的开头方案。'],
  ['内容', 'dbs-xhs-title', '小红书标题', '从标题公式中选择适合当前内容的一种。'],
  ['内容', 'dbs-ai-check', 'AI 写作特征检查', '扫描常见 AI 味，只诊断，不擅自重写。'],
  ['内容', 'dbs-spread', '传播心理解码', '分析已有内容为什么会引发传播与讨论。'],
  ['内容', 'dbs-resonate', '文稿共鸣诊断', '识别内容是否全面但没有刺中核心。'],
  ['内容', 'dbs-script-flow', '文稿流动性诊断', '检查段落节奏、信息推进与口播阻力。'],
  ['内容', 'dbs-wechat-html', '公众号 HTML', '把 Markdown 转成可粘贴的微信公众号排版。'],
  ['内容', 'dbs-content-risk-check', '内容风险检查', '发布前检查表达、事实与平台风险。'],
  ['系统', 'dbs-content-system', '内容结构化系统', '把大量本地素材整理为可持续生长的内容工程。'],
  ['行动', 'dbs-goal', '目标清晰化', '把模糊目标审计成可以验收的交付物。'],
  ['行动', 'dbs-action', '执行力诊断', '定位执行卡点，并收敛到一个能立刻开始的动作。'],
  ['行动', 'dbs-slowisfast', '慢就是快', '识别正在绕开的关键摩擦与长期资产。'],
  ['行动', 'dbs-deconstruct', '概念拆解', '审查模糊词和未经证明的前提。'],
  ['学习', 'dbs-learning', '交互式学习', '根据反馈逐篇推进一个长期学习课题。'],
  ['学习', 'dbs-good-question', '好问题生成器', '把模糊提问改成可推理、可批评、可验证的问题。'],
  ['决策', 'dbs-decision', '个人决策系统', '建立事实、规律、定格与待解四层记录。'],
  ['决策', 'dbs-save', '保存诊断', '把结论、否决方向和已确认下一步追加存档。'],
  ['决策', 'dbs-restore', '恢复诊断', '从同一项目中恢复上次诊断状态。'],
  ['决策', 'dbs-report', '生成诊断报告', '把多次存档合并成带时间索引的报告。'],
]

const grid = document.querySelector('[data-grid]')
const search = document.querySelector('[data-search]')
const filters = document.querySelector('[data-filters]')
const toast = document.querySelector('[data-toast]')
let active = '全部'

function dshHomeUrl() {
  const current = new URL(window.location.href)
  const configured = document.querySelector('[data-home]')?.getAttribute('data-dsh-home-url')
  if (configured) return new URL(configured, current.origin).href
  const home = new URL('/', current.origin)
  const sources = [current]
  if (document.referrer) {
    try { sources.push(new URL(document.referrer, current.origin)) } catch { /* keep the current URL as the source of truth */ }
  }
  const seen = new Set()
  for (const source of sources) for (const [key, value] of source.searchParams) {
    if (key.startsWith('dsh-desktop-') && !seen.has(`${key}\u0000${value}`)) {
      home.searchParams.append(key, value)
      seen.add(`${key}\u0000${value}`)
    }
  }
  return home.href
}

function copyCommand(name) {
  const command = `/${name} `
  navigator.clipboard.writeText(command).then(() => {
    toast.textContent = `已复制 ${command.trim()}，正在返回 DSH 对话`
    toast.classList.add('show')
    window.setTimeout(() => { window.location.assign(dshHomeUrl()) }, 650)
  }).catch(() => {
    window.prompt('复制这条指令，然后回到 DSH 对话：', command)
  })
}

function render() {
  const query = search.value.trim().toLowerCase()
  const visible = tools.filter(([group, name, title, description]) =>
    (active === '全部' || active === group) && [name, title, description].join(' ').toLowerCase().includes(query))
  grid.innerHTML = visible.map(([group, name, title, description], index) => `
    <article style="--delay:${index * 24}ms">
      <div class="card-head"><span>${group}</span><code>/${name}</code></div>
      <h2>${title}</h2><p>${description}</p>
      <button type="button" data-command="${name}">复制指令并返回对话 <b>↗</b></button>
    </article>`).join('') || '<p class="empty">没有匹配的工具。试试“诊断”或“内容”。</p>'
  grid.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => copyCommand(button.dataset.command)))
}

for (const group of ['全部', ...new Set(tools.map(item => item[0]))]) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = group
  button.className = group === active ? 'active' : ''
  button.addEventListener('click', () => {
    active = group
    filters.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button))
    render()
  })
  filters.appendChild(button)
}
search.addEventListener('input', render)
document.querySelector('[data-home]').addEventListener('click', () => { window.location.assign(dshHomeUrl()) })
render()
