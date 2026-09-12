from __future__ import annotations

from typing import Any


PIXEL_REPLICA_DAG: tuple[dict[str, Any], ...] = (
    {"node": "video_ingest", "agent": "VideoIngestAgent", "depends_on": ()},
    {"node": "shot_detection", "agent": "ShotDetectionAgent", "depends_on": ("video_ingest",)},
    {"node": "foreground_selection", "agent": "ForegroundSelectionAgent", "depends_on": ("shot_detection",)},
    {"node": "object_tracking", "agent": "ObjectTrackingAgent", "depends_on": ("foreground_selection",)},
    {"node": "human_matting", "agent": "HumanMatteAgent", "depends_on": ("object_tracking",)},
    {"node": "product_refinement", "agent": "ProductRefineAgent", "depends_on": ("object_tracking",)},
    {"node": "camera_motion", "agent": "CameraMotionAgent", "depends_on": ("shot_detection",)},
    {"node": "background_prepare", "agent": "BackgroundAgent", "depends_on": ("camera_motion",)},
    {"node": "alpha_composite", "agent": "CompositeAgent", "depends_on": ("human_matting", "product_refinement", "background_prepare")},
    {"node": "audio_remux", "agent": "AudioRemuxAgent", "depends_on": ("alpha_composite", "video_ingest")},
    {"node": "video_qa", "agent": "VideoQAAgent", "depends_on": ("audio_remux",)},
    {"node": "delivery", "agent": "DeliveryAgent", "depends_on": ("video_qa",)},
)


def build_replication_dag() -> list[dict[str, Any]]:
    """Return a JSON-safe copy so callers cannot mutate the canonical DAG."""
    return [
        {**node, "depends_on": list(node["depends_on"])}
        for node in PIXEL_REPLICA_DAG
    ]


def validate_replication_dag(dag: list[dict[str, Any]] | None = None) -> list[str]:
    nodes = dag or build_replication_dag()
    names = {str(item.get("node")) for item in nodes}
    errors: list[str] = []
    if len(names) != len(nodes):
        errors.append("duplicate_node")
    for item in nodes:
        for dependency in item.get("depends_on") or []:
            if dependency not in names:
                errors.append(f"missing_dependency:{dependency}")
    if not any(item.get("node") == "video_qa" for item in nodes):
        errors.append("missing_video_qa")
    if not any(item.get("node") == "audio_remux" for item in nodes):
        errors.append("missing_audio_remux")
    return errors
