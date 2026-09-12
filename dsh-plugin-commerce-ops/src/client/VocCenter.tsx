import { useState } from 'react'
import { runVocDemo } from './api.js'

type VocDemoResult = {
  readonly records: readonly { readonly vocId: string; readonly rawText: string }[]
  readonly sceneInstances: readonly { readonly instanceId: string; readonly status: string; readonly confidence: number }[]
  readonly cluster: { readonly clusterId: string; readonly signalCount: number; readonly topPain: string } | null
  readonly insight: { readonly conclusion: string; readonly recommendations: readonly string[] } | null
  readonly eventTypes: readonly string[]
  readonly final: { readonly sceneStatus: string; readonly caseStatus: string; readonly taskStatus: string; readonly receiptStatus: string | null; readonly outcomeStatus: string | null; readonly retroRecorded: boolean; readonly blockedReason: string | null; readonly externalWrite: false }
}

export function VocCenter(): JSX.Element {
  const [result, setResult] = useState<VocDemoResult | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (scenario: 'normal' | 'low_evidence'): Promise<void> => {
    setWorking(true)
    try { setResult(await runVocDemo(scenario) as VocDemoResult); setError(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setWorking(false) }
  }
  return <section className="opsAgentSpace">
    <header className="opsPageHeader"><div><h1 className="opsPageTitle">VOC 场景中心</h1><p className="opsPageSubtitle">VOC 3.0 · Scene Dictionary → Instance → Cluster · 本地验证模式</p></div><div className="opsActions"><button className="opsButton opsButtonPrimary" onClick={() => void run('normal')} disabled={working}>运行正常链路</button><button className="opsButton" onClick={() => void run('low_evidence')} disabled={working}>运行证据不足</button></div></header>
    {error && <p className="opsError">{error}</p>}
    {!result && <article className="opsPanel"><h2 className="opsPanelTitle">尚未运行</h2><p className="opsPageSubtitle">点击上方按钮载入本地 VOC Fixture；不会访问外部数据源。</p></article>}
    {result && <section className="opsSpaceGrid">
      <article className="opsPanel"><h2 className="opsPanelTitle">原始声音 <span className="opsBadge">{result.records.length}</span></h2>{result.records.map(record => <div className="opsSpaceRow" key={record.vocId}><div><strong>{record.vocId}</strong><small>{record.rawText}</small></div><span className="opsStatus" data-status="success">已留证</span></div>)}</article>
      <article className="opsPanel"><h2 className="opsPanelTitle">场景实例 <span className="opsBadge">{result.sceneInstances.length}</span></h2>{result.sceneInstances.map(scene => <div className="opsSpaceRow" key={scene.instanceId}><div><strong>{scene.instanceId}</strong><small>置信度 {scene.confidence}</small></div><span className="opsStatus" data-status={scene.status === 'APPROVED' ? 'success' : scene.status === 'BLOCKED' ? 'danger' : 'warning'}>{scene.status}</span></div>)}</article>
      <article className="opsPanel"><h2 className="opsPanelTitle">场景聚类与洞察</h2>{result.cluster && <p><strong>{result.cluster.clusterId}</strong> · {result.cluster.signalCount} 条信号 · {result.cluster.topPain}</p>}{result.insight && <><p>{result.insight.conclusion}</p><ul>{result.insight.recommendations.map(item => <li key={item}>{item}</li>)}</ul></>}</article>
      <article className="opsPanel"><h2 className="opsPanelTitle">协同状态</h2><p>场景：{result.final.sceneStatus} · Case：{result.final.caseStatus} · Task：{result.final.taskStatus}</p><p>Receipt：{result.final.receiptStatus ?? '无'} · Outcome：{result.final.outcomeStatus ?? '无'} · Retro：{result.final.retroRecorded ? '已记录' : '未记录'}</p><p>阻塞原因：{result.final.blockedReason ?? '无'} · 外部写入：否</p></article>
      <article className="opsPanel"><h2 className="opsPanelTitle">事件流 <span className="opsBadge">{result.eventTypes.length}</span></h2><p className="opsPageSubtitle">{result.eventTypes.join(' → ')}</p></article>
    </section>}
  </section>
}

