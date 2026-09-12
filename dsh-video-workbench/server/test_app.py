import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from app import create_app, extract_output_url


def test_extracts_video_url_from_libtv_json_output():
    output = json.dumps({"output": {"url": "https://cdn.example/video.mp4"}})
    assert extract_output_url(output) == "https://cdn.example/video.mp4"


def test_generate_requires_fixed_project_and_node():
    client = create_app(testing=True)
    response = client.post("/api/video-workbench/generate", json={"projectId": "", "node": ""})
    assert response.status_code == 400


def test_generate_returns_job_and_completed_result_from_libtv(tmp_path):
    client = create_app(testing=True, state_dir=tmp_path)
    completed = {"output": {"url": "https://cdn.example/video.mp4"}}
    with patch("vw_app.providers.LibTvCliAdapter.run", return_value=(0, json.dumps(completed), "")):
        response = client.post("/api/video-workbench/generate", json={"projectId": "project-1", "node": "node-1", "confirmed": True, "approvalId": "approval-1"})
    assert response.status_code == 202
    run_id = response.json()["runId"]
    status = client.get(f"/api/video-workbench/jobs/{run_id}")
    assert status.status_code == 200
    assert status.json()["state"] == "COMPLETED"
    assert status.json()["outputUrl"] == "https://cdn.example/video.mp4"


def test_preflight_fails_closed_without_approval_or_authorized_assets(tmp_path):
    client = create_app(testing=True, state_dir=tmp_path)
    response = client.post("/api/video-workbench/preflight", json={
        "projectId": "project-1",
        "node": "node-1",
        "confirmed": True,
        "assets": [{"assetId": "person", "kind": "REFERENCE_IMAGE", "authorized": False}],
    })
    assert response.status_code == 200
    assert response.json()["allowed"] is False
    assert "approvalId is required" in response.json()["errors"]
    assert "all assets must be authorized" in response.json()["errors"]


def test_missing_job_is_404(tmp_path):
    client = create_app(testing=True, state_dir=tmp_path)
    assert client.get("/api/video-workbench/jobs/no-such-job").status_code == 404


def test_full_http_chain_uses_mock_libtv_cli(tmp_path, monkeypatch):
    monkeypatch.setenv("LIBTV_BIN", str(Path(__file__).parent / "fixtures" / "mock_libtv"))
    monkeypatch.setenv("LIBTV_CWD", str(tmp_path))
    client = create_app(testing=True, state_dir=tmp_path)
    response = client.post("/api/video-workbench/generate", json={
        "workspaceId": "workspace-1",
        "projectId": "project-1",
        "node": "node-1",
        "confirmed": True,
        "approvalId": "approval-1",
        "idempotencyKey": "workspace-1:project-1:node-1:1",
        "assets": [{"assetId": "product", "kind": "PRODUCT", "authorized": True}],
    })
    assert response.status_code == 202
    run_id = response.json()["runId"]
    status = client.get(f"/api/video-workbench/jobs/{run_id}").json()
    assert status["state"] == "COMPLETED"
    assert status["outputUrl"] == "https://mock.local/video.mp4"
    events = client.get(f"/api/video-workbench/jobs/{run_id}/events").text
    assert "QUEUED" in events and "GENERATING" in events and "COMPLETED" in events

    tables = {row[0] for row in __import__("sqlite3").connect(tmp_path / "video-workbench.sqlite3").execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"video_jobs", "video_job_events", "asset_manifests", "provider_receipts", "artifacts"} <= tables

    metrics = client.get("/api/video-workbench/loops/video-scene-consistency/metrics")
    assert metrics.status_code == 200 and metrics.json()["episode_count"] == 1
    proposal = client.post("/api/video-workbench/loops/video-scene-consistency/propose")
    assert proposal.status_code == 200 and proposal.json()["merge_policy"] == "manual_review_required"
    artifacts = client.get(f"/api/video-workbench/jobs/{run_id}/artifacts")
    assert artifacts.status_code == 200
    assert artifacts.json()["artifacts"][0]["qaStatus"] == "PENDING_EXTERNAL_DOWNLOAD"
    assert client.get("/api/video-workbench/platform-specs").json()["platforms"]["douyin"]["maxDurationSeconds"] == 15


def test_libtv_compute_failure_uses_enabled_third_party_fallback(tmp_path, monkeypatch):
    config = tmp_path / "providers.json"
    config.write_text(json.dumps({"providers": [{
        "providerId": "fallback-api", "displayName": "Fallback API", "enabled": True,
        "priority": 2, "baseUrl": "https://fallback.invalid/v1", "credentialRef": "FALLBACK_TOKEN",
        "models": [{"modelKey": "minimax-h3", "displayName": "MiniMax H3"}]
    }]}), encoding="utf-8")
    monkeypatch.setenv("VIDEO_PROVIDER_CONFIG_FILE", str(config))
    monkeypatch.setenv("FALLBACK_TOKEN", "test-token")
    client = create_app(testing=True, state_dir=tmp_path / "state")
    with patch("vw_app.providers.LibTvCliAdapter.run", return_value=(1, "", "算力不足")), patch("vw_app.third_party.ThirdPartyVideoAdapter.run", return_value=(0, json.dumps({"output": {"url": "https://fallback.local/video.mp4"}}), "")):
        response = client.post("/api/video-workbench/generate", json={"projectId": "project-1", "node": "node-1", "confirmed": True, "approvalId": "approval-1"})
    assert response.status_code == 202
    run_id = response.json()["runId"]
    result = client.get(f"/api/video-workbench/jobs/{run_id}").json()
    assert result["state"] == "COMPLETED"
    assert result["outputUrl"] == "https://fallback.local/video.mp4"
    assert "fallback-api" in client.get(f"/api/video-workbench/jobs/{run_id}/events").text
