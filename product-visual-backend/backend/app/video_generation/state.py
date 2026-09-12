from __future__ import annotations

from enum import StrEnum


class ReplicaTaskStatus(StrEnum):
    DRAFT = "DRAFT"
    ANALYZING = "ANALYZING"
    AWAITING_SELECTION = "AWAITING_SELECTION"
    READY = "READY"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    QUEUED = "QUEUED"
    TRACKING = "TRACKING"
    MATTING = "MATTING"
    COMPOSITING = "COMPOSITING"
    AUDIO_REMUX = "AUDIO_REMUX"
    QA_RUNNING = "QA_RUNNING"
    COMPLETED = "COMPLETED"
    REPAIR_REQUIRED = "REPAIR_REQUIRED"
    FAILED = "FAILED"


_TRANSITIONS: dict[ReplicaTaskStatus, frozenset[ReplicaTaskStatus]] = {
    ReplicaTaskStatus.DRAFT: frozenset({ReplicaTaskStatus.ANALYZING, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.ANALYZING: frozenset({ReplicaTaskStatus.AWAITING_SELECTION, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.AWAITING_SELECTION: frozenset({ReplicaTaskStatus.READY, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.READY: frozenset({ReplicaTaskStatus.AWAITING_APPROVAL, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.AWAITING_APPROVAL: frozenset({ReplicaTaskStatus.QUEUED, ReplicaTaskStatus.READY, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.QUEUED: frozenset({ReplicaTaskStatus.TRACKING, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.TRACKING: frozenset({ReplicaTaskStatus.MATTING, ReplicaTaskStatus.REPAIR_REQUIRED, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.MATTING: frozenset({ReplicaTaskStatus.COMPOSITING, ReplicaTaskStatus.REPAIR_REQUIRED, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.COMPOSITING: frozenset({ReplicaTaskStatus.AUDIO_REMUX, ReplicaTaskStatus.REPAIR_REQUIRED, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.AUDIO_REMUX: frozenset({ReplicaTaskStatus.QA_RUNNING, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.QA_RUNNING: frozenset({ReplicaTaskStatus.COMPLETED, ReplicaTaskStatus.REPAIR_REQUIRED, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.REPAIR_REQUIRED: frozenset({ReplicaTaskStatus.AWAITING_APPROVAL, ReplicaTaskStatus.QUEUED, ReplicaTaskStatus.FAILED}),
    ReplicaTaskStatus.COMPLETED: frozenset(),
    ReplicaTaskStatus.FAILED: frozenset({ReplicaTaskStatus.DRAFT}),
}


def can_transition(from_status: ReplicaTaskStatus | str, to_status: ReplicaTaskStatus | str) -> bool:
    try:
        source = ReplicaTaskStatus(from_status)
        target = ReplicaTaskStatus(to_status)
    except ValueError:
        return False
    return target in _TRANSITIONS[source]


def transition(from_status: ReplicaTaskStatus | str, to_status: ReplicaTaskStatus | str) -> ReplicaTaskStatus:
    source = ReplicaTaskStatus(from_status)
    target = ReplicaTaskStatus(to_status)
    if not can_transition(source, target):
        raise ValueError(f"illegal replica task transition: {source} -> {target}")
    return target
