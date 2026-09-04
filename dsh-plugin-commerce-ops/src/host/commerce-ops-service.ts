import { MockCommerceConnector, type ShopMetricsResult } from '../connectors/mock.js'
import { SkillRuntime } from '../skills/runtime.js'
import { RuleEngine, type ForbiddenTermRule, type RuleEvaluation } from '../policies/rule-engine.js'
import { ApprovalService, type ApprovalRecord } from '../approvals/service.js'
import { BrowserCapture, type CapturePage } from '../connectors/browser-capture.js'
import { normalizeShopMetric } from '../connectors/field-mapping.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { EventLedger } from '../event-core/ledger.js'
import { JsonlEventStore, PartitionedJsonlEventStore } from '../event-core/persistence.js'
import { buildAgentSpaceSnapshot, getHumanBoard, type AgentSpaceSnapshot, type HumanBoardView, type BoardViewKey } from '../event-core/space.js'
import { runApprovedCompetitorPriceChangeSimulation } from '../event-core/simulation.js'
import { HumanDecisionService, type HumanDecision } from '../decision/service.js'
import { NotificationService, PermissionService, ResponsibilityService, SlaService, type ResponsibilityRecord, type SlaRecord, type NotificationRecord } from '../governance/service.js'

export interface CommerceOpsRuntime {
  readonly state: 'READY'
  readonly mode: 'mock'
  readonly connector: 'mock'
}

export class CommerceOpsService {
  readonly runtime: CommerceOpsRuntime = { state: 'READY', mode: 'mock', connector: 'mock' }
  private readonly connector = new MockCommerceConnector()
  private readonly skillRuntime = new SkillRuntime()
  private readonly approvalService: ApprovalService
  private readonly ruleEngine = new RuleEngine([{ ruleId: 'content.absolute.001', riskLevel: 'L3', field: 'title', forbidden: ['绝对有效', '第一', '顶级'] }])
  private readonly browserCapture = new BrowserCapture()
  private readonly eventLedger: EventLedger
  private readonly humanDecisionService: HumanDecisionService
  private readonly permissionService: PermissionService
  private readonly responsibilityService: ResponsibilityService
  private readonly notificationService: NotificationService
  private readonly slaService: SlaService

  constructor(options: { readonly eventLogPath?: string; readonly eventLogDir?: string } = {}) {
    const store = options.eventLogPath
      ? new JsonlEventStore(options.eventLogPath)
      : new PartitionedJsonlEventStore(options.eventLogDir ?? join(homedir(), '.commerce-ops', 'events'))
    this.eventLedger = new EventLedger(store)
    const context = { ledger: this.eventLedger, tenantId: 'tenant_demo_group', enterpriseId: 'enterprise_demo_a', brandId: 'brand_demo_alpha' }
    this.approvalService = new ApprovalService(context)
    this.humanDecisionService = new HumanDecisionService(context)
    this.permissionService = new PermissionService(context)
    this.permissionService.registerMember('human_brand_owner_001', context.tenantId, ['owner', 'approve_action', 'transfer_responsibility', 'accept_responsibility'], { persist: false })
    this.permissionService.registerMember('local-user', context.tenantId, ['approve_action', 'claim_responsibility', 'accept_responsibility', 'transfer_responsibility'], { persist: false })
    this.notificationService = new NotificationService(context)
    this.responsibilityService = new ResponsibilityService(context, this.permissionService)
    this.slaService = new SlaService(context, this.notificationService)
  }

  getShopMetrics(shopId: string, from: string, to: string): Promise<ShopMetricsResult> {
    return this.connector.getShopMetrics({ shopId, from, to })
  }

  async runDailyReport(shopId: string, date: string): Promise<{
    readonly status: 'completed'
    readonly report: { readonly metrics: readonly ShopMetricsResult['metrics'][number][]; readonly evidenceIds: readonly string[] }
    readonly trace: { readonly skillId: string; readonly runId: string }
  }> {
    const result = await this.skillRuntime.run({
      skillId: 'shop.daily_report',
      input: { shopId, date },
      steps: [{
        id: 'collect',
        run: async input => {
          const metrics = await this.getShopMetrics(String(input.shopId), String(input.date), String(input.date))
          return { ...input, metrics: metrics.metrics }
        },
      }, {
        id: 'render',
        run: async input => ({ ...input, report: { metrics: input.metrics, evidenceIds: (input.metrics as ShopMetricsResult['metrics']).map(metric => metric.source.evidenceId) } }),
      }],
    })
    return { status: 'completed', report: result.output.report as { metrics: readonly ShopMetricsResult['metrics'][number][]; evidenceIds: readonly string[] }, trace: { skillId: result.skillId, runId: result.runId } }
  }

