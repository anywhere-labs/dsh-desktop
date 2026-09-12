import type { EventLedger } from '../event-core/ledger.js'

type GovernanceContext = { readonly ledger: EventLedger; readonly tenantId: string; readonly enterpriseId: string; readonly brandId: string }

export class PermissionService {
  private readonly members = new Map<string, { tenantId: string; roles: readonly string[] }>()
  constructor(private readonly context?: GovernanceContext) { this.rehydrate() }
  registerMember(userId: string, tenantId: string, roles: readonly string[], options: { readonly persist?: boolean } = {}): void {
    this.members.set(`${tenantId}:${userId}`, { tenantId, roles })
    if (this.context && options.persist !== false) { const now = new Date().toISOString(); void this.context.ledger.append({ eventId: `membership.role.granted:${tenantId}:${userId}:${[...roles].sort().join(',')}`, eventType: 'membership.role.granted', tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'member', id: userId }, payload: { userId, tenantId, roles }, source: { type: 'permission_service', ref: userId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: `member:${tenantId}:${userId}`, causationId: null, schemaVersion: 'event.v1' }) }
  }
  can(userId: string, tenantId: string, permission: string): boolean {
    const member = this.members.get(`${tenantId}:${userId}`)
    return Boolean(member && (member.roles.includes('owner') || member.roles.includes('admin') || member.roles.includes(permission)))
  }
  assertCan(userId: string, tenantId: string, permission: string): void { if (!this.can(userId, tenantId, permission)) throw new Error(`permission_denied:${permission}`) }
  private rehydrate(): void {
    for (const event of this.context?.ledger.list() ?? []) if (event.eventType === 'membership.role.granted' && Array.isArray(event.payload.roles) && typeof event.payload.userId === 'string' && typeof event.payload.tenantId === 'string') this.members.set(`${event.payload.tenantId}:${event.payload.userId}`, { tenantId: event.payload.tenantId, roles: event.payload.roles.filter((role): role is string => typeof role === 'string') })
  }
}

export interface ResponsibilityRecord { readonly caseId: string; readonly ownerId: string; readonly status: 'UNASSIGNED' | 'CLAIMED' | 'ACCEPTED' | 'RELEASED'; readonly assignedAt: string }

type ResponsibilityAction = 'claim' | 'accept' | 'release' | 'transfer'

export class ResponsibilityService {
  private readonly records = new Map<string, ResponsibilityRecord>()
  constructor(private readonly context: GovernanceContext, private readonly permissions: PermissionService) { this.rehydrate() }

  claim(caseId: string, actorId: string): ResponsibilityRecord { return this.apply(caseId, actorId, 'claim', actorId) }
  accept(caseId: string, actorId: string): ResponsibilityRecord { return this.apply(caseId, actorId, 'accept', actorId) }
  release(caseId: string, ownerId: string): ResponsibilityRecord { return this.apply(caseId, ownerId, 'release', ownerId) }
  transfer(caseId: string, fromUserId: string, toUserId: string): ResponsibilityRecord { return this.apply(caseId, fromUserId, 'transfer', toUserId) }

  private apply(caseId: string, actorId: string, action: ResponsibilityAction, targetOwnerId: string): ResponsibilityRecord {
    this.permissions.assertCan(actorId, this.context.tenantId, action === 'transfer' ? 'transfer_responsibility' : action === 'accept' ? 'accept_responsibility' : 'claim_responsibility')
    const status: ResponsibilityRecord['status'] = action === 'release' ? 'RELEASED' : action === 'accept' ? 'ACCEPTED' : 'CLAIMED'
    const record: ResponsibilityRecord = { caseId, ownerId: targetOwnerId, status, assignedAt: new Date().toISOString() }
    this.records.set(caseId, record)
    const eventType = action === 'claim' ? 'responsibility.claimed' : action === 'accept' ? 'responsibility.accepted' : action === 'release' ? 'responsibility.released' : 'responsibility.transferred'
    this.emit(eventType, caseId, { action, actorId, toUserId: action === 'transfer' ? targetOwnerId : undefined, caseId })
    return record
  }
  get(caseId: string): ResponsibilityRecord | undefined { return this.records.get(caseId) }
  private rehydrate(): void { for (const event of this.context.ledger.list() ) if (event.eventType === 'responsibility.transferred' && typeof event.payload.caseId === 'string' && typeof event.payload.toUserId === 'string') this.records.set(event.payload.caseId, { caseId: event.payload.caseId, ownerId: event.payload.toUserId, status: 'CLAIMED', assignedAt: event.occurredAt }) }

