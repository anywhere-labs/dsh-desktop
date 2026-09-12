import { useState } from 'react'
import { AgentSpace } from './AgentSpace.js'
import { AgentStudio } from './AgentStudio.js'
import { ApprovalCenter } from './ApprovalCenter.js'
import { VocCenter } from './VocCenter.js'

const navItems = ['经营驾驶舱', '店铺运营', '商品运营', '数据分析', 'VOC场景中心', '异常中心', '规则中心', '审批中心', '执行记录', 'Agent Space', 'Agent Studio']
const metrics = [
  ['GMV', '¥12,880', '+18.4%'],
  ['支付订单', '146', '+11.5%'],
  ['UV', '3,100', '+7.2%'],
  ['支付转化率', '4.70%', '-0.8%'],
  ['客单价', '¥88.22', '+6.1%'],
]

export function CommerceOpsApp(): JSX.Element {
  const [active, setActive] = useState('经营驾驶舱')
  if (active === '审批中心') return <main className="opsShell"><aside className="opsSidebar"><div className="opsBrand"><span className="opsBrandMark">O</span><span className="opsBrandTitle">Commerce Ops</span></div><nav className="opsNav">{navItems.map(item => <button className="opsNavButton" data-active={active === item} onClick={() => setActive(item)} key={item}>{item}</button>)}</nav></aside><section className="opsMain"><ApprovalCenter /></section></main>
  if (active === 'Agent Space') return <main className="opsShell"><aside className="opsSidebar"><div className="opsBrand"><span className="opsBrandMark">O</span><span className="opsBrandTitle">Commerce Ops</span></div><nav className="opsNav">{navItems.map(item => <button className="opsNavButton" data-active={active === item} onClick={() => setActive(item)} key={item}>{item}</button>)}</nav></aside><section className="opsMain"><AgentSpace /></section></main>
  if (active === 'VOC场景中心') return <main className="opsShell"><aside className="opsSidebar"><div className="opsBrand"><span className="opsBrandMark">O</span><span className="opsBrandTitle">Commerce Ops</span></div><nav className="opsNav">{navItems.map(item => <button className="opsNavButton" data-active={active === item} onClick={() => setActive(item)} key={item}>{item}</button>)}</nav></aside><section className="opsMain"><VocCenter /></section></main>
  if (active === 'Agent Studio') return <main className="opsShell"><AgentStudio /></main>
  return <main className="opsShell">
    <aside className="opsSidebar">
      <div className="opsBrand"><span className="opsBrandMark">O</span><span className="opsBrandTitle">Commerce Ops</span></div>
      <nav className="opsNav" aria-label="运营模块">
        {navItems.map((item, index) => <button key={item} className="opsNavButton" data-active={active === item} onClick={() => setActive(item)}>{index === 0 ? '◈' : '·'}<span>{item}</span></button>)}
      </nav>
    </aside>
    <section className="opsMain">
      <header className="opsPageHeader">
        <div><h1 className="opsPageTitle">经营驾驶舱</h1><p className="opsPageSubtitle">Mock 店铺 · 数据更新于 09:32 · 所有建议均带证据</p></div>
        <div className="opsActions"><button className="opsButton">刷新数据</button><button className="opsButton opsButtonPrimary">生成日报</button></div>
      </header>
      <section className="opsMetricGrid" aria-label="核心指标">
        {metrics.map(([label, value, delta]) => <article className="opsMetricCard" key={label}><div className="opsMetricLabel">{label}</div><div className="opsMetricValue">{value}</div><div className="opsMetricDelta">{delta} 较昨日</div></article>)}
      </section>
      <section className="opsPanelGrid">
        <article className="opsPanel"><h2 className="opsPanelTitle">今日经营信号 <span className="opsBadge">3 条待处理</span></h2><div className="opsSignal"><div><strong>转化率出现异常波动</strong><small>较 7 日基线下降 55.3%，可能与库存有关</small></div><button className="opsButton">查看证据</button></div><div className="opsSignal"><div><strong>爆品 SKU-1001 库存不足</strong><small>预计 2.4 天后缺货，活动期风险较高</small></div><button className="opsButton">补货建议</button></div><div className="opsSignal"><div><strong>有 2 个商品可进入潜力款池</strong><small>流量增长但转化仍低于类目基线</small></div><button className="opsButton">查看商品</button></div></article>
        <article className="opsPanel"><h2 className="opsPanelTitle">待审批动作 <span className="opsBadge">2 项</span></h2><div className="opsSignal"><div><strong>商品标题更新</strong><small>低风险 · 3 个 SKU</small></div><button className="opsButton">审批</button></div><div className="opsSignal"><div><strong>满减方案草稿</strong><small>中风险 · 需主管确认</small></div><button className="opsButton">审批</button></div></article>
      </section>
    </section>
  </main>
}
