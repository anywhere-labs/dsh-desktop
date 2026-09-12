import { runApprovedCompetitorPriceChangeSimulation } from '../lib/event-core/simulation.js'

const result = await runApprovedCompetitorPriceChangeSimulation()
console.log(JSON.stringify({
  event: result.triggerEvent.eventType,
  caseId: result.caseId,
  routes: result.routes,
  eventTypes: result.eventTypes,
  approvalId: result.approvalId,
  actionId: result.actionId,
  receipt: result.receipt,
  caseStatus: result.finalCaseStatus,
  responsibilityStatus: result.responsibilityStatus,
  ownerId: result.ownerId,
  humanApprovalRequired: result.humanApprovalRequired,
}, null, 2))
