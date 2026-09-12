from fastapi.testclient import TestClient
from uuid import uuid4

from backend.main import app


def test_matting_capabilities_fail_closed_without_external_runners(monkeypatch):
    monkeypatch.delenv("MATANYONE2_RUNNER", raising=False)
    monkeypatch.delenv("BIREFNET_RUNNER", raising=False)
    with TestClient(app) as client:
        response = client.get("/api/video-generation/matting/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "blocked"
    assert set(body["missing_inputs"]) == {"matanyone2", "birefnet"}


def test_matting_preflight_requires_model_runtime(monkeypatch):
    monkeypatch.delenv("MATANYONE2_RUNNER", raising=False)
    task_id = f"api-matting-test-{uuid4().hex[:8]}"
    with TestClient(app) as client:
        client.post("/api/video-generation/tasks", json={"task_id": task_id})
        response = client.post(f"/api/video-generation/tasks/{task_id}/matting/preflight")
    assert response.status_code == 200
    assert response.json()["status"] == "blocked"
    assert response.json()["data"] == {}
