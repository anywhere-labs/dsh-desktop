import type { VideoTask, VideoTaskTransition } from './contracts.ts'

export const TaskStatus = {
  DRAFT: 'DRAFT',
  ANALYZING: 'ANALYZING',
  READY: 'READY',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  QUEUED: 'QUEUED',
  GENERATING: 'GENERATING',
  POST_PROCESSING: 'POST_PROCESSING',
  QA_RUNNING: 'QA_RUNNING',
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus]

export const TASK_STATUSES: readonly TaskStatus[] = Object.freeze([
  TaskStatus.DRAFT,
  TaskStatus.ANALYZING,
  TaskStatus.READY,
  TaskStatus.AWAITING_APPROVAL,
  TaskStatus.QUEUED,
  TaskStatus.GENERATING,
  TaskStatus.POST_PROCESSING,
  TaskStatus.QA_RUNNING,
  TaskStatus.COMPLETED,
  TaskStatus.PARTIAL,
  TaskStatus.FAILED,
])

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  DRAFT: ['ANALYZING'],
  ANALYZING: ['READY', 'FAILED'],
  READY: ['AWAITING_APPROVAL', 'FAILED'],
  AWAITING_APPROVAL: ['QUEUED', 'READY', 'FAILED'],
  QUEUED: ['GENERATING', 'FAILED'],
  GENERATING: ['POST_PROCESSING', 'PARTIAL', 'FAILED'],
  POST_PROCESSING: ['QA_RUNNING', 'PARTIAL', 'FAILED'],
  QA_RUNNING: ['COMPLETED', 'PARTIAL', 'FAILED'],
  COMPLETED: [],
  PARTIAL: ['AWAITING_APPROVAL', 'QUEUED', 'FAILED'],
  FAILED: ['DRAFT'],
}

export class InvalidTaskTransitionError extends Error {
  readonly from: TaskStatus
  readonly to: TaskStatus

  constructor(from: TaskStatus, to: TaskStatus) {
    super(`illegal task transition: ${from} -> ${to}`)
    this.name = 'InvalidTaskTransitionError'
    this.from = from
    this.to = to
  }
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function transitionStatus(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransitionTask(from, to)) throw new InvalidTaskTransitionError(from, to)
  return to
}

export function transitionTask(
  task: VideoTask,
  to: TaskStatus,
  changedAt: string,
): VideoTask {
  transitionStatus(task.status, to)
  const transition: VideoTaskTransition = {
    from: task.status,
    to,
    changedAt,
  }
  return {
    ...task,
    status: to,
    history: [...task.history, transition],
  }
}
