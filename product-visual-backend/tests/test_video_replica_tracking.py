from backend.app.video_generation.tracking import build_tracking_request, tracker_preflight, validate_selections


def _selection():
    return {"object_id": "person-1", "label": "person", "frame_index": 0, "x": 0.5, "y": 0.4}


def test_selection_requires_person():
    assert validate_selections([]) == ["object_selections"]
    assert validate_selections([{"object_id": "product-1", "label": "product", "frame_index": 0, "x": 0.4, "y": 0.4}]) == ["person_selection"]
    assert validate_selections([_selection()]) == []


def test_tracking_fails_closed_without_model_runners(monkeypatch):
    monkeypatch.delenv("SAM2_RUNNER", raising=False)
    monkeypatch.delenv("CUTIE_RUNNER", raising=False)
    state = tracker_preflight()
    assert state["status"] == "blocked"
    assert set(state["missing_inputs"]) == {"sam2", "cutie"}


def test_tracking_request_preserves_pixel_policy(monkeypatch):
    monkeypatch.setenv("SAM2_RUNNER", "/opt/sam2-runner")
    monkeypatch.setenv("CUTIE_RUNNER", "/opt/cutie-runner")
    request = build_tracking_request("replica-1", [_selection()])
    assert request["sam2"] == "首帧提示分割"
    assert request["cutie"] == "时序传播"
    assert request["preserve_original_pixels"] is True
