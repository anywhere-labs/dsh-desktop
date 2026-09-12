from backend.app.video_generation.contracts import (
    AssetRole,
    BackgroundMode,
    ObjectSelection,
    ReplicaAsset,
    ReplicaTaskRequest,
)
from backend.app.video_generation.orchestrator import build_replication_dag, validate_replication_dag
from backend.app.video_generation.state import ReplicaTaskStatus, can_transition, transition


def _asset(asset_id: str, role: AssetRole) -> ReplicaAsset:
    return ReplicaAsset(asset_id, role, f"file:///tmp/{asset_id}", "video/mp4", authorized=True)


def _request(**overrides):
    values = {
        "task_id": "replica-1",
        "source_video": _asset("source", AssetRole.SOURCE_VIDEO),
        "background": _asset("background", AssetRole.BACKGROUND_IMAGE),
        "background_mode": BackgroundMode.UPLOAD,
        "selections": (ObjectSelection("person-1", "person", 0, 0.5, 0.4),),
        "confirmed": True,
        "approval_id": "approval-1",
    }
    values.update(overrides)
    return ReplicaTaskRequest(**values)


def test_valid_request_has_no_missing_gates():
    assert _request().validate() == []


def test_request_fails_closed_without_person_or_confirmation():
    missing = _request(selections=(), confirmed=False).validate()
    assert "object_selections" in missing
    assert "person_selection" in missing
    assert "operator_confirmation" in missing


def test_dag_contains_pixel_preserving_order_and_required_gates():
    dag = build_replication_dag()
    assert validate_replication_dag(dag) == []
    assert [item["node"] for item in dag][-2:] == ["video_qa", "delivery"]
    assert next(item for item in dag if item["node"] == "audio_remux")["depends_on"] == ["alpha_composite", "video_ingest"]


def test_state_machine_blocks_shortcuts_to_generation():
    assert not can_transition(ReplicaTaskStatus.DRAFT, ReplicaTaskStatus.COMPOSITING)
    assert can_transition(ReplicaTaskStatus.READY, ReplicaTaskStatus.AWAITING_APPROVAL)
    assert transition(ReplicaTaskStatus.QA_RUNNING, ReplicaTaskStatus.REPAIR_REQUIRED) == ReplicaTaskStatus.REPAIR_REQUIRED