  dryRun(input: Record<string, unknown>): { readonly executed: false; readonly policy: RuleEvaluation } {
    return { executed: false, policy: this.ruleEngine.evaluate(input) }
  }

  createApproval(action: Parameters<ApprovalService['create']>[0], requesterId: string): ApprovalRecord {
    return this.approvalService.create(action, requesterId)
  }

  listApprovals(): readonly ApprovalRecord[] {
    return this.approvalService.list()
  }

  approve(approvalId: string, approverId: string): ApprovalRecord {
    this.permissionService.assertCan(approverId, 'tenant_demo_group', 'approve_action')
    return this.approvalService.approve(approvalId, approverId)
  }

  reject(approvalId: string, approverId: string): ApprovalRecord {
    this.permissionService.assertCan(approverId, 'tenant_demo_group', 'approve_action')
    return this.approvalService.reject(approvalId, approverId)
  }

  assertExecutable(action: Parameters<ApprovalService['assertExecutable']>[0]): void {
    this.approvalService.assertExecutable(action)
  }

  getAgentSpaceSnapshot(tenantId?: string): AgentSpaceSnapshot {
    return buildAgentSpaceSnapshot(this.eventLedger.list(tenantId ? { tenantId } : undefined))
  }

  recordHumanDecision(decision: HumanDecision): ReturnType<HumanDecisionService['record']> { return this.humanDecisionService.record(decision) }
  transferResponsibility(caseId: string, fromUserId: string, toUserId: string): ResponsibilityRecord { return this.responsibilityService.transfer(caseId, fromUserId, toUserId) }
  claimResponsibility(caseId: string, actorId: string): ResponsibilityRecord { return this.responsibilityService.claim(caseId, actorId) }
  acceptResponsibility(caseId: string, actorId: string): ResponsibilityRecord { return this.responsibilityService.accept(caseId, actorId) }
  releaseResponsibility(caseId: string, ownerId: string): ResponsibilityRecord { return this.responsibilityService.release(caseId, ownerId) }
  startSla(caseId: string, ownerId: string, durationMs: number, now?: Date): SlaRecord { return this.slaService.start(caseId, ownerId, durationMs, now) }
  evaluateSla(now?: Date): readonly SlaRecord[] { return this.slaService.evaluate(now) }
  listNotifications(): readonly NotificationRecord[] { return this.notificationService.list() }

  getHumanBoard(actorId: string): HumanBoardView[] {
    return getHumanBoard(this.getAgentSpaceSnapshot(), actorId)
  }

  getBoardView(actorId: string, key: BoardViewKey): HumanBoardView {
    const view = this.getHumanBoard(actorId).find(item => item.key === key)
    if (!view) throw new Error(`board_view_not_found:${key}`)
    return view
  }

  async seedAgentSpaceDemo(): Promise<AgentSpaceSnapshot> {
    const result = await runApprovedCompetitorPriceChangeSimulation()
    // Idempotent: re-appending the same demo events must not grow the ledger.
    const existing = this.eventLedger.list({ tenantId: result.triggerEvent.tenantId }).map(event => event.eventId)
    const seen = new Set(existing)
    for (const event of result.events) {
      if (seen.has(event.eventId)) continue
      await this.eventLedger.append(event)
      seen.add(event.eventId)
    }
    return this.getAgentSpaceSnapshot(result.triggerEvent.tenantId)
  }

  async captureBrowserPage(page: CapturePage, options: { readonly userAuthorized: boolean; readonly shopId: string; readonly period: { readonly from: string; readonly to: string } }): Promise<{ readonly metrics: readonly import('../contracts/index.js').MetricSnapshot[]; readonly links: readonly string[]; readonly evidence: { readonly kind: 'browser-visible-dom'; readonly capturedAt: string } }> {
    const captured = await this.browserCapture.capture(page, { userAuthorized: options.userAuthorized })
    const metrics = captured.metrics.map(item => normalizeShopMetric({ ...item, evidenceId: `browser:${options.shopId}:${captured.source.capturedAt}:${item.name}` }, { platform: 'browser', shopId: options.shopId, period: options.period }))
    return { metrics, links: captured.links, evidence: captured.source }
  }
}
