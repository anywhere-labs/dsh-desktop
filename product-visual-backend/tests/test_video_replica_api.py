from fastapi.testclient import TestClient
from uuid import uuid4

from backend.main import app


def test_video_generation_capabilities_expose_route_c_contract():
    with TestClient(app) as client:
        response = client.get("/api/video-generation/capabilities")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["data"]["generation_mode"] == "PIXEL_PRESERVED_BACKGROUND_REPLACEMENT"
    assert body["data"]["dag_validation"] == []


def test_create_video_replica_task_requires_source_before_generation():
    task_id = f"api-replica-test-{uuid4().hex[:8]}"
    with TestClient(app) as client:
        response = client.post("/api/video-generation/tasks", json={"task_id": task_id})
        status = client.get(f"/api/video-generation/tasks/{task_id}")
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "draft"
    assert status.json()["data"]["preservation_policy"]["video_regeneration"] is False
