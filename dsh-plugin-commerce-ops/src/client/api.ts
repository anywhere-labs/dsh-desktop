export interface ApprovalView {
  readonly approvalId: string
  readonly action: { readonly actionId: string; readonly actionType: string; readonly riskLevel: string; readonly target: { readonly platform: string; readonly shopId: string } }
  readonly requesterId: string
  readonly status: 'pending' | 'approved' | 'rejected'
}

export interface BoardResponsibility {
  readonly caseId: string
  readonly brandId: string
  readonly title: string
  readonly ownerId: string | null
  readonly caseStatus: 'OPEN' | 'INVESTIGATING' | 'PROPOSED' | 'WAITING_HUMAN' | 'APPROVED' | 'EXECUTING' | 'VERIFYING' | 'CLOSED' | 'BLOCKED'
  readonly responsibilityStatus: 'UNASSIGNED' | 'CLAIMED' | 'IN_PROGRESS' | 'WAITING_INPUT' | 'ESCALATED' | 'ACCEPTED' | 'RELEASED'
  readonly blocked: boolean
  readonly timeout: boolean
}

export interface BoardApproval {
  readonly approvalId: string
  readonly actionId: string
  readonly caseId: string
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly approverId?: string
}

export interface BoardReceipt {
  readonly receiptId: string
  readonly actionId: string
  readonly caseId: string
  readonly status: string
  readonly mode: string
  readonly externalWrite: boolean
}

export interface AgentSpaceSnapshot {
  readonly events: readonly { readonly eventId: string; readonly eventType: string; readonly correlationId: string; readonly brandId: string }[]
  readonly responsibilities: readonly BoardResponsibility[]
  readonly approvals: readonly BoardApproval[]
  readonly receipts: readonly BoardReceipt[]
}

export interface HumanBoardView {
  readonly key: 'all' | 'waiting-confirm' | 'waiting-approval' | 'owned' | 'blocked-timeout'
  readonly label: string
  readonly responsibilities: readonly BoardResponsibility[]
  readonly approvals: readonly BoardApproval[]
}

export type ResponsibilityAction = 'claim' | 'accept' | 'release' | 'transfer'

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`agent space request failed: HTTP ${String(response.status)}`)
  return await response.json() as T
}

export async function getAgentSpaceSnapshot(): Promise<AgentSpaceSnapshot> {
  return json(await fetch('/api/commerce-ops/agent-space'))
}

export async function getHumanBoard(actorId = 'local-user'): Promise<readonly HumanBoardView[]> {
  return json(await fetch('/api/commerce-ops/agent-space/board?actorId=' + encodeURIComponent(actorId)))
}

export async function decideApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<ApprovalView> {
  return json(await fetch(`/api/commerce-ops/approvals/${encodeURIComponent(approvalId)}/${decision}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operatorId: 'local-user' }) }))
}

export async function decideResponsibility(caseId: string, action: ResponsibilityAction, actorId = 'local-user', toUserId?: string): Promise<unknown> {
  return json(await fetch(`/api/commerce-ops/agent-space/responsibilities/${encodeURIComponent(caseId)}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId, ...(toUserId ? { toUserId } : {}) }) }))
}

export async function seedAgentSpaceDemo(): Promise<AgentSpaceSnapshot> {
  return json(await fetch('/api/commerce-ops/agent-space/demo', { method: 'POST' }))
}

export async function runDryRun(input: Record<string, unknown>): Promise<{ readonly executed: false; readonly policy: { readonly status: string; readonly matches: readonly unknown[] } }> {
  const response = await fetch('/api/commerce-ops/dry-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error(`dry run failed: HTTP ${String(response.status)}`)
  return await response.json() as { readonly executed: false; readonly policy: { readonly status: string; readonly matches: readonly unknown[] } }
}

export async function listApprovals(): Promise<readonly ApprovalView[]> {
  return json(await fetch('/api/commerce-ops/approvals'))
}