  private emit(eventType: string, caseId: string, payload: Record<string, unknown>): void {
    const now = new Date().toISOString()
    void this.context.ledger.append({ eventId: `${eventType}:${caseId}:${now}`, eventType, tenantId: this.context.tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'case', id: caseId }, payload, source: { type: 'responsibility_service', ref: caseId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: caseId, causationId: null, schemaVersion: 'event.v1' })
  }
}

export interface SlaRecord { readonly caseId: string; readonly ownerId: string; readonly dueAt: string; readonly status: 'OPEN' | 'ESCALATED' | 'MET' }

export class SlaService {
  private readonly records = new Map<string, SlaRecord>()
  constructor(private readonly context: GovernanceContext, private readonly notifications: NotificationService) { this.rehydrate() }
  start(caseId: string, ownerId: string, durationMs: number, now = new Date()): SlaRecord { const record = { caseId, ownerId, dueAt: new Date(now.getTime() + durationMs).toISOString(), status: 'OPEN' as const }; this.records.set(caseId, record); this.emit('sla.started', record); return record }
  evaluate(now = new Date()): readonly SlaRecord[] { const escalated: SlaRecord[] = []; for (const current of this.records.values()) if (current.status === 'OPEN' && new Date(current.dueAt) <= now) { const next = { ...current, status: 'ESCALATED' as const }; this.records.set(current.caseId, next); escalated.push(next); this.emit('sla.escalated', next); this.notifications.send({ recipientId: current.ownerId, kind: 'sla.escalation', caseId: current.caseId, message: `Case ${current.caseId} 已超过 SLA` }) } return escalated }
  list(): readonly SlaRecord[] { return [...this.records.values()] }
  private emit(eventType: 'sla.started' | 'sla.escalated', record: SlaRecord): void { const now = new Date().toISOString(); void this.context.ledger.append({ eventId: `${eventType}:${record.caseId}:${record.dueAt}`, eventType, tenantId: this.context.tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'case', id: record.caseId }, payload: { ...record }, source: { type: 'sla_service', ref: record.caseId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: record.caseId, causationId: null, schemaVersion: 'event.v1' }) }
  private rehydrate(): void { for (const event of this.context.ledger.list()) if ((event.eventType === 'sla.started' || event.eventType === 'sla.escalated') && typeof event.payload.caseId === 'string' && typeof event.payload.ownerId === 'string' && typeof event.payload.dueAt === 'string') this.records.set(event.payload.caseId, { caseId: event.payload.caseId, ownerId: event.payload.ownerId, dueAt: event.payload.dueAt, status: event.eventType === 'sla.escalated' ? 'ESCALATED' : 'OPEN' }) }
}

export interface NotificationRecord { readonly notificationId: string; readonly recipientId: string; readonly kind: string; readonly caseId: string; readonly message: string; readonly status: 'queued' }

export class NotificationService {
  private readonly records: NotificationRecord[] = []
  constructor(private readonly context: GovernanceContext) { this.rehydrate() }
  send(input: Omit<NotificationRecord, 'notificationId' | 'status'>): NotificationRecord { const record = { ...input, notificationId: `notification_${this.records.length + 1}`, status: 'queued' as const }; this.records.push(record); const now = new Date().toISOString(); void this.context.ledger.append({ eventId: `notification.requested:${record.notificationId}`, eventType: 'notification.requested', tenantId: this.context.tenantId, enterpriseId: this.context.enterpriseId, brandId: this.context.brandId, subject: { type: 'notification', id: record.notificationId }, payload: { ...record }, source: { type: 'notification_service', ref: record.notificationId }, evidenceRefs: [], confidence: 1, occurredAt: now, observedAt: now, correlationId: record.caseId, causationId: null, schemaVersion: 'event.v1' }); return record }
  list(): readonly NotificationRecord[] { return [...this.records] }
  private rehydrate(): void { for (const event of this.context.ledger.list()) if (event.eventType === 'notification.requested' && typeof event.payload.notificationId === 'string' && typeof event.payload.recipientId === 'string' && typeof event.payload.kind === 'string' && typeof event.payload.caseId === 'string' && typeof event.payload.message === 'string') this.records.push({ notificationId: event.payload.notificationId, recipientId: event.payload.recipientId, kind: event.payload.kind, caseId: event.payload.caseId, message: event.payload.message, status: 'queued' }) }
}
