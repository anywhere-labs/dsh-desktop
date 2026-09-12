"""Pixel-preserved video background replacement domain."""

from .contracts import (
    AssetRole,
    BackgroundMode,
    GenerationMode,
    ReplicaAsset,
    ReplicaTaskRequest,
    VideoReplicaTask,
)
from .orchestrator import build_replication_dag
from .ingest import build_ingest_record, validate_source_probe
from .state import ReplicaTaskStatus, can_transition, transition

__all__ = [
    "AssetRole",
    "BackgroundMode",
    "GenerationMode",
    "ReplicaAsset",
    "ReplicaTaskRequest",
    "ReplicaTaskStatus",
    "VideoReplicaTask",
    "build_replication_dag",
    "build_ingest_record",
    "validate_source_probe",
    "can_transition",
    "transition",
]
