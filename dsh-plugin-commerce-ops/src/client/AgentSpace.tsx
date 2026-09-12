import { useEffect, useState } from 'react'
import { decideApproval, decideResponsibility, getAgentSpaceSnapshot, getHumanBoard, runInventoryAlertDemo, runPlatformSandboxDemo, seedAgentSpaceDemo, type AgentSpaceSnapshot, type HumanBoardView, type ResponsibilityAction } from './api.js'

type ViewKey = HumanBoardView['key']
const viewLabels: Record<ViewKey, string> = {
  all: '全部经营事件',
  'waiting-confirm': '待我确认',
  'waiting-approval': '待我审核',
  owned: '我负责',
  'blocked-timeout': '被阻塞超时',
}

export function AgentSpace(): JSX.Element {
  const [snapshot, setSnapshot] = useState<AgentSpaceSnapshot>({ events: [], responsibilities: [], approvals: [], receipts: [] })
  const [boards, setBoards] = useState<readonly HumanBoardView[]>([])
  const [active, setActive] = useState<ViewKey>('all')
  const [error, setError] = useState<string>()
  const [working, setWorking] = useState(false)
  const [sandboxEnvironment, setSandboxEnvironment] = useState<'demo' | 'sandbox' | 'production'>('demo')

  const refresh = async (): Promise<void> => {
    setWorking(true)
    try {
      const [space, board] = await Promise.all([getAgentSpaceSnapshot(), getHumanBoard()])
      setSnapshot(space)
      setBoards(board)
      setError(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setWorking(false) }
  }
  useEffect(() => { void refresh() }, [])
  const runDemo = async (): Promise<void> => { setWorking(true); try { await seedAgentSpaceDemo(); await refresh(); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setWorking(false) } }
  const runInventoryDemo = async (): Promise<void> => { setWorking(true); try { await runInventoryAlertDemo('normal'); await refresh(); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setWorking(false) } }
  const runPlatformDemo = async (platformId: 'douyin' | 'xiaohongshu'): Promise<void> => { setWorking(true); try { await runPlatformSandboxDemo(platformId, sandboxEnvironment); await refresh(); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setWorking(false) } }
  const act = async (caseId: string, action: ResponsibilityAction, toUserId?: string): Promise<void> => { setWorking(true); try { await decideResponsibility(caseId, action, 'local-user', toUserId); await refresh(); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setWorking(false) } }
  const decide = async (approvalId: string, decision: 'approve' | 'reject'): Promise<void> => { setWorking(true); try { await decideApproval(approvalId, decision); await refresh(); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setWorking(false) } }

  const board = boards.find(item => item.key === active) ?? boards[0]
  const responsibilities = board?.responsibilities ?? []
  const approvals = board?.approvals ?? []

  return <section className="opsAgentSpace">
    <header className="opsPageHeader">
      <div><h1 className="opsPageTitle">Agent Space</h1><p className="opsPageSubtitle">事件驱动的企业协同空间 · 本地 JSONL 事件账本</p></div>
      <div className="opsActions">
        <button className="opsButton" onClick={() => void refresh()} disabled={working}>刷新</button>
        <button className="opsButton" onClick={() => void runDemo()} disabled={working}>载入竞品降价演示</button>
        <button className="opsButton opsButtonPrimary" onClick={() => void runInventoryDemo()} disabled={working}>载入库存预警演示</button>
        <select className="opsSelect" aria-label="平台演示环境" value={sandboxEnvironment} onChange={event => setSandboxEnvironment(event.target.value as typeof sandboxEnvironment)} disabled={working}><option value="demo">Demo 仅演示</option><option value="sandbox">Sandbox 本地模拟</option><option value="production">Production（安全阻断）</option></select>
        <button className="opsButton" onClick={() => void runPlatformDemo('douyin')} disabled={working}>抖音预览</button>
        <button className="opsButton" onClick={() => void runPlatformDemo('xiaohongshu')} disabled={working}>小红书预览</button>
      </div>
    </header>
    {error && <p className="opsError">{error}</p>}
    <nav className="opsBoardTabs" aria-label="人看板入口">
      {Object.entries(viewLabels).map(([key, label]) => <button key={key} className="opsBoardTab" data-active={active === key} onClick={() => setActive(key as ViewKey)}>{label}<span className="opsBadge">{countFor(boards, key as ViewKey)}</span></button>)}
    </nav>
    <section className="opsSpaceGrid">
      <article className="opsPanel"><h2 className="opsPanelTitle">责任 <span className="opsBadge">{responsibilities.length}</span></h2>{responsibilities.length === 0 ? <p className="opsPageSubtitle">当前视图暂无责任事项</p> : responsibilities.map(item => <div className="opsSpaceRow" key={item.caseId}><div><strong>{item.title}</strong><small>{item.caseId} · Owner：{item.ownerId ?? '未分配'} · {item.caseStatus} · {item.responsibilityStatus}</small>{item.blocked && <em className="opsInlineWarn">被阻塞</em>}{item.timeout && <em className="opsInlineWarn">超时</em>}</div><div className="opsActions"><button className="opsButton" onClick={() => void act(item.caseId, 'claim')} disabled={working}>接管</button><button className="opsButton" onClick={() => void act(item.caseId, 'accept')} disabled={working}>接受</button><button className="opsButton" onClick={() => void act(item.caseId, 'release')} disabled={working}>释放</button><button className="opsButton" onClick={() => void act(item.caseId, 'transfer', 'human_brand_owner_001')} disabled={working}>转派</button></div></div>)}</article>
      <article className="opsPanel"><h2 className="opsPanelTitle">审批 <span className="opsBadge">{approvals.length}</span></h2>{approvals.length === 0 ? <p className="opsPageSubtitle">当前视图无待审批动作</p> : approvals.map(item => <div className="opsSpaceRow" key={item.approvalId}><div><strong>{item.actionId}</strong><small>{item.approvalId} · {item.caseId} · {item.approverId ?? '等待人工'}</small></div><div className="opsActions">{item.status === 'pending' ? <><button className="opsButton" onClick={() => void decide(item.approvalId, 'reject')} disabled={working}>驳回</button><button className="opsButton opsButtonPrimary" onClick={() => void decide(item.approvalId, 'approve')} disabled={working}>批准</button></> : <span className="opsStatus" data-status={item.status === 'approved' ? 'success' : 'danger'}>{item.status}</span>}</div></div>)}</article>
      <article className="opsPanel"><h2 className="opsPanelTitle">事件 <span className="opsBadge">{snapshot.events.length}</span></h2>{snapshot.events.length === 0 ? <p className="opsPageSubtitle">暂无事件，点击右上角载入演示</p> : snapshot.events.map(event => <div className="opsSpaceRow" key={event.eventId}><div><strong>{event.eventType}</strong><small>{event.brandId} · {event.correlationId}</small></div><span className="opsStatus" data-status="success">已记录</span></div>)}</article>
      <article className="opsPanel"><h2 className="opsPanelTitle">回执 <span className="opsBadge">{snapshot.receipts.length}</span></h2>{snapshot.receipts.length === 0 ? <p className="opsPageSubtitle">暂无回执</p> : snapshot.receipts.map(item => <div className="opsSpaceRow" key={item.receiptId}><div><strong>{item.actionId}</strong><small>{item.receiptId} · {item.mode}</small></div><span className="opsStatus" data-status="success">{item.status} · {item.externalWrite ? '外部写入' : '无外部写入'}</span></div>)}</article>
    </section>
  </section>
}

function countFor(boards: readonly HumanBoardView[], key: ViewKey): number {
  const view = boards.find(item => item.key === key)
  if (!view) return 0
  return view.responsibilities.length + view.approvals.length
}
