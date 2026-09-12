import { useEffect, useState } from 'react'
import { decideApproval, listApprovals, type ApprovalView } from './api.js'

export function ApprovalCenter(): JSX.Element {
  const [approvals, setApprovals] = useState<readonly ApprovalView[]>([])
  const [error, setError] = useState<string>()
  const refresh = async (): Promise<void> => { try { setApprovals(await listApprovals()); setError(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }
  useEffect(() => { void refresh() }, [])
  return <section className="opsPanel opsApprovalCenter"><h2 className="opsPanelTitle">审批中心 <span className="opsBadge">{approvals.filter(item => item.status === 'pending').length} 待处理</span></h2>{error && <p className="opsError">{error}</p>}{approvals.length === 0 && <p className="opsPageSubtitle">暂无审批动作</p>}{approvals.map(item => <article className="opsApprovalRow" key={item.approvalId}><div><strong>{item.action.actionType}</strong><small>{item.action.target.platform} · {item.action.target.shopId} · {item.action.riskLevel}</small></div><div className="opsActions">{item.status === 'pending' ? <><button className="opsButton" onClick={() => void decideApproval(item.approvalId, 'reject').then(refresh)}>拒绝</button><button className="opsButton opsButtonPrimary" onClick={() => void decideApproval(item.approvalId, 'approve').then(refresh)}>批准</button></> : <span className="opsStatus" data-status={item.status === 'approved' ? 'success' : 'danger'}>{item.status}</span>}</div></article>)}</section>
}
