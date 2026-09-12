import type { TaskStatus } from './state-machine.ts'

/** A local or provider-backed input used by a video generation task. */
export type AssetKind =
  | 'SOURCE_VIDEO'
  | 'REFERENCE_IMAGE'
  | 'REFERENCE_VIDEO'
  | 'AUDIO'
  | 'MOTION'
  | 'MASK'
  | 'CAPTION'

export interface AssetManifestEntry {
  readonly assetId: string
  readonly kind: AssetKind
  /** The URI is an opaque reference; this contract never reads or uploads it. */
  readonly uri: string
  readonly mimeType: string
  readonly authorized: boolean
  readonly byteLength?: number
  readonly sha256?: string
  readonly label?: string
}

export interface AssetManifest {
  readonly taskId: string
  readonly assets: readonly AssetManifestEntry[]
}

export interface VideoTaskTransition {
  readonly from: TaskStatus
  readonly to: TaskStatus
  readonly changedAt: string
}

export interface VideoTask {
  readonly taskId: string
  readonly status: TaskStatus
  readonly history: readonly VideoTaskTransition[]
  readonly revision?: string
  readonly failureReason?: string
}

export interface VideoOutputSpec {
  readonly format: 'mp4' | 'webm' | 'mov'
  readonly width: number
  readonly height: number
  readonly durationSeconds?: number
  readonly frameRate?: number
}

export interface CostQuote {
  readonly quoteId: string
  readonly amount: number
  readonly currency: string
  readonly expiresAt?: string
}

export interface CostConfirmation {
  readonly quoteId: string
  readonly amount: number
  readonly currency: string
  readonly confirmedBy: string
  readonly confirmedAt: string
  readonly approvalId: string
}

export interface GenerationAuthorization {
  readonly approved: boolean
  readonly approvalId: string
  readonly scope: 'task' | 'assets' | 'workspace'
}

export interface GenerationRequest {
  readonly taskId: string
  readonly idempotencyKey: string
  readonly providerId: string
  readonly model: string
  readonly prompt: string
  readonly assetManifest: AssetManifest
  readonly output: VideoOutputSpec
  readonly quote: CostQuote
  readonly authorization: GenerationAuthorization
}

export type HookPhase =
  | 'BEFORE_ANALYSIS'
  | 'AFTER_ANALYSIS'
  | 'BEFORE_GENERATION'
  | 'AFTER_GENERATION'
  | 'BEFORE_QA'
  | 'AFTER_QA'

export interface HookDefinition {
  readonly hookId: string
  readonly phase: HookPhase
  readonly enabled: boolean
  readonly inputSchema: string
  readonly outputSchema: string
}

export interface HotspotSignal {
  readonly signalId: string
  readonly source: string
  readonly topic: string
  readonly score: number
  readonly observedAt: string
  readonly evidence: readonly string[]
}

export interface SkillDescriptor {
  readonly skillId: string
  readonly name: string
  readonly version: string
  readonly capabilities: readonly string[]
}

export interface AgentDescriptor {
  readonly agentId: string
  readonly name: string
  readonly role: string
  readonly skillIds: readonly string[]
}
